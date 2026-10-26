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
  if (req.method !== "POST") return _json({ success: false, error: "Method not allowed" }, 405);
  try {
    const auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId, svc } = auth;
 
    const rl = await _rateLimit(svc, userId, "save_personal_info", 20, 60);
    if (rl) return rl;
 
    const body = await req.json().catch(() => ({}));
    const {
      id_number, date_of_birth, gender, title,
      marital_status, current_occupation, home_language,
      has_disability = false,
    } = body;
 
    if (!id_number || !marital_status || !current_occupation)
      return _json({ success: false, error: "id_number, marital_status and current_occupation are required" }, 400);
 
    // South African ID: exactly 13 digits
    if (!/^\d{13}$/.test(String(id_number)))
      return _json({ success: false, error: "id_number must be exactly 13 digits" }, 400);
 
    // Whitelist allowed values — no free-text injection in enums
    const VALID_MARITAL    = ["Single","Married","Divorced","Widowed"];
    const VALID_OCCUPATION = ["High school learner","Gap year student","University student","TVET college student",
      "Graduate (seeking opportunities)","Employed full-time","Employed part-time","Self-employed","Unemployed","Other"];
    const VALID_TITLE      = ["Mr","Ms","Mrs","Dr","Prof",""];
    const VALID_LANGUAGE   = ["English","Afrikaans","IsiZulu","IsiXhosa","Sepedi","Setswana","Sesotho",
      "Xitsonga","Tshivenda","SiSwati","IsiNdebele","Other",""];
 
    if (!VALID_MARITAL.includes(marital_status))
      return _json({ success: false, error: "Invalid marital status" }, 400);
    if (!VALID_OCCUPATION.includes(current_occupation))
      return _json({ success: false, error: "Invalid occupation" }, 400);
    if (title && !VALID_TITLE.includes(title))
      return _json({ success: false, error: "Invalid title" }, 400);
    if (home_language && !VALID_LANGUAGE.includes(home_language))
      return _json({ success: false, error: "Invalid home language" }, 400);
 
    const { data, error } = await svc
      .from("student_personal_info")
      .upsert({
        user_id:            userId,
        id_number:          String(id_number).trim(),
        date_of_birth:      date_of_birth  ?? null,
        gender:             gender         ?? null,
        title:              title          ?? null,
        marital_status,
        current_occupation,
        home_language:      home_language  ?? null,
        has_disability:     Boolean(has_disability),
        updated_at:         new Date().toISOString(),
      }, { onConflict: "user_id" })
      .select()
      .single();
    if (error) {
      await _log(svc, userId, "save_personal_info", req, "fail", { reason: error.message });
      return _json({ success: false, error: "Failed to save personal info" }, 500);
    }
 
    await _log(svc, userId, "save_personal_info", req, "ok");
    return _json({ success: true, info: data });
  } catch {
    return _json({ success: false, error: "Server error" }, 500);
  }
});