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
    const { userId, svc } = auth;
 
    const rl = await _rateLimit(svc, userId, "user_settings", 30, 60);
    if (rl) return rl;
 
    const body = await req.json().catch(() => ({}));
    const { action, email_notifications } = body;
 
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
             ?? req.headers.get("x-real-ip") ?? "unknown";
 
    // ── GET SETTINGS ──────────────────────────────────────────────────────
    if (action === "get_settings") {
      // Upsert settings row on every login — also updates last_login
      const { data: existing } = await svc
        .from("user_settings").select("*").eq("user_id", userId).maybeSingle();
 
      if (!existing) {
        await svc.from("user_settings").insert({
          user_id: userId, email_notifications: true,
          last_login: new Date().toISOString(), last_login_ip: ip,
        });
      }
      await svc.from("user_settings")
        .update({ last_login: new Date().toISOString(), last_login_ip: ip })
        .eq("user_id", userId);
 
      const { data: settings, error } = await svc
        .from("user_settings").select("*").eq("user_id", userId).single();
      if (error) return _json({ success: false, error: "Failed to load settings" }, 500);
 
      await _log(svc, userId, "user_settings", req, "ok", { action });
      return _json({ success: true, settings });
    }
 
    // ── UPDATE EMAIL NOTIFICATIONS ────────────────────────────────────────
    if (action === "update_email_notifications") {
      if (typeof email_notifications !== "boolean")
        return _json({ error: "email_notifications must be a boolean" }, 400);
      const { error } = await svc.from("user_settings")
        .update({ email_notifications }).eq("user_id", userId);
      if (error) return _json({ success: false, error: "Update failed" }, 500);
      await _log(svc, userId, "user_settings", req, "ok", { action, email_notifications });
      return _json({ success: true });
    }
 
    // ── LOGOUT ALL DEVICES ────────────────────────────────────────────────
    if (action === "logout_all_devices") {
      const { error } = await svc.auth.admin.signOut(userId);
      if (error) return _json({ success: false, error: "Logout failed" }, 500);
      await _log(svc, userId, "user_settings", req, "ok", { action });
      return _json({ success: true });
    }
 
    return _json({ error: "Invalid action" }, 400);
  } catch {
    return _json({ success: false, error: "Server error" }, 500);
  }
});