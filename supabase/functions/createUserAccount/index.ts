import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
 
// ── Inline security layer ────────────────────────────────────────────────────
const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);
const CORS = {
  "Access-Control-Allow-Origin":      "https://www.querycrest.com",
  "Access-Control-Allow-Headers":     "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":     "POST, OPTIONS",
  "Access-Control-Max-Age":           "86400",
  "Access-Control-Allow-Credentials": "true",
};
function _json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
// Rate limit by IP — no userId exists yet at registration time
async function _ipRateLimit(
  svc: ReturnType<typeof _SVC>,
  ip: string,
  action: string,
  limit: number,
  windowSec: number
): Promise<Response | null> {
  try {
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const { count } = await svc.from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", ip).eq("action", action)
      .gte("created_at", since);
    if ((count ?? 0) >= limit)
      return _json({ error: "Too many attempts from this IP. Please wait before trying again." }, 429);
  } catch { /* non-blocking */ }
  return null;
}
async function _log(
  svc: ReturnType<typeof _SVC>,
  userId: string | null,
  action: string,
  req: Request,
  result: "ok" | "fail",
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
             ?? req.headers.get("x-real-ip") ?? "unknown";
    await svc.from("audit_log").insert({
      user_id:    userId,
      action,
      ip_address: ip,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 200),
      result,
      meta,
    });
  } catch { /* never crash on log failure */ }
}
function _clean(val: unknown, maxLen = 200): string {
  if (val == null) return "";
  return String(val).replace(/<[^>]*>/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim().slice(0, maxLen);
}
// ── End security layer ───────────────────────────────────────────────────────
 
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")    return _json({ error: "Method not allowed" }, 405);
 
  const svc = _SVC();
  const ip  = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? req.headers.get("x-real-ip") ?? "unknown";
 
  try {
    // ── IP rate limit: 10 registrations per hour per IP ──────────────────
    // This is the primary defence against account-farming bots
    const rl = await _ipRateLimit(svc, ip, "register", 10, 3600);
    if (rl) {
      await _log(svc, null, "register", req, "fail", { reason: "ip_rate_limited", ip });
      return rl;
    }
 
    // ── Parse & sanitise input ────────────────────────────────────────────
    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return _json({ error: "Invalid JSON body" }, 400); }
 
    const firstName      = _clean(body.firstName,    100);
    const lastName       = _clean(body.lastName,     100);
    const email          = _clean(body.email,        254).toLowerCase();
    const password       = String(body.password       ?? "");
    const confirmPassword= String(body.confirmPassword ?? "");
    const phone          = _clean(body.phone,         30);
    const referral_code  = _clean(body.referral_code, 20).toUpperCase();
 
    // ── Field validation ──────────────────────────────────────────────────
    if (!firstName || !lastName)
      return _json({ error: "First and last name are required." }, 400);
    if (!email)
      return _json({ error: "Email is required." }, 400);
 
    // RFC-5321 email format check
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email))
      return _json({ error: "Invalid email address." }, 400);
 
    if (!phone)
      return _json({ error: "Phone number is required." }, 400);
    // Basic phone sanity: digits, spaces, +, -, () only
    if (!/^[\d\s+\-().]{7,20}$/.test(phone))
      return _json({ error: "Invalid phone number." }, 400);
 
    if (!password || password.length < 8)
      return _json({ error: "Password must be at least 8 characters." }, 400);
    if (password !== confirmPassword)
      return _json({ error: "Passwords do not match." }, 400);
 
    // Password strength — same rules as resetPassword
    if (!/[A-Z]/.test(password))
      return _json({ error: "Password must include at least one uppercase letter." }, 400);
    if (!/[0-9]/.test(password))
      return _json({ error: "Password must include at least one number." }, 400);
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password))
      return _json({ error: "Password must include at least one special character." }, 400);
 
    // ── Create auth user (admin.createUser = no session switch) ──────────
    const { data: createData, error: createErr } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });
 
    if (createErr) {
      const msg = createErr.message ?? "Could not create account";
      await _log(svc, null, "register", req, "fail", { reason: msg, email });
 
      // Return a consistent error — do NOT confirm whether an email exists
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered"))
        return _json({ error: "AuthApiError: User already registered" }, 409);
      if (msg.toLowerCase().includes("invalid email"))
        return _json({ error: "AuthApiError: Invalid email" }, 400);
      return _json({ error: msg }, 400);
    }
 
    const newUserId = createData.user?.id;
    if (!newUserId) return _json({ error: "Account creation failed — no ID returned" }, 500);
 
    // ── Insert into public.users ──────────────────────────────────────────
    const { error: userErr } = await svc.from("users").insert([{
      id:         newUserId,
      first_name: firstName,
      last_name:  lastName,
      email,
      phone,
      role: ["user", "affiliate"],
    }]);
 
    if (userErr) {
      // Rollback the auth user so no orphaned auth rows exist
      await svc.auth.admin.deleteUser(newUserId).catch(() => {});
      await _log(svc, newUserId, "register", req, "fail",
        { reason: "profile_insert_failed: " + userErr.message });
      return _json({ error: "Failed to create user profile." }, 500);
    }
 
    // ── Record referral if code provided ──────────────────────────────────
    let referralRecorded = false;
    if (referral_code) {
      try {
        const { data: referrer } = await svc
          .from("users").select("id").eq("referral_code", referral_code).maybeSingle();
 
        if (referrer && referrer.id !== newUserId) {
          const { error: rpcErr } = await svc.rpc("record_signup_commission", {
            p_referrer_id:    referrer.id,
            p_referred_id:    newUserId,
            p_referred_email: email,
          });
          if (!rpcErr) referralRecorded = true;
        }
      } catch (e: any) {
        // Referral failure must NEVER block account creation
        await _log(svc, newUserId, "register", req, "fail",
          { reason: "referral_failed: " + e.message, non_blocking: true });
      }
    }
 
    await _log(svc, newUserId, "register", req, "ok",
      { referral_recorded: referralRecorded });
 
    return _json({ success: true, user_id: newUserId, referral_recorded: referralRecorded });
 
  } catch (err: any) {
    await _log(svc, null, "register", req, "fail",
      { reason: err?.message ?? "unhandled_exception" });
    return _json({ error: "Server error" }, 500);
  }
});