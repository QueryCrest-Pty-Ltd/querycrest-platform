import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtVerify } from "https://esm.sh/jose@5";

const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "https://www.querycrest.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function _json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") || "your-secret-key";

async function verifyToken(authHeader: string): Promise<boolean> {
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

async function checkLockdown(): Promise<boolean> {
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

async function logAuditAction(action: string, details: Record<string, unknown>) {
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

// Get table name from request
function getTableName(body: any): string | null {
  if (!body || !body.table) return null;
  const table = body.table.toLowerCase();
  if (table === "universities" || table === "university") {
    return "universities";
  }
  if (table === "universities_bursaries" || table === "bursaries" || table === "bursary") {
    return "universities_bursaries";
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const origin = req.headers.get("origin");
  if (origin && origin !== "https://www.querycrest.com") {
    return _json({ error: "Origin not allowed" }, 403);
  }

  // Check for emergency lockdown
  const isLocked = await checkLockdown();
  if (isLocked) {
    return _json({ error: "System is in emergency lockdown. No operations allowed." }, 503);
  }

  // Verify authentication
  const authHeader = req.headers.get("authorization") || "";
  const isAuthenticated = await verifyToken(authHeader);
  if (!isAuthenticated) {
    return _json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const method = req.method;
  const svc = _SVC();

  try {
    // ===== GET ALL =====
    if (method === "GET") {
      const table = url.searchParams.get("table") || "universities";
      let tableName: string;

      if (table.toLowerCase() === "bursaries" || table.toLowerCase() === "universities_bursaries") {
        tableName = "universities_bursaries";
      } else {
        tableName = "universities";
      }

      const { data, error } = await svc
        .from(tableName)
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .order("name");

      if (error) {
        console.error(`GET all error (${tableName}):`, error.message);
        return _json({ error: `Failed to fetch ${tableName}` }, 500);
      }

      await logAuditAction(`VIEW_${tableName.toUpperCase()}`, { count: data?.length || 0 });
      return _json({ data });
    }

    // ===== GET BY ID =====
    const idMatch = url.pathname.match(/^\/functions\/v1\/institutions\/(\d+)$/);
    if (method === "GET" && idMatch) {
      const id = parseInt(idMatch[1]);
      const table = url.searchParams.get("table") || "universities";
      let tableName: string;

      if (table.toLowerCase() === "bursaries" || table.toLowerCase() === "universities_bursaries") {
        tableName = "universities_bursaries";
      } else {
        tableName = "universities";
      }

      const { data, error } = await svc
        .from(tableName)
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .eq("id", id)
        .single();

      if (error || !data) {
        return _json({ error: "Record not found" }, 404);
      }

      await logAuditAction(`VIEW_${tableName.toUpperCase()}`, { id });
      return _json({ data });
    }

    // ===== POST =====
    if (method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return _json({ error: "Invalid request body" }, 400);
      }

      // Determine which table to use
      const tableName = getTableName(body);
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
        }, 400);
      }

      const { name, type, opening_date, closing_date, status, is_private } = body;

      if (!name || !type) {
        return _json({ error: "Name and type are required" }, 400);
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
        console.error(`POST error (${tableName}):`, error.message);
        return _json({ error: `Failed to create record in ${tableName}` }, 500);
      }

      await logAuditAction(`CREATE_${tableName.toUpperCase()}`, { id: data?.[0]?.id, name });
      return _json({ data: data?.[0], message: `Record created in ${tableName}` }, 201);
    }

    // ===== PUT (Update) =====
    if (method === "PUT" && idMatch) {
      const id = parseInt(idMatch[1]);
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return _json({ error: "Invalid request body" }, 400);
      }

      const tableName = getTableName(body);
      if (!tableName) {
        return _json({ 
          error: "Missing or invalid 'table' field",
          valid_tables: ["universities", "universities_bursaries"]
        }, 400);
      }

      const { name, type, opening_date, closing_date, status, is_private } = body;

      if (!name || !type) {
        return _json({ error: "Name and type are required" }, 400);
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
        console.error(`PUT error (${tableName}):`, error.message);
        return _json({ error: `Failed to update record in ${tableName}` }, 500);
      }

      if (!data || data.length === 0) {
        return _json({ error: "Record not found" }, 404);
      }

      await logAuditAction(`UPDATE_${tableName.toUpperCase()}`, { id, name });
      return _json({ data: data[0], message: `Record updated in ${tableName}` });
    }

    // ===== DELETE =====
    if (method === "DELETE" && idMatch) {
      const id = parseInt(idMatch[1]);
      const table = url.searchParams.get("table") || "universities";
      let tableName: string;

      if (table.toLowerCase() === "bursaries" || table.toLowerCase() === "universities_bursaries") {
        tableName = "universities_bursaries";
      } else {
        tableName = "universities";
      }

      const { error } = await svc.from(tableName).delete().eq("id", id);

      if (error) {
        console.error(`DELETE error (${tableName}):`, error.message);
        return _json({ error: `Failed to delete record from ${tableName}` }, 500);
      }

      await logAuditAction(`DELETE_${tableName.toUpperCase()}`, { id });
      return _json({ message: `Record deleted from ${tableName}` });
    }

    // ===== SEARCH =====
    if (method === "GET" && url.pathname === "/functions/v1/institutions/search") {
      const query = url.searchParams.get("q") || "";
      const table = url.searchParams.get("table") || "universities";
      
      if (!query.trim()) {
        return _json({ error: "Search query required" }, 400);
      }

      let tableName: string;
      if (table.toLowerCase() === "bursaries" || table.toLowerCase() === "universities_bursaries") {
        tableName = "universities_bursaries";
      } else {
        tableName = "universities";
      }

      const { data, error } = await svc
        .from(tableName)
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .ilike("name", `%${query}%`)
        .order("name");

      if (error) {
        console.error(`Search error (${tableName}):`, error.message);
        return _json({ error: "Search failed" }, 500);
      }

      await logAuditAction(`SEARCH_${tableName.toUpperCase()}`, { query });
      return _json({ data });
    }

    return _json({ 
      error: "Endpoint not found",
      available_endpoints: [
        "GET /institutions?table=universities - List all universities",
        "GET /institutions?table=universities_bursaries - List all bursaries",
        "GET /institutions/{id}?table=universities - Get single university",
        "GET /institutions/{id}?table=universities_bursaries - Get single bursary",
        "POST /institutions - Create record (requires 'table' in body)",
        "PUT /institutions/{id} - Update record (requires 'table' in body)",
        "DELETE /institutions/{id}?table=universities - Delete university",
        "DELETE /institutions/{id}?table=universities_bursaries - Delete bursary",
        "GET /institutions/search?q=query&table=universities - Search universities",
        "GET /institutions/search?q=query&table=universities_bursaries - Search bursaries"
      ],
      example_post: {
        table: "universities",
        name: "University Name",
        type: "University",
        opening_date: "2026-01-01",
        closing_date: "2026-12-31"
      }
    }, 404);
  } catch (err) {
    console.error("institutions: unexpected error", err instanceof Error ? err.message : err);
    return _json({ error: "Server error" }, 500);
  }
});