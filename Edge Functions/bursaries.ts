import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtVerify } from "https://esm.sh/jose@5";

// ===== CONFIGURATION =====
const ALLOWED_ORIGINS = [
  "https://www.querycrest.com",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://querycrest.com",
];

const TABLE_MAP: Record<string, string> = {
  institutions: "universities",
  bursaries: "universities_bursaries",
};

const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") || "your-secret-key";

// ===== CORS HELPERS =====
function getCorsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function _json(body: unknown, status = 200, origin: string | null = null): Response {
  const corsHeaders = getCorsHeaders(origin);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function _error(message: string, status = 400, origin: string | null = null, details?: unknown): Response {
  const body: Record<string, unknown> = { 
    error: message, 
    status, 
    timestamp: new Date().toISOString() 
  };
  if (details !== undefined) body.details = details;
  return _json(body, status, origin);
}

// ===== JWT VERIFICATION =====
async function verifyToken(authHeader: string): Promise<{ valid: boolean; userId?: string; role?: string }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return { valid: false };
  const token = authHeader.slice(7);
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return { 
      valid: true, 
      userId: payload.sub as string, 
      role: (payload.role as string) || "admin" 
    };
  } catch (err) {
    console.error("JWT verification failed:", err);
    return { valid: false };
  }
}

// ===== RATE LIMITING =====
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX_REQUESTS = 100;
const RATE_LIMIT_WINDOW = 60 * 1000;

function checkRateLimit(identifier: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimitStore.get(identifier);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(identifier, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfter: Math.ceil((record.resetTime - now) / 1000) };
  }
  record.count++;
  return { allowed: true };
}

// ===== LOCKDOWN CHECK =====
async function checkLockdown(svc: any): Promise<{ locked: boolean; message?: string }> {
  try {
    const { data, error } = await svc
      .from("admin_lockdown")
      .select("is_active, expires_at, reason")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return { locked: false };

    const lockdown = data[0];
    const now = new Date();
    const expiresAt = new Date(lockdown.expires_at);

    if (lockdown.is_active && now < expiresAt) {
      return { locked: true, message: lockdown.reason || "System is in emergency lockdown" };
    }
    if (lockdown.is_active && now >= expiresAt) {
      await svc.from("admin_lockdown").update({ is_active: false }).eq("id", data[0].id);
    }
    return { locked: false };
  } catch (err) {
    console.error("Lockdown check failed:", err);
    return { locked: false };
  }
}

// ===== AUDIT LOGGING =====
async function logAuditAction(svc: any, action: string, details: Record<string, unknown>, userId?: string, ip?: string) {
  try {
    await svc.from("audit_log").insert({
      action,
      details: JSON.stringify(details),
      user_id: userId || null,
      ip_address: ip || null,
      timestamp: new Date().toISOString(),
      source: "institutions-edge-function",
    });
  } catch (err) {
    console.error("Failed to log audit action:", err);
  }
}

// ===== VALIDATION =====
function validateRecordData(data: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.name || typeof data.name !== "string") {
    errors.push("Name is required and must be a string");
  } else {
    const name = data.name.trim();
    if (name.length < 2) errors.push("Name must be at least 2 characters");
    if (name.length > 255) errors.push("Name must not exceed 255 characters");
  }

  if (!data.type || typeof data.type !== "string") {
    errors.push("Type is required and must be a string");
  }

  if (data.opening_date && typeof data.opening_date === "string") {
    if (isNaN(new Date(data.opening_date).getTime())) errors.push("Invalid opening_date format. Use YYYY-MM-DD");
  }
  if (data.closing_date && typeof data.closing_date === "string") {
    if (isNaN(new Date(data.closing_date).getTime())) errors.push("Invalid closing_date format. Use YYYY-MM-DD");
  }

  if (data.status && typeof data.status === "string") {
    const validStatuses = ["active", "inactive", "pending", "archived"];
    if (!validStatuses.includes(data.status)) errors.push(`Status must be one of: ${validStatuses.join(", ")}`);
  }

  if (data.is_private !== undefined && typeof data.is_private !== "boolean") {
    errors.push("is_private must be a boolean");
  }

  return { valid: errors.length === 0, errors };
}

// ===== ROUTE PARSING =====
function parseRoute(pathname: string): { resource: string | null; id: number | null; isSearch: boolean } {
  const parts = pathname.replace(/^\/functions\/v1\//, "").split("/").filter(Boolean);
  if (parts.length === 0 || !TABLE_MAP[parts[0]]) return { resource: null, id: null, isSearch: false };

  const resource = parts[0];
  if (parts.length === 1) return { resource, id: null, isSearch: false };
  if (parts[1] === "search") return { resource, id: null, isSearch: true };
  if (/^\d+$/.test(parts[1])) return { resource, id: parseInt(parts[1]), isSearch: false };

  return { resource: null, id: null, isSearch: false };
}

// ===== MAIN HANDLER =====
Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const origin = req.headers.get("origin");
  const clientIp = req.headers.get("x-forwarded-for") || "unknown";

  // Handle OPTIONS (CORS preflight)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }

  // Origin validation
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    console.warn(`[${requestId}] Blocked origin: ${origin}`);
    return _error("Origin not allowed", 403, origin);
  }

  // Rate limiting
  const rl = checkRateLimit(clientIp);
  if (!rl.allowed) {
    return _error(`Rate limit exceeded. Try again in ${rl.retryAfter} seconds`, 429, origin);
  }

  const url = new URL(req.url);
  const { resource, id, isSearch } = parseRoute(url.pathname);
  const method = req.method;
  const svc = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Check lockdown
  const lockdown = await checkLockdown(svc);
  if (lockdown.locked) {
    return _error(lockdown.message || "System is in emergency lockdown", 503, origin);
  }

  // Authentication
  const authHeader = req.headers.get("authorization") || "";
  const auth = await verifyToken(authHeader);
  if (!auth.valid) {
    await logAuditAction(svc, "AUTH_FAILURE", { path: url.pathname, ip: clientIp }, undefined, clientIp);
    return _error("Unauthorized - Invalid or missing token", 401, origin);
  }

  // Authorization for write operations
  const isWrite = ["POST", "PUT", "DELETE"].includes(method);
  if (isWrite && auth.role !== "admin") {
    await logAuditAction(svc, "AUTHORIZATION_FAILURE", { path: url.pathname, userId: auth.userId }, auth.userId, clientIp);
    return _error("Forbidden - Insufficient permissions", 403, origin);
  }

  if (!resource) {
    return _error("Endpoint not found", 404, origin, {
      available_endpoints: [
        "GET /institutions", "GET /institutions/:id", "GET /institutions/search?q=",
        "POST /institutions", "PUT /institutions/:id", "DELETE /institutions/:id",
        "GET /bursaries", "GET /bursaries/:id", "GET /bursaries/search?q=",
        "POST /bursaries", "PUT /bursaries/:id", "DELETE /bursaries/:id",
      ],
    });
  }

  const tableName = TABLE_MAP[resource];

  try {
    // ===== GET ALL =====
    if (method === "GET" && id === null && !isSearch) {
      const { data, error } = await svc
        .from(tableName)
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .order("name");

      if (error) {
        console.error(`[${requestId}] GET all error:`, error.message);
        return _error(`Failed to fetch ${resource}`, 500, origin);
      }

      await logAuditAction(svc, `VIEW_${resource.toUpperCase()}`, { count: data?.length || 0 }, auth.userId, clientIp);
      return _json({ data, meta: { count: data?.length || 0, table: tableName } }, 200, origin);
    }

    // ===== GET BY ID =====
    if (method === "GET" && id !== null) {
      const { data, error } = await svc
        .from(tableName)
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .eq("id", id)
        .single();

      if (error || !data) return _error("Record not found", 404, origin);

      await logAuditAction(svc, `VIEW_${resource.toUpperCase()}`, { id }, auth.userId, clientIp);
      return _json({ data }, 200, origin);
    }

    // ===== SEARCH =====
    if (method === "GET" && isSearch) {
      const query = url.searchParams.get("q") || "";
      if (!query.trim()) return _error("Search query required", 400, origin);

      const { data, error } = await svc
        .from(tableName)
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .ilike("name", `%${query}%`)
        .order("name")
        .limit(50);

      if (error) {
        console.error(`[${requestId}] Search error:`, error.message);
        return _error("Search failed", 500, origin);
      }

      await logAuditAction(svc, `SEARCH_${resource.toUpperCase()}`, { query, resultCount: data?.length || 0 }, auth.userId, clientIp);
      return _json({ data, meta: { query, count: data?.length || 0, table: tableName } }, 200, origin);
    }

    // ===== CREATE =====
    if (method === "POST" && id === null) {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return _error("Invalid JSON in request body", 400, origin);
      }

      const validation = validateRecordData(body);
      if (!validation.valid) return _error("Validation failed", 400, origin, validation.errors);

      const { name, type, opening_date, closing_date, status, is_private } = body;

      const { data: existing } = await svc
        .from(tableName)
        .select("id")
        .ilike("name", String(name).trim())
        .maybeSingle();

      if (existing) return _error("Record with this name already exists", 409, origin);

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
        console.error(`[${requestId}] POST error:`, error.message);
        return _error(`Failed to create record in ${tableName}`, 500, origin);
      }

      await logAuditAction(svc, `CREATE_${resource.toUpperCase()}`, { id: data?.[0]?.id, name: String(name).trim() }, auth.userId, clientIp);
      return _json({ data: data?.[0], message: `Record created in ${tableName}` }, 201, origin);
    }

    // ===== UPDATE =====
    if (method === "PUT" && id !== null) {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return _error("Invalid JSON in request body", 400, origin);
      }

      const validation = validateRecordData(body);
      if (!validation.valid) return _error("Validation failed", 400, origin, validation.errors);

      const { name, type, opening_date, closing_date, status, is_private } = body;

      const { data: existing } = await svc.from(tableName).select("id").eq("id", id).maybeSingle();
      if (!existing) return _error("Record not found", 404, origin);

      const { data, error } = await svc
        .from(tableName)
        .update({
          name: String(name).trim(),
          type: String(type).trim(),
          opening_date: opening_date || null,
          closing_date: closing_date || null,
          status: status || "active",
          is_private: is_private || false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select();

      if (error) {
        console.error(`[${requestId}] PUT error:`, error.message);
        return _error(`Failed to update record in ${tableName}`, 500, origin);
      }

      await logAuditAction(svc, `UPDATE_${resource.toUpperCase()}`, { id, name: String(name).trim() }, auth.userId, clientIp);
      return _json({ data: data?.[0], message: `Record updated in ${tableName}` }, 200, origin);
    }

    // ===== DELETE =====
    if (method === "DELETE" && id !== null) {
      const { data: existing } = await svc.from(tableName).select("id, name").eq("id", id).maybeSingle();
      if (!existing) return _error("Record not found", 404, origin);

      const { error } = await svc.from(tableName).delete().eq("id", id);
      if (error) {
        console.error(`[${requestId}] DELETE error:`, error.message);
        return _error(`Failed to delete record from ${tableName}`, 500, origin);
      }

      await logAuditAction(svc, `DELETE_${resource.toUpperCase()}`, { id, name: existing.name }, auth.userId, clientIp);
      return _json({ message: `Record deleted from ${tableName}`, id, table: tableName }, 200, origin);
    }

    return _error("Endpoint not found", 404, origin);

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[${requestId}] Unexpected error:`, errorMessage);
    await logAuditAction(svc, "ERROR", { method, path: url.pathname, error: errorMessage }, auth.userId, clientIp);
    return _error("Internal server error", 500, origin);
  }
});