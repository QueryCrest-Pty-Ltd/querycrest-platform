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
 
 
const FREE_PLAN_ID = "1c9e9ad0-8e35-4a12-943e-312572050491";
 
Deno.serve(async (req) => {
  origin = req.headers.get("origin");  
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return _json({ success: false, error: "Method not allowed" }, 405,origin);
  try {
    const auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId, svc } = auth;
 
    const rl = await _rateLimit(svc, userId, "student_results", 20, 60);
    if (rl) return rl;
 
    // Plan gate — feature requires a paid plan
    const { data: userPlan, error: planErr } = await svc
      .from("user_plans")
      .select("plan_id")
      .eq("user_id", userId)
      .order("purchase_date", { ascending: false })
      .limit(1)
      .single();
    if (planErr || !userPlan)
      return _json({ success: false, error: "No active subscription. Upgrade to use this feature." }, 403,origin);
    if (userPlan.plan_id === FREE_PLAN_ID)
      return _json({ success: false, error: "This feature is available on paid plans only." }, 403,origin);
 
    const body = await req.json().catch(() => ({}));
    let { university_id, course_id, subjects } = body;
 
    if (!university_id || !course_id || !Array.isArray(subjects))
      return _json({ success: false, error: "Please complete all required fields." }, 400,origin);
 
    // Remove Life Orientation
    subjects = subjects.filter((s: any) => {
      const n = String(s.subject ?? "").trim().toLowerCase();
      return n !== "lo" && n !== "life orientation";
    });
 
    // Deduplicate — keep highest mark per subject
    const map = new Map<string, any>();
    for (const s of subjects) {
      const key = String(s.subject ?? "").trim().toLowerCase();
      const m   = Number(s.mark);
      if (!map.has(key) || m > map.get(key).mark)
        map.set(key, { subject: s.subject, mark: m });
    }
    subjects = Array.from(map.values());
 
    if (subjects.length < 5)
      return _json({ success: false, error: "Please add at least 5 subjects (excluding Life Orientation)." }, 400,origin);
    if (subjects.length > 9)
      return _json({ success: false, error: "Maximum of 9 subjects allowed." }, 400,origin);
 
    // Validate marks
    for (const s of subjects) {
      const m = Number(s.mark);
      if (!Number.isFinite(m) || m < 0 || m > 100)
        return _json({ success: false, error: `Invalid mark for ${s.subject}` }, 400,origin);
      s.mark = m;
    }
 
    // Fetch APS requirement for the selected course
    const { data: course, error: cErr } = await svc
      .from("courses")
      .select("aps_requirement")
      .eq("id", course_id)
      .single();
    if (cErr || !course)
      return _json({ success: false, error: "Course not found." }, 404,origin);
 
    // APS calculation (standard SA NSC scale)
    let aps = 0, total = 0;
    for (const s of subjects) {
      total += s.mark;
      if      (s.mark >= 80) aps += 7;
      else if (s.mark >= 70) aps += 6;
      else if (s.mark >= 60) aps += 5;
      else if (s.mark >= 50) aps += 4;
      else if (s.mark >= 40) aps += 3;
      else if (s.mark >= 30) aps += 2;
      else                   aps += 1;
    }
    const average = Number((total / subjects.length).toFixed(2));
    const status  = aps >= course.aps_requirement ? "Qualified" : "Not Qualified";
    const reason  = status === "Qualified"
      ? "You meet the minimum APS requirement for this course."
      : `Your APS is ${aps}, but the minimum required is ${course.aps_requirement}.`;
 
    // Save result — upsert so re-checks overwrite the previous result
    await svc.from("student_university_results").upsert(
      { student_id: userId, university_id, course: course_id, subjects, aps, average, status },
      { onConflict: "student_id,university_id,course" }
    );
 
    await _log(svc, userId, "student_results", req, "ok", { aps, status });
    return _json({
      success: true,
      result: { aps, average, status, reason, subjectCount: subjects.length },
    },200,origin);
  } catch {
    return _json({ success: false, error: "Server error" }, 500,origin);
  }
});