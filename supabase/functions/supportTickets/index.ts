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
 
 
const ALLOWED_CATEGORIES = ["Technical Issue","Academic Guidance","Application Help","Billing","Other"];
const MAX_ATTACH_BYTES   = 5 * 1024 * 1024; // 5 MB
 
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId, svc } = auth;
 
    const rl = await _rateLimit(svc, userId, "support_tickets", 20, 60);
    if (rl) return rl;
 
    // ── GET: load user's tickets ──────────────────────────────────────────
    if (req.method === "GET") {
      const { data, error } = await svc
        .from("support_tickets")
        .select("id, subject, category, message, priority, status, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) return _json({ error: error.message }, 400);
      return _json({ success: true, tickets: data ?? [] });
    }
 
    // ── POST: create ticket ───────────────────────────────────────────────
    if (req.method === "POST") {
      const fd      = await req.formData();
      const subject  = _clean(fd.get("subject"),  200);
      const category = _clean(fd.get("category"), 100);
      const message  = _clean(fd.get("message"),  2000);
      const priority = _clean(fd.get("priority"), 20) || "Medium";
      const file     = fd.get("document") as File | null;
 
      if (!subject || !category || !message)
        return _json({ error: "Subject, category and message are required" }, 400);
      if (!ALLOWED_CATEGORIES.includes(category))
        return _json({ error: `Invalid category. Use: ${ALLOWED_CATEGORIES.join(", ")}` }, 400);
      if (!["Low","Medium","High"].includes(priority))
        return _json({ error: "Invalid priority" }, 400);
 
      let attachment_url: string | null  = null;
      let attachment_name: string | null = null;
 
      if (file && file.size > 0) {
        if (file.size > MAX_ATTACH_BYTES)
          return _json({ error: "Attachment too large (max 5 MB)" }, 400);
        const SAFE_MIME = ["image/jpeg","image/jpg","image/png","application/pdf"];
        if (!SAFE_MIME.includes(file.type))
          return _json({ error: "Only PDF, JPG and PNG attachments are accepted" }, 400);
        const ext  = (file.name.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "").toLowerCase();
        const path = `${userId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await svc.storage
          .from("support-documents")
          .upload(path, file, { contentType: file.type });
        if (upErr) return _json({ error: "Failed to upload attachment" }, 500);
        attachment_url  = path;
        attachment_name = file.name.slice(0, 200);
      }
 
      const { error } = await svc.from("support_tickets").insert({
        user_id: userId, subject, category, message, priority,
        attachment_url, attachment_name,
      });
      if (error) return _json({ error: error.message }, 400);
 
      await _log(svc, userId, "support_tickets", req, "ok", { subject, category });
      return _json({
        success: true,
        message: "Ticket submitted. Our team will respond within 24–48 hours.",
      });
    }
 
    return _json({ error: "Method not allowed" }, 405);
  } catch {
    return _json({ error: "Server error" }, 500);
  }
});