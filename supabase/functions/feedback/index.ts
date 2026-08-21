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
  let token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
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


// Rate limiting: track attempts by IP
const attemptMap = new Map<string, { count: number; timestamp: number }>();
const RATE_LIMIT = 5; // max attempts per IP per window
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = attemptMap.get(ip);

  if (!record || now - record.timestamp > RATE_LIMIT_WINDOW) {
    attemptMap.set(ip, { count: 1, timestamp: now });
    return true;
  }

  if (record.count >= RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}


async function addFormData(svc: ReturnType<typeof _SVC>,report:string,email:string,name:string) {
    const {data,  error } = await svc
      .from("feedback")
      .insert([
            { report: report, email: email??null,name:name??null},
        ])

    if (error) {
      return _json({error:`failed to add feedback data, error:{error}`},400);

    }
    if (data) {
      return _json({success:`feedback data added successfuly`},200);

    }            
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return _json({ error: "Method not allowed" }, 405);
  try {
  let auth = null;
  const origin = req.headers.get("origin");
  if (origin && origin !== "https://www.querycrest.com") {
    return _json({ error: "Origin not allowed" }, 403);
  }

  const clientIP = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(clientIP)) {
    return _json({ error: "Too many attempts. Try again later." }, 429);
  }


    auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId:_userId, email:_email, svc } = auth;


    const body = await req.json().catch(() => ({}));
    const {feedback_report, feedback_email, feedback_name } = body;
    if (!feedback_report || typeof feedback_report !== "string")
      return _json({ error: "feedback_report is required" }, 400);

    // add feedback data from form
    await addFormData(svc,feedback_report,feedback_email,feedback_name);
  } catch {
    return _json({ error: "Server error" }, 500);
  }
});