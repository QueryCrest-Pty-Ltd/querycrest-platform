import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);


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



async function _auth(req: Request): Promise<{ userId: string; email: string; svc: ReturnType<typeof _SVC> } | Response> {
  let token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
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

async function encryptPassword(pw: string): Promise<string> {
  const keyHex = Deno.env.get("PORTAL_PASSWORD_ENCRYPTION_KEY") ?? "";
  if (keyHex.length < 64)
    throw new Error("PORTAL_PASSWORD_ENCRYPTION_KEY not configured (need 32-byte hex)");
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++)
    keyBytes[i] = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
  const k  = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(pw));
  const combined = new Uint8Array(12 + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), 12);
  return btoa(String.fromCharCode(...combined));
}

Deno.serve(async (req) => {
  origin = req.headers.get("origin");  
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return _json({ error: "Method not allowed" }, 405,origin);
  try {
    const auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId, svc } = auth;

    const rl = await _rateLimit(svc, userId, "submit_application", 10, 60);
    if (rl) return rl;

    const body = await req.json().catch(() => ({}));
    const {
      university_name, university_id, programs, course_codes,
      has_applied_before, attempt_type, accepted_policy,
      student_number, portal_pin, portal_password,
    } = body;

    // ── Validate ──────────────────────────────────────────────────────────
    if (!university_name || typeof university_name !== "string")
      return _json({ error: "university_name is required" }, 400,origin);
    if (!Array.isArray(programs) || programs.length === 0)
      return _json({ error: "At least one program is required" }, 400,origin);
    if (!Array.isArray(course_codes) || course_codes.length === 0)
      return _json({ error: "At least one course code is required" }, 400,origin);
    if (accepted_policy !== true)
      return _json({ error: "You must accept the Privacy Policy" }, 400,origin);
    if (!["first_time", "second_time"].includes(attempt_type))
      return _json({ error: "Invalid attempt_type" }, 400,origin);
    if (has_applied_before === true) {
      if (!student_number) return _json({ error: "student_number required for returning students" }, 400,origin);
      if (!portal_pin)     return _json({ error: "portal_pin required for returning students" }, 400,origin);
      if (!portal_password)return _json({ error: "portal_password required for returning students" }, 400,origin);
    }

    // ── Sanitise ──────────────────────────────────────────────────────────
    const cleanUni      = _clean(university_name, 200);
    const cleanPrograms = (programs   as string[]).map(p => _clean(p, 200)).filter(Boolean);
    const cleanCodes    = (course_codes as string[]).map(c => _clean(c, 50).toUpperCase()).filter(Boolean);
    if (!cleanPrograms.length || !cleanCodes.length)
      return _json({ error: "Programs or codes are empty after validation" }, 400,origin);

    // ── Plan check — NO free applications ────────────────────────────────
    //
    // totalAllowed = total application slots purchased across all plans.
    // There is NO free slot. A user with zero purchases is blocked entirely.
    //
    const [{ count: used }, { data: planRows }] = await Promise.all([
      svc.from("applications")
         .select("*", { count: "exact", head: true })
         .eq("user_id", userId),
      svc.from("user_plans")
         .select("applications_added")
         .eq("user_id", userId),
    ]);

    const totalAllowed = (planRows ?? []).reduce(
      (sum: number, row: any) => sum + (row.applications_added || 0), 0
    );

    // No plan at all
    if (totalAllowed === 0) {
      await _log(svc, userId, "submit_application", req, "fail", {
        reason: "no_plan_purchased",
        university_name: cleanUni,
      });
      return _json({
        error: "You need a plan to submit an application. Please purchase a plan to continue.",
        upgrade_required: true,
      }, 403,origin);
    }

    // Plan exists but all slots used
    if ((used ?? 0) >= totalAllowed) {
      await _log(svc, userId, "submit_application", req, "fail", {
        reason: "limit_reached",
        used,
        total_allowed: totalAllowed,
        university_name: cleanUni,
      });
      return _json({
        error: `You have used all ${totalAllowed} application slot${totalAllowed === 1 ? "" : "s"} on your current plan. Upgrade to submit more applications.`,
        upgrade_required: true,
        used,
        total_allowed: totalAllowed,
      }, 403,origin);
    }

    // ── Resolve logo ──────────────────────────────────────────────────────
    let logo_url: string | null = null;
    if (university_id && typeof university_id === "string") {
      const { data: u } = await svc.from("universities")
        .select("logo_url").eq("id", university_id).single();
      logo_url = u?.logo_url ?? null;
    }
    if (!logo_url) {
      const { data: u } = await svc.from("universities")
        .select("logo_url").ilike("name", `%${cleanUni}%`).limit(1).single();
      logo_url = u?.logo_url ?? null;
    }

    // ── Encrypt portal password ───────────────────────────────────────────
    let portal_password_encrypted: string | null = null;
    if (has_applied_before === true && typeof portal_password === "string")
      portal_password_encrypted = await encryptPassword(portal_password.trim());

    // ── Build record ──────────────────────────────────────────────────────
    const record: Record<string, unknown> = {
      user_id:            userId,
      university_name:    cleanUni,
      programs:           cleanPrograms,
      course_codes:       cleanCodes,
      has_applied_before: has_applied_before === true,
      attempt_type,
      accepted_policy:    true,
      status:             "Outstanding Documents",
    };
    if (has_applied_before === true) {
      record.student_number            = _clean(student_number, 50);
      record.portal_pin                = _clean(portal_pin,     50);
      record.portal_password_encrypted = portal_password_encrypted;
    }

    const { data: inserted, error: insertError } = await svc
      .from("applications").insert([record]).select().single();
    if (insertError) {
      await _log(svc, userId, "submit_application", req, "fail",
        { reason: insertError.message });
      return _json({ error: insertError.message }, 400,origin);
    }

    await _log(svc, userId, "submit_application", req, "ok", {
      university_name: cleanUni, attempt_type,
    });
    return _json({
      success:                true,
      application:            inserted,
      logo_url,
      remaining_applications: totalAllowed - (used ?? 0) - 1,
    },200,origin);
  } catch (err: any) {
    return _json({ error: err?.message ?? "Server error" }, 400,origin);
  }
});