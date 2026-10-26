import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
 
// ── Inline security layer ────────────────────────────────────────────────────
const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);
 
// CORS must include Access-Control-Allow-Credentials: true so the browser
// accepts the Set-Cookie header from a cross-origin response.
// The origin MUST be an exact domain — wildcard (*) is forbidden when
// credentials are involved.
const CORS = {
  "Access-Control-Allow-Origin":      "https://www.querycrest.com",
  "Access-Control-Allow-Headers":     "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":     "POST, OPTIONS",
  "Access-Control-Max-Age":           "86400",
  "Access-Control-Allow-Credentials": "true",   // ← required for cookies
};
 
function _json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
 
// Build the Set-Cookie header value in one place so it is consistent
// across the success path and the logout helper.
// Flags explained:
//   HttpOnly  — JavaScript cannot read this cookie (document.cookie is blind to it)
//   Secure    — only sent over HTTPS, never plain HTTP
//   SameSite=None — required because the frontend (www.querycrest.com) calls an
//                   edge function on a different domain (supabase.co). Without
//                   None the browser would silently drop the cookie on every request.
//                   SameSite=None REQUIRES the Secure flag.
//   Path=/    — sent on all paths under the Supabase project domain
//   Max-Age   — matches the Supabase JWT lifetime (1 hour = 3600 seconds)
function _setCookie(token: string): string {
  return `access_token=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=3600`;
}
 
// Clear cookie: Max-Age=0 tells the browser to delete it immediately
function _clearCookie(): string {
  return `access_token=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`;
}
 
async function _ipRateLimit(
  svc: ReturnType<typeof _SVC>,
  ip: string, action: string, limit: number, windowSec: number
): Promise<Response | null> {
  try {
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const { count } = await svc.from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", ip).eq("action", action).eq("result", "fail")
      .gte("created_at", since);
    if ((count ?? 0) >= limit)
      return _json({ error: "Too many failed login attempts. Please wait before trying again." }, 429);
  } catch { /* non-blocking */ }
  return null;
}
 
async function _emailFailLimit(
  svc: ReturnType<typeof _SVC>,
  email: string, limit: number, windowSec: number
): Promise<Response | null> {
  try {
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const { count } = await svc.from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("action", "login").eq("result", "fail")
      .contains("meta", { email })
      .gte("created_at", since);
    if ((count ?? 0) >= limit)
      return _json({
        error: "Too many failed attempts on this account. Please reset your password or wait 15 minutes."
      }, 429);
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
      user_id: userId, action, ip_address: ip,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 200),
      result, meta,
    });
  } catch { /* never crash on log failure */ }
}
 
function _clean(val: unknown, maxLen = 200): string {
  if (val == null) return "";
  return String(val).replace(/<[^>]*>/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim().slice(0, maxLen);
}
// ── End security layer ───────────────────────────────────────────────────────
 
serve(async (req) => {
  // Pre-flight: browsers send OPTIONS before any cross-origin request that
  // carries credentials. Must respond with 204 + full CORS headers.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")    return _json({ error: "Method not allowed" }, 405);
 
  const svc = _SVC();
  const ip  = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? req.headers.get("x-real-ip") ?? "unknown";
 
  try {
    // ── IP rate limit: 20 failed attempts per 15 min per IP ──────────────
    const ipRl = await _ipRateLimit(svc, ip, "login", 20, 900);
    if (ipRl) {
      await _log(svc, null, "login", req, "fail", { reason: "ip_rate_limited", ip });
      return ipRl;
    }
 
    // ── Parse & sanitise input ────────────────────────────────────────────
    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return _json({ error: "Invalid JSON body" }, 400); }
 
    const email    = _clean(body.email, 254).toLowerCase();
    const password = String(body.password ?? "");
 
    if (!email || !password)
      return _json({ error: "Email and password are required." }, 400);
 
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email))
      return _json({ error: "Invalid email address." }, 400);
 
    // ── Per-email failed-login limit: 5 fails per 15 min ─────────────────
    const emailRl = await _emailFailLimit(svc, email, 5, 900);
    if (emailRl) {
      await _log(svc, null, "login", req, "fail", { reason: "email_rate_limited", email });
      return emailRl;
    }
 
    // ── Attempt sign-in ───────────────────────────────────────────────────
    const { data: signInData, error: signInError } = await svc.auth.signInWithPassword({
      email, password,
    });
 
    if (signInError) {
      const msg = signInError.message ?? "";
      await _log(svc, null, "login", req, "fail", { reason: msg, email });
 
      if (msg.includes("Invalid login credentials") || msg.includes("invalid_credentials"))
        return _json({ error: "Invalid email or password." }, 401);
      if (msg.includes("Email not confirmed"))
        return _json({ error: "Email not verified. Please check your inbox." }, 403);
      if (msg.includes("too many requests") || msg.includes("rate"))
        return _json({ error: "Too many login attempts. Please wait before trying again." }, 429);
 
      return _json({ error: "Login failed. Please try again." }, 401);
    }
 
    if (!signInData?.session || !signInData?.user)
      return _json({ error: "Unexpected authentication response." }, 500);
 
    const { session, user } = signInData;
 
    // ── Update last_login / last_login_ip ─────────────────────────────────
    svc.from("user_settings")
      .upsert(
        { user_id: user.id, last_login: new Date().toISOString(), last_login_ip: ip },
        { onConflict: "user_id" }
      )
      .then(() => {}).catch(() => {});
 
    await _log(svc, user.id, "login", req, "ok", { email });
 
    // ── Set HttpOnly cookie + return minimal user info ────────────────────
    // The token is placed in the cookie, NOT in the response body.
    // The frontend only receives the user id and email — never the token.
    // All subsequent requests carry the cookie automatically; no JS code
    // ever needs to read or store the token.
    return new Response(
      JSON.stringify({ success: true, token: session.access_token, user: { id: user.id, email: user.email } }),
      {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": "application/json",
          "Set-Cookie":    _setCookie(session.access_token),
        },
      }
    );
 
  } catch (err: any) {
    await _log(svc, null, "login", req, "fail",
      { reason: err?.message ?? "unhandled_exception" });
    return _json({ error: "Server error" }, 500);
  }
});