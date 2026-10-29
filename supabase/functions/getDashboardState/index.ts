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
      return _json({ error: "Too many requests. Please wait before trying again." }, 429,origin);
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
  origin = req.headers.get("origin"); 
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  try {
    const auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId, svc } = auth;
 
    const rl = await _rateLimit(svc, userId, "get_dashboard_state", 30, 60);
    if (rl) return rl;
 
    // Fetch everything in parallel — one round-trip to the DB
    const [
      { data: user },
      { data: docs },
      { data: apps },
      { count: kinCount },
      { data: address },
      { data: planRows },
      { count: notifTotal },
      { count: notifUnread },
      { count: usedApps },
    ] = await Promise.all([
      svc.from("users").select("first_name, last_name, email, phone").eq("id", userId).maybeSingle(),
      svc.from("documents").select("document_type").eq("user_id", userId),
      svc.from("applications")
         .select("id, university_name, status, created_at")
         .eq("user_id", userId)
         .order("created_at", { ascending: false })
         .limit(3),
      svc.from("next_of_kin").select("*", { count: "exact", head: true }).eq("user_id", userId),
      svc.from("user_addresses").select("street_address").eq("user_id", userId).maybeSingle(),
      svc.from("user_plans").select("applications_added, plans(plan_name)").eq("user_id", userId),
      svc.from("notifications").select("*", { count: "exact", head: true }).eq("user_id", userId),
      svc.from("notifications").select("*", { count: "exact", head: true }).eq("user_id", userId).neq("status", "read"),
      svc.from("applications").select("*", { count: "exact", head: true }).eq("user_id", userId),
    ]);
 
    // ── Plan computation ──────────────────────────────────────────────────
    const purchased = (planRows ?? []).reduce((s: number, p: any) => s + (p.applications_added || 0), 0);
    const planNames  = (planRows ?? []).map((p: any) => p.plans?.plan_name).filter(Boolean);
    const planName   = planNames.length > 0 ? planNames[planNames.length - 1] : "No Plan";
    const hasPlan    = planNames.length > 0;
    const totalApps  = purchased;
    const used       = usedApps ?? 0;
    const remaining  = Math.max(0, totalApps - used);
    const usedPct    = totalApps > 0 ? Math.round((used / totalApps) * 100) : 0;
 
    // ── Document type detection (server-side) ─────────────────────────────
    const docTypes = (docs ?? []).map((d: any) => (d.document_type || "").toLowerCase().trim());
    const hasId       = docTypes.some((t: string) => t === "id" || t === "passport" || t.includes("identity"));
    const hasResults  = docTypes.some((t: string) => ["grade 11 results","grade 12 results","transcript"].includes(t) || t.includes("matric"));
    const hasResidence= docTypes.some((t: string) => t === "proof of residence" || t.includes("proof of res") || t.includes("residence"));
 
    // ── Profile & state flags ─────────────────────────────────────────────
    const hasProfile = !!(user?.first_name?.trim() && user?.last_name?.trim() && user?.phone?.trim());
    const hasAddress = !!(address?.street_address);
    const hasKin     = (kinCount ?? 0) > 0;
    const hasApp     = (apps ?? []).length > 0;
 
    const missingDocs: string[] = [];
    if (!hasId)       missingDocs.push("ID or Passport");
    if (!hasResults)  missingDocs.push("Grade 11 or 12 Results");
    if (!hasResidence)missingDocs.push("Proof of Residence");
 
    // ── Checklist ─────────────────────────────────────────────────────────
    const checklist = [
      { label: "Submit at least one application", done: hasApp,        page: "applications" },
      { label: "Upload your ID or Passport",      done: hasId,         page: "documents"    },
      { label: "Upload Grade 11 or 12 Results",   done: hasResults,    page: "documents"    },
      { label: "Upload Proof of Residence",       done: hasResidence,  page: "documents"    },
      { label: "Add a Next of Kin contact",       done: hasKin,        page: "nextOfKin"    },
      { label: "Complete your profile",           done: hasProfile,    page: "profile"      },
    ];
 
    // ── Banners (max 2: 1 docs + 1 action) ───────────────────────────────
    const banners: any[] = [];
    if (missingDocs.length > 0) {
      banners.push({
        type: "danger",
        title: "Documents required before universities can process your application",
        missingDocs,
        link: "documents",
        cta: "Upload Documents →",
      });
    }
    let otherBanner: any = null;
    if (!hasApp)          otherBanner = { type: "info", title: "Submit your first application",    body: "Add a university application to get started.",    link: "applications", cta: "Add Application →"  };
    else if (!hasKin)     otherBanner = { type: "warn", title: "Add a Next of Kin contact",         body: "Required for emergency contact purposes.",         link: "nextOfKin",    cta: "Add Next of Kin →"  };
    else if (!hasProfile) otherBanner = { type: "info", title: "Complete your profile",             body: "Add your name and phone number.",                  link: "profile",      cta: "Go to Profile →"    };
    if (otherBanner) banners.push(otherBanner);
 
    // ── Enrich recent apps with logos ─────────────────────────────────────
    const recentApps = (apps ?? []).map((a: any) => ({ ...a }));
    if (recentApps.length > 0) {
      const { data: unis } = await svc.from("universities").select("name, aliases, logo_url");
      recentApps.forEach((app: any) => {
        const n = (app.university_name || "").toLowerCase();
        const uni = (unis ?? []).find((u: any) =>
          u.name?.toLowerCase() === n ||
          (Array.isArray(u.aliases) && u.aliases.some((a: string) => a.toLowerCase() === n))
        );
        app.logo_url = uni?.logo_url ?? null;
      });
    }
 
    await _log(svc, userId, "get_dashboard_state", req, "ok");
 
    return _json({
      success: true,
      firstName: user?.first_name || "Student",
      plan: {
        hasPlan,
        planName,
        totalApplications: totalApps,
        usedApplications:  used,
        remainingApplications: remaining,
        usedPercent: usedPct,
      },
      stats: {
        documents:          (docs ?? []).length,
        submissions:        used,
        notifications:      notifTotal  ?? 0,
        unreadNotifications: notifUnread ?? 0,
      },
      checklist,
      banners,
      recentApplications: recentApps,
    },200,origin);
 
  } catch (err: any) {
    return _json({ error: err?.message ?? "Server error" }, 500,origin);
  }
});