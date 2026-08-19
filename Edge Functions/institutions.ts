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
    return true; // Lockdown is active
  }

  // Lockdown expired — clear it
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
    // ===== UNIVERSITIES ENDPOINTS =====

    // GET /institutions — list all universities
    if (method === "GET" && url.pathname === "/functions/v1/institutions") {
      const { data, error } = await svc
        .from("universities")
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .order("name");

      if (error) {
        console.error("institutions: GET all error", error.message);
        return _json({ error: "Failed to fetch institutions" }, 500);
      }

      await logAuditAction("VIEW_INSTITUTIONS", { count: data?.length || 0 });
      return _json({ data });
    }

    // GET /institutions/:id — get single university
    if (method === "GET" && url.pathname.match(/^\/functions\/v1\/institutions\/\d+$/)) {
      const id = parseInt(url.pathname.split("/").pop()!);
      const { data, error } = await svc
        .from("universities")
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .eq("id", id)
        .single();

      if (error || !data) {
        return _json({ error: "Institution not found" }, 404);
      }

      await logAuditAction("VIEW_INSTITUTION", { id });
      return _json({ data });
    }

    // GET /institutions/search?q=... — search universities by name
    if (method === "GET" && url.pathname === "/functions/v1/institutions/search") {
      const query = url.searchParams.get("q") || "";
      if (!query.trim()) {
        return _json({ error: "Search query required" }, 400);
      }

      const { data, error } = await svc
        .from("universities")
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .ilike("name", `%${query}%`)
        .order("name");

      if (error) {
        console.error("institutions: search error", error.message);
        return _json({ error: "Search failed" }, 500);
      }

      await logAuditAction("SEARCH_INSTITUTIONS", { query });
      return _json({ data });
    }

    // POST /institutions — create new university
    if (method === "POST" && url.pathname === "/functions/v1/institutions") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return _json({ error: "Invalid request body" }, 400);
      }

      const { name, type, opening_date, closing_date, status, is_private } = body;

      if (!name || !type) {
        return _json({ error: "Name and type are required" }, 400);
      }

      const { data, error } = await svc
        .from("universities")
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
        console.error("institutions: POST error", error.message);
        return _json({ error: "Failed to create institution" }, 500);
      }

      await logAuditAction("CREATE_INSTITUTION", { id: data?.[0]?.id, name });
      return _json({ data: data?.[0], message: "Institution created" }, 201);
    }

    // PUT /institutions/:id — update university
    if (method === "PUT" && url.pathname.match(/^\/functions\/v1\/institutions\/\d+$/)) {
      const id = parseInt(url.pathname.split("/").pop()!);
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return _json({ error: "Invalid request body" }, 400);
      }

      const { name, type, opening_date, closing_date, status, is_private } = body;

      if (!name || !type) {
        return _json({ error: "Name and type are required" }, 400);
      }

      const { data, error } = await svc
        .from("universities")
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
        console.error("institutions: PUT error", error.message);
        return _json({ error: "Failed to update institution" }, 500);
      }

      if (!data || data.length === 0) {
        return _json({ error: "Institution not found" }, 404);
      }

      await logAuditAction("UPDATE_INSTITUTION", { id, name });
      return _json({ data: data[0], message: "Institution updated" });
    }

    // DELETE /institutions/:id — delete university
    if (method === "DELETE" && url.pathname.match(/^\/functions\/v1\/institutions\/\d+$/)) {
      const id = parseInt(url.pathname.split("/").pop()!);

      const { error } = await svc.from("universities").delete().eq("id", id);

      if (error) {
        console.error("institutions: DELETE error", error.message);
        return _json({ error: "Failed to delete institution" }, 500);
      }

      await logAuditAction("DELETE_INSTITUTION", { id });
      return _json({ message: "Institution deleted" });
    }

    // ===== BURSARIES ENDPOINTS =====

    // GET /bursaries — list all bursaries
    if (method === "GET" && url.pathname === "/functions/v1/bursaries") {
      const { data, error } = await svc
        .from("universities_bursaries")
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .order("name");

      if (error) {
        console.error("bursaries: GET all error", error.message);
        return _json({ error: "Failed to fetch bursaries" }, 500);
      }

      await logAuditAction("VIEW_BURSARIES", { count: data?.length || 0 });
      return _json({ data });
    }

    // GET /bursaries/:id — get single bursary
    if (method === "GET" && url.pathname.match(/^\/functions\/v1\/bursaries\/\d+$/)) {
      const id = parseInt(url.pathname.split("/").pop()!);
      const { data, error } = await svc
        .from("universities_bursaries")
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .eq("id", id)
        .single();

      if (error || !data) {
        return _json({ error: "Bursary not found" }, 404);
      }

      await logAuditAction("VIEW_BURSARY", { id });
      return _json({ data });
    }

    // GET /bursaries/search?q=... — search bursaries by name
    if (method === "GET" && url.pathname === "/functions/v1/bursaries/search") {
      const query = url.searchParams.get("q") || "";
      if (!query.trim()) {
        return _json({ error: "Search query required" }, 400);
      }

      const { data, error } = await svc
        .from("universities_bursaries")
        .select("id, name, type, opening_date, closing_date, status, is_private")
        .ilike("name", `%${query}%`)
        .order("name");

      if (error) {
        console.error("bursaries: search error", error.message);
        return _json({ error: "Search failed" }, 500);
      }

      await logAuditAction("SEARCH_BURSARIES", { query });
      return _json({ data });
    }

    // POST /bursaries — create new bursary
    if (method === "POST" && url.pathname === "/functions/v1/bursaries") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return _json({ error: "Invalid request body" }, 400);
      }

      const { name, type, opening_date, closing_date, status, is_private } = body;

      if (!name || !type) {
        return _json({ error: "Name and type are required" }, 400);
      }

      const { data, error } = await svc
        .from("universities_bursaries")
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
        console.error("bursaries: POST error", error.message);
        return _json({ error: "Failed to create bursary" }, 500);
      }

      await logAuditAction("CREATE_BURSARY", { id: data?.[0]?.id, name });
      return _json({ data: data?.[0], message: "Bursary created" }, 201);
    }

    // PUT /bursaries/:id — update bursary
    if (method === "PUT" && url.pathname.match(/^\/functions\/v1\/bursaries\/\d+$/)) {
      const id = parseInt(url.pathname.split("/").pop()!);
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return _json({ error: "Invalid request body" }, 400);
      }

      const { name, type, opening_date, closing_date, status, is_private } = body;

      if (!name || !type) {
        return _json({ error: "Name and type are required" }, 400);
      }

      const { data, error } = await svc
        .from("universities_bursaries")
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
        console.error("bursaries: PUT error", error.message);
        return _json({ error: "Failed to update bursary" }, 500);
      }

      if (!data || data.length === 0) {
        return _json({ error: "Bursary not found" }, 404);
      }

      await logAuditAction("UPDATE_BURSARY", { id, name });
      return _json({ data: data[0], message: "Bursary updated" });
    }

    // DELETE /bursaries/:id — delete bursary
    if (method === "DELETE" && url.pathname.match(/^\/functions\/v1\/bursaries\/\d+$/)) {
      const id = parseInt(url.pathname.split("/").pop()!);

      const { error } = await svc.from("universities_bursaries").delete().eq("id", id);

      if (error) {
        console.error("bursaries: DELETE error", error.message);
        return _json({ error: "Failed to delete bursary" }, 500);
      }

      await logAuditAction("DELETE_BURSARY", { id });
      return _json({ message: "Bursary deleted" });
    }

    return _json({ error: "Endpoint not found" }, 404);
  } catch (err) {
    console.error("institutions: unexpected error", err instanceof Error ? err.message : err);
    return _json({ error: "Server error" }, 500);
  }
});