import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
 
const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const CORS = {
  "Access-Control-Allow-Origin":      "https://www.querycrest.com",
  "Access-Control-Allow-Headers":     "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":     "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Max-Age":           "86400",
  "Access-Control-Allow-Credentials": "true",
};
function _json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
async function _auth(req: Request): Promise<{ userId: string; email: string; svc: ReturnType<typeof _SVC> } | Response> {
  // 1. Try the Authorization header (backward-compat for any direct API callers)
  let token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
 
  // 2. Fall back to the HttpOnly cookie set by login-user
  //    JavaScript on the client can never read this value — only the browser
  //    and this server-side code can see it.
  if (!token) {
    const cookies = req.headers.get("cookie") ?? "";
    const match   = cookies.match(/(?:^|;\s*)access_token=([^;]+)/);
    token         = match?.[1]?.trim();
  }
 
  if (!token) return _json({ error: "Unauthorized" }, 401);
 
  const svc = _SVC();
  const { data: { user }, error } = await svc.auth.getUser(token);
  if (error || !user) return _json({ error: "Unauthorized — invalid token" }, 401);
  return { userId: user.id, email: user.email ?? "", svc };
}
async function _rateLimit(
  svc: ReturnType<typeof _SVC>, userId: string,
  action: string, limit: number, windowSec: number
): Promise<Response | null> {
  try {
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const { count } = await svc.from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId).eq("action", action).eq("result", "ok")
      .gte("created_at", since);
    if ((count ?? 0) >= limit)
      return _json({ error: "Too many requests. Please wait before trying again." }, 429);
  } catch { /* non-blocking */ }
  return null;
}
async function _log(
  svc: ReturnType<typeof _SVC>, userId: string | null,
  action: string, req: Request, result: "ok" | "fail",
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
             ?? req.headers.get("x-real-ip") ?? "unknown";
    await svc.from("audit_log").insert({
      user_id: userId, action,
      ip_address: ip,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 200),
      result, meta,
    });
  } catch { /* never crash a function because logging failed */ }
}
function _clean(val: unknown, maxLen = 500): string {
  if (val == null) return "";
  return String(val)
    .replace(/<[^>]*>/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim()
    .slice(0, maxLen);
}
 
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return _json({ status: "error", message: "Method not allowed" }, 405);
  try {
    const auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId, svc } = auth;
 
    const rl = await _rateLimit(svc, userId, "add_kin", 10, 60);
    if (rl) return rl;
 
    const body = await req.json().catch(() => ({}));
    const first_name   = _clean(body.first_name,  100);
    const last_name    = _clean(body.last_name,   100);
    const relationship = _clean(body.relationship,100);
    const email        = _clean(body.email,       200).toLowerCase();
    const phone        = _clean(body.phone,        30);
 
    if (!first_name || !last_name || !relationship || !email || !phone)
      return _json({ status: "error", message: "All fields are required" }, 400);
 
    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return _json({ status: "error", message: "Invalid email address" }, 400);
 
    // Enforce max 2 per user — server-side check (matches UI limit)
    const { count: existing } = await svc
      .from("next_of_kin")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((existing ?? 0) >= 2)
      return _json({ status: "error", message: "Maximum of 2 next of kin allowed" }, 400);
 
    const { error } = await svc.from("next_of_kin").insert([{
      user_id: userId, first_name, last_name, relationship, email, phone,
    }]);
    if (error) {
      await _log(svc, userId, "add_kin", req, "fail", { reason: error.message });
      return _json({ status: "error", message: "Failed to add next of kin" }, 500);
    }
 
    await _log(svc, userId, "add_kin", req, "ok");
    return _json({ status: "success" });
  } catch {
    return _json({ status: "error", message: "Server error" }, 500);
  }
});