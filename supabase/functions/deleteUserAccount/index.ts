import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
 
const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const CORS = {
  "Access-Control-Allow-Origin":  "https://www.querycrest.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Max-Age":       "86400",
};
function _json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
async function _auth(req: Request): Promise<{ userId: string; email: string; svc: ReturnType<typeof _SVC> } | Response> {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
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
 
    // 3 attempts max per hour — deletion is irreversible
    const rl = await _rateLimit(svc, userId, "delete_account", 3, 3600);
    if (rl) return rl;
 
    // Log BEFORE deletion so the record survives
    await _log(svc, userId, "delete_account", req, "ok", { email });
 
    // Sign out all active sessions first
    await svc.auth.admin.signOut(userId).catch(() => {});
 
    // Cascade deletes on FK constraints handle child rows automatically.
    // Only explicitly delete what does NOT have ON DELETE CASCADE.
    await svc.from("user_application_limits").delete().eq("user_id", userId).catch(() => {});
 
    // Delete auth user — this cascades to public.users via FK
    const { error } = await svc.auth.admin.deleteUser(userId);
    if (error) return _json({ success: false, error: "Failed to delete account." }, 500);
 
    return _json({ success: true, message: "Account deleted successfully." });
  } catch {
    return _json({ success: false, error: "Server error" }, 500);
  }
});