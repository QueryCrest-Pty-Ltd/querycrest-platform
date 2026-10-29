import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Supabase service-role client ──────────────────────────────────────────────
const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── CORS — same origin as every other dashboard function ─────────────────────

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


// ── Auth — Bearer header OR HttpOnly cookie (mirrors every other function) ────
async function _auth(
  req: Request
): Promise<{ userId: string; email: string; svc: ReturnType<typeof _SVC> } | Response> {
  // 1. Try Authorization header (backward-compat for direct API callers)
  let token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();

  // 2. Fall back to the HttpOnly cookie set by login-user
  if (!token) {
    const cookies = req.headers.get("cookie") ?? "";
    const match   = cookies.match(/(?:^|;\s*)access_token=([^;]+)/);
    token         = match?.[1]?.trim();
  }

  if (!token) return _json({ error: "Unauthorized" }, 401,origin);

  const svc = _SVC();
  const { data: { user }, error } = await svc.auth.getUser(token);
  if (error || !user) return _json({ error: "Unauthorized — invalid token" }, 401,origin);

  return { userId: user.id, email: user.email ?? "", svc };
}

// ── Rate limit helper ─────────────────────────────────────────────────────────
async function _rateLimit(
  svc: ReturnType<typeof _SVC>,
  userId: string,
  action: string,
  limit: number,
  windowSec: number
): Promise<Response | null> {
  try {
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const { count } = await svc
      .from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", action)
      .eq("result", "ok")
      .gte("created_at", since);
    if ((count ?? 0) >= limit)
      return _json({ error: "Too many requests. Please wait before trying again." }, 429,origin);
  } catch { /* non-blocking */ }
  return null;
}

// ── Audit log helper ──────────────────────────────────────────────────────────
async function _log(
  svc: ReturnType<typeof _SVC>,
  userId: string | null,
  action: string,
  req: Request,
  result: "ok" | "fail",
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    await svc.from("audit_log").insert({
      user_id:    userId,
      action,
      ip_address: ip,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 200),
      result,
      meta,
    });
  } catch { /* never crash a function because logging failed */ }
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  origin = req.headers.get("origin");  
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "GET")     return _json({ error: "Method not allowed" }, 405,origin);

  try {
    // Authenticate — same gate as every other dashboard endpoint
    const auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId, svc } = auth;

    // Rate limit — 120 reads per minute per user (generous; it's just a list)
    const rl = await _rateLimit(svc, userId, "view_accommodations", 120, 60);
    if (rl) return rl;

    // Parse query params
    const url    = new URL(req.url);
    const uni    = url.searchParams.get("university")?.trim() ?? "";
    const limit  = Math.min(Math.max(parseInt(url.searchParams.get("limit")  ?? "20"), 1), 50);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0"), 0);

    // Query accommodations table — active listings only
    let query = svc
      .from("accommodations")
      .select(
        "id, name, university_name, address, price_min, price_max, " +
        "room_types, cover_image, description, opening_date, closing_date, apply_url",
        { count: "exact" }
      )
      .eq("status", "active")
      .order("closing_date", { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (uni) query = query.ilike("university_name", `%${uni}%`);

    const { data, error, count } = await query;
    if (error) {
      console.error("[get-accommodations]", error);
      await _log(svc, userId, "view_accommodations", req, "fail", { error: error.message });
      return _json({ error: "Failed to fetch accommodations." }, 500,origin);
    }

    await _log(svc, userId, "view_accommodations", req, "ok", {
      count:  count ?? 0,
      offset,
      limit,
      filter: uni || null,
    });

    return _json({
      accommodations: data ?? [],
      total:   count ?? 0,
      limit,
      offset,
      hasMore: (count ?? 0) > offset + limit,
    },200,origin);

  } catch (err) {
    console.error("[get-accommodations] unhandled:", err);
    return _json({ error: "Server error" }, 500,origin);
  }
});