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
  if (req.method !== "POST") return _json({ error: "Method not allowed" }, 405);
  try {
    const auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId, email, svc } = auth;
 
    // Tight rate limit: 5 attempts per 5 minutes
    const rl = await _rateLimit(svc, userId, "reset_password", 5, 300);
    if (rl) {
      await _log(svc, userId, "reset_password", req, "fail", { reason: "rate_limited" });
      return rl;
    }
 
    const body = await req.json().catch(() => ({}));
    const currentPassword = _clean(body.currentPassword);
    const newPassword     = _clean(body.newPassword);
 
    if (!currentPassword || !newPassword) {
      await _log(svc, userId, "reset_password", req, "fail", { reason: "missing_fields" });
      return _json({ error: "All fields are required." }, 400);
    }
 
    // Verify current password by attempting sign-in
    const { error: loginError } = await svc.auth.signInWithPassword({ email, password: currentPassword });
    if (loginError) {
      await _log(svc, userId, "reset_password", req, "fail", { reason: "wrong_current_password" });
      return _json({ error: "Current password is incorrect." }, 400);
    }
 
    if (currentPassword === newPassword)
      return _json({ error: "New password cannot match the current password." }, 400);
 
    // Password strength
    if (newPassword.length < 8)          return _json({ error: "Password must be at least 8 characters." }, 400);
    if (!/[A-Z]/.test(newPassword))      return _json({ error: "Password must include at least one uppercase letter." }, 400);
    if (!/[0-9]/.test(newPassword))      return _json({ error: "Password must include at least one number." }, 400);
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(newPassword))
      return _json({ error: "Password must include at least one special character." }, 400);
 
    const { error: updateError } = await svc.auth.admin.updateUserById(userId, { password: newPassword });
    if (updateError) {
      await _log(svc, userId, "reset_password", req, "fail", { reason: updateError.message });
      return _json({ error: "Failed to update password." }, 400);
    }
 
    await _log(svc, userId, "reset_password", req, "ok");
    return _json({ message: "Password updated successfully." });
  } catch {
    return _json({ error: "Server error" }, 500);
  }
});