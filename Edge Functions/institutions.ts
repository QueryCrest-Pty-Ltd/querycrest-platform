// institutions.ts - Using Supabase Secrets (No separate admin login)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtVerify } from "https://esm.sh/jose@5";

// ===== CONFIGURATION =====
const CONFIG = {
  // Rate limiting
  RATE_LIMIT_WINDOW: 60 * 1000, // 1 minute
  RATE_LIMIT_MAX_REQUESTS: 100,
  
  // CORS
  ALLOWED_ORIGINS: [
    "https://www.querycrest.com",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "https://*.supabase.co"
  ],
  
  // Validation
  MAX_NAME_LENGTH: 255,
  MIN_NAME_LENGTH: 2,
  
  // Tables
  VALID_TABLES: ["universities", "universities_bursaries"],
  
  // JWT Secret - From Supabase secrets
  JWT_SECRET: Deno.env.get("SUPABASE_JWT_SECRET") || "your-secret-key-change-this"
};

// ===== SUPABASE CLIENT =====
const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ===== CORS HEADERS =====
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, origin",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Credentials": "true",
};

// ===== RESPONSE HELPERS =====
function _json(body: unknown, status = 200, extraHeaders = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 
      ...CORS, 
      ...extraHeaders,
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
    },
  });
}

function _error(message: string, status = 400, details?: any): Response {
  const responseBody: any = { 
    error: message, 
    status,
    timestamp: new Date().toISOString()
  };
  
  if (details !== undefined && details !== null) {
    responseBody.details = details;
  }
  
  return _json(responseBody, status);
}

function _success(data: any, message?: string, status = 200): Response {
  const responseBody: any = { success: true };
  if (data !== undefined) responseBody.data = data;
  if (message) responseBody.message = message;
  return _json(responseBody, status);
}

// ===== JWT VERIFICATION =====
async function verifyToken(authHeader: string): Promise<{ valid: boolean; userId?: string; role?: string }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false };
  }

  const token = authHeader.slice(7);
  try {
    const secret = new TextEncoder().encode(CONFIG.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    
    return { 
      valid: true, 
      userId: payload.sub as string,
      role: payload.role as string || "user"
    };
  } catch (error) {
    console.error("JWT verification failed:", error);
    return { valid: false };
  }
}

// ===== RATE LIMITING =====
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

async function checkRateLimit(identifier: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = Date.now();
  const record = rateLimitStore.get(identifier);
  
  if (!record || now > record.resetTime) {
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime: now + CONFIG.RATE_LIMIT_WINDOW
    });
    return { allowed: true };
  }
  
  if (record.count >= CONFIG.RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    return { allowed: false, retryAfter };
  }
  
  record.count++;
  return { allowed: true };
}

// ===== LOCKDOWN MECHANISM =====
async function checkLockdown(): Promise<{ locked: boolean; message?: string }> {
  const svc = _SVC();
  try {
    const { data, error } = await svc
      .from("admin_lockdown")
      .select("is_active, expires_at, reason")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("Lockdown check error:", error);
      return { locked: false };
    }

    if (!data || data.length === 0) return { locked: false };

    const lockdown = data[0];
    const now = new Date();
    const expiresAt = new Date(lockdown.expires_at);

    if (lockdown.is_active && now < expiresAt) {
      return { 
        locked: true, 
        message: lockdown.reason || "System is in emergency lockdown" 
      };
    }

    if (lockdown.is_active && now >= expiresAt) {
      await svc.from("admin_lockdown").update({ is_active: false }).eq("id", data[0].id);
      console.log("Lockdown auto-expired:", data[0].id);
    }

    return { locked: false };
  } catch (err) {
    console.error("Lockdown check failed:", err);
    return { locked: false };
  }
}

// ===== AUDIT LOGGING =====
async function logAuditAction(
  action: string, 
  details: Record<string, unknown>, 
  userId?: string,
  ip?: string
) {
  const svc = _SVC();
  try {
    await svc.from("audit_log").insert({
      action,
      details: JSON.stringify(details),
      user_id: userId || null,
      ip_address: ip || null,
      timestamp: new Date().toISOString(),
      source: "institutions-edge-function"
    });
  } catch (err) {
    console.error("Failed to log audit action:", err);
  }
}

// ===== VALIDATION =====
function validateInstitutionData(data: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.name || typeof data.name !== 'string') {
    errors.push("Name is required and must be a string");
  } else {
    const name = data.name.trim();
    if (name.length < CONFIG.MIN_NAME_LENGTH) {
      errors.push(`Name must be at least ${CONFIG.MIN_NAME_LENGTH} characters`);
    }
    if (name.length > CONFIG.MAX_NAME_LENGTH) {
      errors.push(`Name must not exceed ${CONFIG.MAX_NAME_LENGTH} characters`);
    }
  }

  if (!data.type || typeof data.type !== 'string') {
    errors.push("Type is required and must be a string");
  } else {
    const validTypes = ["University", "College", "Institute", "School", "Academy", "Technical College", "Vocational", "Bursary"];
    if (!validTypes.includes(data.type as string)) {
      errors.push(`Type must be one of: ${validTypes.join(", ")}`);
    }
  }

  if (data.opening_date && typeof data.opening_date === 'string') {
    const date = new Date(data.opening_date);
    if (isNaN(date.getTime())) {
      errors.push("Invalid opening_date format. Use YYYY-MM-DD");
    }
  }

  if (data.closing_date && typeof data.closing_date === 'string') {
    const date = new Date(data.closing_date);
    if (isNaN(date.getTime())) {
      errors.push("Invalid closing_date format. Use YYYY-MM-DD");
    }
  }

  if (data.status && typeof data.status === 'string') {
    const validStatuses = ["active", "inactive", "pending", "archived"];
    if (!validStatuses.includes(data.status)) {
      errors.push(`Status must be one of: ${validStatuses.join(", ")}`);
    }
  }

  if (data.is_private !== undefined && typeof data.is_private !== 'boolean') {
    errors.push("is_private must be a boolean");
  }

  return { valid: errors.length === 0, errors };
}

function getTableName(body: any): string | null {
  if (!body || !body.table) return null;
  const table = body.table.toLowerCase();
  
  if (CONFIG.VALID_TABLES.includes(table)) {
    return table;
  }
  
  if (table === "university") return "universities";
  if (table === "bursary" || table === "bursaries") return "universities_bursaries";
  
  return null;
}

// ===== MAIN HANDLER =====
Deno.serve(async (req) => {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";

  console.log(`[${requestId}] Request: ${req.method} ${req.url}`);

  // ===== CORS PREFLIGHT =====
  if (req.method === "OPTIONS") {
    return new Response("ok", { 
      headers: {
        ...CORS,
        "Access-Control-Allow-Origin": req.headers.get("origin") || "*"
      }
    });
  }

  // ===== CORS VALIDATION =====
  const origin = req.headers.get("origin");
  if (origin) {
    const isAllowed = CONFIG.ALLOWED_ORIGINS.some(allowed => {
      if (allowed.includes('*')) {
        const pattern = allowed.replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(origin);
      }
      return allowed === origin;
    });
    
    if (!isAllowed) {
      console.warn(`[${requestId}] Blocked request from origin: ${origin}`);
      return _error("Origin not allowed", 403);
    }
  }

  // ===== RATE LIMITING =====
  const rateKey = clientIp;
  const rateLimit = await checkRateLimit(rateKey);
  if (!rateLimit.allowed) {
    console.warn(`[${requestId}] Rate limit exceeded for IP: ${clientIp}`);
    return _error(
      `Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds`,
      429
    );
  }

  // ===== LOCKDOWN CHECK =====
  const lockdown = await checkLockdown();
  if (lockdown.locked) {
    console.warn(`[${requestId}] Request blocked by lockdown: ${lockdown.message}`);
    return _error(lockdown.message || "System is in emergency lockdown", 503);
  }

  // ===== AUTHENTICATION - Using Supabase JWT =====
  const authHeader = req.headers.get("authorization") || "";
  const authResult = await verifyToken(authHeader);
  
  if (!authResult.valid) {
    await logAuditAction("AUTH_FAILURE", {
      method: req.method,
      path: new URL(req.url).pathname,
      ip: clientIp
    }, undefined, clientIp);
    return _error("Unauthorized - Invalid or missing token", 401);
  }

  const userId = authResult.userId;
  const userRole = authResult.role || "user";

  // ===== AUTHORIZATION =====
  const isWriteOperation = ["POST", "PUT", "DELETE"].includes(req.method);
  if (isWriteOperation && userRole !== "admin" && userRole !== "super_admin") {
    await logAuditAction("AUTHORIZATION_FAILURE", {
      method: req.method,
      path: new URL(req.url).pathname,
      userId,
      role: userRole
    }, userId, clientIp);
    return _error("Forbidden - Insufficient permissions", 403);
  }

  // ===== ROUTE HANDLING =====
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method;
  const svc = _SVC();

  try {
    // ===== INSTITUTIONS (Universities) =====
    
    // GET ALL
    if (method === "GET" && pathname === "/functions/v1/institutions" && !url.searchParams.get("q")) {
      const { data, error } = await svc
        .from("universities")
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .order("name");

      if (error) {
        console.error(`[${requestId}] GET institutions error:`, error.message);
        return _error("Failed to fetch institutions", 500);
      }

      await logAuditAction("VIEW_INSTITUTIONS", {
        count: data?.length || 0
      }, userId, clientIp);

      return _success(data, undefined, 200);
    }

    // GET BY ID
    if (method === "GET" && pathname.match(/^\/functions\/v1\/institutions\/(\d+)$/)) {
      const idMatch = pathname.match(/^\/functions\/v1\/institutions\/(\d+)$/);
      const id = parseInt(idMatch![1]);

      const { data, error } = await svc
        .from("universities")
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .eq("id", id)
        .single();

      if (error || !data) {
        return _error("Institution not found", 404);
      }

      await logAuditAction("VIEW_INSTITUTION", {
        id
      }, userId, clientIp);

      return _success(data, undefined, 200);
    }

    // SEARCH
    if (method === "GET" && pathname === "/functions/v1/institutions/search") {
      const query = url.searchParams.get("q") || "";
      if (!query.trim()) {
        return _error("Search query required", 400);
      }

      const { data, error } = await svc
        .from("universities")
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .ilike("name", `%${query}%`)
        .order("name")
        .limit(50);

      if (error) {
        console.error(`[${requestId}] Institution search error:`, error.message);
        return _error("Search failed", 500);
      }

      await logAuditAction("SEARCH_INSTITUTIONS", {
        query,
        resultCount: data?.length || 0
      }, userId, clientIp);

      return _success(data, undefined, 200);
    }

    // CREATE
    if (method === "POST" && pathname === "/functions/v1/institutions") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return _error("Invalid JSON in request body", 400);
      }

      body.table = "universities";
      const tableName = getTableName(body);
      if (!tableName) {
        return _error("Invalid or missing 'table' field", 400, {
          valid_tables: CONFIG.VALID_TABLES,
          example: {
            name: "University Name",
            type: "University",
            opening_date: "2026-01-01",
            closing_date: "2026-12-31"
          }
        });
      }

      const validation = validateInstitutionData(body);
      if (!validation.valid) {
        return _error("Validation failed", 400, validation.errors);
      }

      const { name, type, opening_date, closing_date, status, is_private } = body;

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
        console.error(`[${requestId}] POST institution error:`, error.message);
        return _error("Failed to create institution", 500);
      }

      await logAuditAction("CREATE_INSTITUTION", {
        id: data?.[0]?.id,
        name: String(name).trim()
      }, userId, clientIp);

      return _success(data?.[0], "Institution created successfully", 201);
    }

    // UPDATE
    if (method === "PUT" && pathname.match(/^\/functions\/v1\/institutions\/(\d+)$/)) {
      const idMatch = pathname.match(/^\/functions\/v1\/institutions\/(\d+)$/);
      const id = parseInt(idMatch![1]);
      
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return _error("Invalid JSON in request body", 400);
      }

      body.table = "universities";
      const tableName = getTableName(body);
      if (!tableName) {
        return _error("Invalid or missing 'table' field", 400);
      }

      const validation = validateInstitutionData(body);
      if (!validation.valid) {
        return _error("Validation failed", 400, validation.errors);
      }

      const { name, type, opening_date, closing_date, status, is_private } = body;

      const { data, error } = await svc
        .from(tableName)
        .update({
          name: String(name).trim(),
          type: String(type).trim(),
          opening_date: opening_date || null,
          closing_date: closing_date || null,
          status: status || "active",
          is_private: is_private || false,
          updated_at: new Date().toISOString()
        })
        .eq("id", id)
        .select();

      if (error) {
        console.error(`[${requestId}] PUT institution error:`, error.message);
        return _error("Failed to update institution", 500);
      }

      if (!data || data.length === 0) {
        return _error("Institution not found", 404);
      }

      await logAuditAction("UPDATE_INSTITUTION", {
        id,
        name: String(name).trim()
      }, userId, clientIp);

      return _success(data[0], "Institution updated successfully", 200);
    }

    // DELETE
    if (method === "DELETE" && pathname.match(/^\/functions\/v1\/institutions\/(\d+)$/)) {
      const idMatch = pathname.match(/^\/functions\/v1\/institutions\/(\d+)$/);
      const id = parseInt(idMatch![1]);

      const { data: existing } = await svc
        .from("universities")
        .select("id, name")
        .eq("id", id)
        .maybeSingle();

      if (!existing) {
        return _error("Institution not found", 404);
      }

      const { error } = await svc
        .from("universities")
        .delete()
        .eq("id", id);

      if (error) {
        console.error(`[${requestId}] DELETE institution error:`, error.message);
        return _error("Failed to delete institution", 500);
      }

      await logAuditAction("DELETE_INSTITUTION", {
        id,
        name: existing.name
      }, userId, clientIp);

      return _success(null, "Institution deleted successfully", 200);
    }

    // ===== BURSARIES =====
    
    // GET ALL
    if (method === "GET" && pathname === "/functions/v1/bursaries" && !url.searchParams.get("q")) {
      const { data, error } = await svc
        .from("universities_bursaries")
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .order("name");

      if (error) {
        console.error(`[${requestId}] GET bursaries error:`, error.message);
        return _error("Failed to fetch bursaries", 500);
      }

      await logAuditAction("VIEW_BURSARIES", {
        count: data?.length || 0
      }, userId, clientIp);

      return _success(data, undefined, 200);
    }

    // GET BY ID
    if (method === "GET" && pathname.match(/^\/functions\/v1\/bursaries\/(\d+)$/)) {
      const idMatch = pathname.match(/^\/functions\/v1\/bursaries\/(\d+)$/);
      const id = parseInt(idMatch![1]);

      const { data, error } = await svc
        .from("universities_bursaries")
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .eq("id", id)
        .single();

      if (error || !data) {
        return _error("Bursary not found", 404);
      }

      await logAuditAction("VIEW_BURSARY", {
        id
      }, userId, clientIp);

      return _success(data, undefined, 200);
    }

    // SEARCH
    if (method === "GET" && pathname === "/functions/v1/bursaries/search") {
      const query = url.searchParams.get("q") || "";
      if (!query.trim()) {
        return _error("Search query required", 400);
      }

      const { data, error } = await svc
        .from("universities_bursaries")
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .ilike("name", `%${query}%`)
        .order("name")
        .limit(50);

      if (error) {
        console.error(`[${requestId}] Bursary search error:`, error.message);
        return _error("Search failed", 500);
      }

      await logAuditAction("SEARCH_BURSARIES", {
        query,
        resultCount: data?.length || 0
      }, userId, clientIp);

      return _success(data, undefined, 200);
    }

    // CREATE
    if (method === "POST" && pathname === "/functions/v1/bursaries") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return _error("Invalid JSON in request body", 400);
      }

      body.table = "universities_bursaries";
      const tableName = getTableName(body);
      if (!tableName) {
        return _error("Invalid or missing 'table' field", 400);
      }

      const validation = validateInstitutionData(body);
      if (!validation.valid) {
        return _error("Validation failed", 400, validation.errors);
      }

      const { name, type, opening_date, closing_date, status, is_private } = body;

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
        console.error(`[${requestId}] POST bursary error:`, error.message);
        return _error("Failed to create bursary", 500);
      }

      await logAuditAction("CREATE_BURSARY", {
        id: data?.[0]?.id,
        name: String(name).trim()
      }, userId, clientIp);

      return _success(data?.[0], "Bursary created successfully", 201);
    }

    // UPDATE
    if (method === "PUT" && pathname.match(/^\/functions\/v1\/bursaries\/(\d+)$/)) {
      const idMatch = pathname.match(/^\/functions\/v1\/bursaries\/(\d+)$/);
      const id = parseInt(idMatch![1]);
      
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return _error("Invalid JSON in request body", 400);
      }

      body.table = "universities_bursaries";
      const tableName = getTableName(body);
      if (!tableName) {
        return _error("Invalid or missing 'table' field", 400);
      }

      const validation = validateInstitutionData(body);
      if (!validation.valid) {
        return _error("Validation failed", 400, validation.errors);
      }

      const { name, type, opening_date, closing_date, status, is_private } = body;

      const { data, error } = await svc
        .from(tableName)
        .update({
          name: String(name).trim(),
          type: String(type).trim(),
          opening_date: opening_date || null,
          closing_date: closing_date || null,
          status: status || "active",
          is_private: is_private || false,
          updated_at: new Date().toISOString()
        })
        .eq("id", id)
        .select();

      if (error) {
        console.error(`[${requestId}] PUT bursary error:`, error.message);
        return _error("Failed to update bursary", 500);
      }

      if (!data || data.length === 0) {
        return _error("Bursary not found", 404);
      }

      await logAuditAction("UPDATE_BURSARY", {
        id,
        name: String(name).trim()
      }, userId, clientIp);

      return _success(data[0], "Bursary updated successfully", 200);
    }

    // DELETE
    if (method === "DELETE" && pathname.match(/^\/functions\/v1\/bursaries\/(\d+)$/)) {
      const idMatch = pathname.match(/^\/functions\/v1\/bursaries\/(\d+)$/);
      const id = parseInt(idMatch![1]);

      const { data: existing } = await svc
        .from("universities_bursaries")
        .select("id, name")
        .eq("id", id)
        .maybeSingle();

      if (!existing) {
        return _error("Bursary not found", 404);
      }

      const { error } = await svc
        .from("universities_bursaries")
        .delete()
        .eq("id", id);

      if (error) {
        console.error(`[${requestId}] DELETE bursary error:`, error.message);
        return _error("Failed to delete bursary", 500);
      }

      await logAuditAction("DELETE_BURSARY", {
        id,
        name: existing.name
      }, userId, clientIp);

      return _success(null, "Bursary deleted successfully", 200);
    }

    // ===== LOCKDOWN ENDPOINTS =====
    if (method === "GET" && pathname === "/functions/v1/lockdown/status") {
      const lockdownStatus = await checkLockdown();
      return _success({ 
        is_active: lockdownStatus.locked,
        message: lockdownStatus.message || null
      }, undefined, 200);
    }

    if (method === "POST" && pathname === "/functions/v1/lockdown/activate") {
      // Already checked auth above
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        body = {};
      }

      const reason = (body.reason as string) || "Emergency lockdown activated by admin";
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      const { data, error } = await svc
        .from("admin_lockdown")
        .insert({
          is_active: true,
          reason: reason,
          expires_at: expiresAt.toISOString(),
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error("Lockdown activation error:", error);
        return _error("Failed to activate lockdown", 500);
      }

      await logAuditAction("LOCKDOWN_ACTIVATED", {
        reason,
        expires_at: expiresAt.toISOString()
      }, userId, clientIp);

      return _success(data, "Emergency lockdown activated successfully", 200);
    }

    if (method === "POST" && pathname === "/functions/v1/lockdown/deactivate") {
      const { data: existing, error: fetchError } = await svc
        .from("admin_lockdown")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1);

      if (fetchError || !existing || existing.length === 0) {
        return _error("No lockdown record found", 404);
      }

      const { error } = await svc
        .from("admin_lockdown")
        .update({ is_active: false })
        .eq("id", existing[0].id);

      if (error) {
        console.error("Lockdown deactivation error:", error);
        return _error("Failed to deactivate lockdown", 500);
      }

      await logAuditAction("LOCKDOWN_DEACTIVATED", {}, userId, clientIp);

      return _success(null, "Lockdown deactivated successfully", 200);
    }

    // ===== 404 - NOT FOUND =====
    return _error("Endpoint not found", 404, {
      available_endpoints: [
        "GET /institutions - List all universities",
        "GET /institutions/{id} - Get single university",
        "GET /institutions/search?q=query - Search universities",
        "POST /institutions - Create university (admin only)",
        "PUT /institutions/{id} - Update university (admin only)",
        "DELETE /institutions/{id} - Delete university (admin only)",
        "GET /bursaries - List all bursaries",
        "GET /bursaries/{id} - Get single bursary",
        "GET /bursaries/search?q=query - Search bursaries",
        "POST /bursaries - Create bursary (admin only)",
        "PUT /bursaries/{id} - Update bursary (admin only)",
        "DELETE /bursaries/{id} - Delete bursary (admin only)",
        "GET /lockdown/status - Check lockdown status",
        "POST /lockdown/activate - Activate lockdown (admin only)",
        "POST /lockdown/deactivate - Deactivate lockdown (admin only)"
      ]
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[${requestId}] Unexpected error:`, errorMessage);
    
    await logAuditAction("ERROR", {
      method,
      path: pathname,
      error: errorMessage
    }, userId, clientIp);

    return _error("Internal server error", 500);
  } finally {
    const duration = Date.now() - startTime;
    console.log(`[${requestId}] Completed in ${duration}ms`);
  }
});