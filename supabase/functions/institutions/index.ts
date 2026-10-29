import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtVerify } from "https://esm.sh/jose@5";

// ============================================================
// SUPABASE CLIENT
// ============================================================
const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ============================================================
// CORS CONFIGURATION
// ============================================================

const ALLOWED_ORIGINS = [
  "https://querycrest.com",// Truehost
  "https://www.querycrest.com",// Truehost
  'https://www.portal.querycrest.com', // Digital ocean
  'https://portal.querycrest.com', // Digital ocean   

];
let origin = null;
function getCorsHeaders(origin: string | null) {
  // Check if the request's origin is in the allowlist.
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0]; // Fallback to the first allowed origin if not matched

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Max-Age":           "86400",
  "Access-Control-Allow-Credentials": "true",   // ← required for cookies
  };
}


function _json(body: unknown, status = 200,origin: string | null): Response {
  const cors = getCorsHeaders(origin);
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ============================================================
// RATE LIMITING
// ============================================================
const RATE_LIMIT = {
  windowMs: 60 * 1000,
  maxRequests: 100
};
const rateLimits = new Map();

function checkRateLimit(identifier) {
  const now = Date.now();
  const record = rateLimits.get(identifier);
  
  if (!record || now > record.resetTime) {
    rateLimits.set(identifier, { count: 1, resetTime: now + RATE_LIMIT.windowMs });
    return { allowed: true, remaining: RATE_LIMIT.maxRequests - 1 };
  }
  
  if (record.count >= RATE_LIMIT.maxRequests) {
    return { allowed: false, remaining: 0, resetAfter: Math.ceil((record.resetTime - now) / 1000) };
  }
  
  record.count++;
  return { allowed: true, remaining: RATE_LIMIT.maxRequests - record.count };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimits) {
    if (now > value.resetTime) {
      rateLimits.delete(key);
    }
  }
}, 60000);

// ============================================================
// HELPERS
// ============================================================


const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") || "your-secret-key";

async function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.slice(7);
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

async function checkLockdown() {
  const svc = _SVC();
  const { data } = await svc
    .from("admin_lockdown")
    .select("is_active, expires_at")
    .order("created_at", { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return false;

  const lockdown = data[0];
  const now = new Date();
  const expiresAt = new Date(lockdown.expires_at);

  if (lockdown.is_active && now < expiresAt) {
    return true;
  }

  if (lockdown.is_active && now >= expiresAt) {
    await svc.from("admin_lockdown").update({ is_active: false }).eq("id", data[0].id);
  }

  return false;
}

async function logAuditAction(action, details) {
  const svc = _SVC();
  try {
    await svc.from("audit_log").insert({
      action,
      details: JSON.stringify(details),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Failed to log audit action:", err);
  }
}

// ============================================================
// TABLE ROUTING
// ============================================================
function getTableName(tableParam) {
  const table = tableParam.toLowerCase();
  if (table === "universities" || table === "university") {
    return "universities";
  }
  if (table === "universities_bursaries" || table === "bursaries" || table === "bursary") {
    return "universities_bursaries";
  }
  return "universities";
}

function getTableNameFromBody(body) {
  if (!body || !body.table) return null;
  return getTableName(body.table);
}

// ============================================================
// MAIN HANDLER
// ============================================================
Deno.serve(async (req) => {
  origin = req.headers.get("origin");   
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }


  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return _json({ error: "Origin not allowed" }, 403,origin);
  }

  const clientId = req.headers.get("x-forwarded-for") || 
                   req.headers.get("authorization") || 
                   "unknown";
  const rateCheck = checkRateLimit(clientId);
  if (!rateCheck.allowed) {
    return _json({ 
      error: "Rate limit exceeded. Try again later.",
      remaining: 0,
      resetAfter: rateCheck.resetAfter
    }, 429,origin);
  }

  const isLocked = await checkLockdown();
  if (isLocked) {
    return _json({ error: "System is in emergency lockdown. No operations allowed." }, 503,origin);
  }

  const authHeader = req.headers.get("authorization") || "";
  const isAuthenticated = await verifyToken(authHeader);
  if (!isAuthenticated) {
    return _json({ error: "Unauthorized" }, 401,origin);
  }

  const url = new URL(req.url);
  const method = req.method;
  const svc = _SVC();

  // Proper path extraction
  let path = url.pathname;
  
  if (path.startsWith("/functions/v1/institutions")) {
    const afterFunction = path.replace("/functions/v1/institutions", "");
    if (afterFunction === "" || afterFunction === "/") {
      path = "/";
    } else if (afterFunction.startsWith("/")) {
      path = afterFunction;
    } else {
      path = "/" + afterFunction;
    }
  }

  console.log(`[DEBUG] Method: ${method}, Path: ${path}`);

  try {
    // ============================================================
    // GET - List all records
    // ============================================================
    if (method === "GET" && path === "/") {
      const tableParam = url.searchParams.get("table") || "universities";
      const tableName = getTableName(tableParam);
      
      const page = parseInt(url.searchParams.get("page") || "1");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
      const offset = (page - 1) * limit;

      const { data, error } = await svc
        .from(tableName)
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .range(offset, offset + limit - 1)
        .order("name");

      if (error) {
        return _json({ error: `Failed to fetch ${tableName}` }, 500,origin);
      }

      await logAuditAction(`VIEW_${tableName.toUpperCase()}`, { count: data?.length || 0 });
      
      return _json({ 
        data,
        pagination: {
          page,
          limit,
          total: data?.length || 0,
          pages: Math.ceil((data?.length || 0) / limit)
        }
      },200,origin);
    }

    // ============================================================
    // GET - Search
    // ============================================================
    if (method === "GET" && path === "/search") {
      const query = url.searchParams.get("q") || "";
      const tableParam = url.searchParams.get("table") || "universities";
      
      if (!query.trim()) {
        return _json({ error: "Search query required" }, 400,origin);
      }

      const tableName = getTableName(tableParam);

      const { data, error } = await svc
        .from(tableName)
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .ilike("name", `%${query}%`)
        .order("name");

      if (error) {
        return _json({ error: "Search failed" }, 500,origin);
      }

      await logAuditAction(`SEARCH_${tableName.toUpperCase()}`, { query });
      return _json({ data },200,origin);
    }

    // ============================================================
    // GET - Single record by ID
    // ============================================================
    const idMatch = path.match(/^\/(\d+)$/);
    if (method === "GET" && idMatch) {
      const id = parseInt(idMatch[1]);
      const tableParam = url.searchParams.get("table") || "universities";
      const tableName = getTableName(tableParam);

      const { data, error } = await svc
        .from(tableName)
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .eq("id", id)
        .single();

      if (error || !data) {
        return _json({ error: "Record not found" }, 404,origin);
      }

      await logAuditAction(`VIEW_${tableName.toUpperCase()}`, { id });
      return _json({ data },200,origin);
    }

    // ============================================================
    // POST - Create new record
    // ============================================================
    if (method === "POST" && path === "/") {
      let body;
      try {
        body = await req.json();
      } catch {
        return _json({ error: "Invalid request body" }, 400,origin);
      }

      const tableName = getTableNameFromBody(body);
      if (!tableName) {
        return _json({ 
          error: "Missing or invalid 'table' field",
          valid_tables: ["universities", "universities_bursaries"],
          example: {
            table: "universities",
            name: "University Name",
            type: "University",
            opening_date: "2026-01-01",
            closing_date: "2026-12-31"
          }
        }, 400,origin);
      }

      const { name, type, opening_date, closing_date, status, is_private } = body;

      if (!name || !type) {
        return _json({ error: "Name and type are required" }, 400,origin);
      }

      const { data, error } = await svc
        .from(tableName)
        .insert({
          name: String(name).trim(),
          type: String(type).trim(),
          opening_date: opening_date || null,
          closing_date: closing_date || null,
          status: status || "active",
          is_private: is_private || false,
        })
        .select();

      if (error) {
        return _json({ error: `Failed to create record in ${tableName}` }, 500,origin);
      }

      await logAuditAction(`CREATE_${tableName.toUpperCase()}`, { id: data?.[0]?.id, name });
      return _json({ data: data?.[0], message: `Record created in ${tableName}` }, 201,origin);
    }

    // ============================================================
    // PUT - Update record
    // ============================================================
    if (method === "PUT" && idMatch) {
      const id = parseInt(idMatch[1]);
      let body;
      try {
        body = await req.json();
      } catch {
        return _json({ error: "Invalid request body" }, 400,origin);
      }

      const tableName = getTableNameFromBody(body);
      if (!tableName) {
        return _json({ error: "Missing or invalid 'table' field" }, 400,origin);
      }

      const { name, type, opening_date, closing_date, status, is_private } = body;

      if (!name || !type) {
        return _json({ error: "Name and type are required" }, 400,origin);
      }

      const { data, error } = await svc
        .from(tableName)
        .update({
          name: String(name).trim(),
          type: String(type).trim(),
          opening_date: opening_date || null,
          closing_date: closing_date || null,
          status: status || "active",
          is_private: is_private || false,
        })
        .eq("id", id)
        .select();

      if (error) {
        return _json({ error: `Failed to update record in ${tableName}` }, 500,origin);
      }

      if (!data || data.length === 0) {
        return _json({ error: "Record not found" }, 404,origin);
      }

      await logAuditAction(`UPDATE_${tableName.toUpperCase()}`, { id, name });
      return _json({ data: data[0], message: `Record updated in ${tableName}` },200,origin);
    }

    // ============================================================
    // DELETE - Delete record
    // ============================================================
    if (method === "DELETE" && idMatch) {
      const id = parseInt(idMatch[1]);
      const tableParam = url.searchParams.get("table") || "universities";
      const tableName = getTableName(tableParam);

      const { error } = await svc.from(tableName).delete().eq("id", id);

      if (error) {
        return _json({ error: `Failed to delete record from ${tableName}` }, 500,origin);
      }

      await logAuditAction(`DELETE_${tableName.toUpperCase()}`, { id });
      return _json({ message: `Record deleted from ${tableName}` },200,origin);
    }

    // ============================================================
    // 404 - Route not found
    // ============================================================
    return _json({ 
      error: "Endpoint not found",
      path: path,
      method: method,
      available_endpoints: {
        "GET /institutions?table=universities": "List all universities",
        "GET /institutions?table=universities_bursaries": "List all bursaries",
        "GET /institutions/{id}?table=universities": "Get single university",
        "GET /institutions/{id}?table=universities_bursaries": "Get single bursary",
        "GET /institutions/search?q=query&table=universities": "Search universities",
        "GET /institutions/search?q=query&table=universities_bursaries": "Search bursaries",
        "POST /institutions": "Create record (requires 'table' in body)",
        "PUT /institutions/{id}": "Update record (requires 'table' in body)",
        "DELETE /institutions/{id}?table=universities": "Delete university",
        "DELETE /institutions/{id}?table=universities_bursaries": "Delete bursary"
      },
      example_post: {
        table: "universities",
        name: "University Name",
        type: "University",
        opening_date: "2026-01-01",
        closing_date: "2026-12-31"
      }
    }, 404,origin);
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    return _json({ error: "Server error: " + (err instanceof Error ? err.message : String(err)) }, 500,origin);
  }
});
