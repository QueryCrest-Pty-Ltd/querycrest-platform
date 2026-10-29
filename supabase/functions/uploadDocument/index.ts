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
 
const ALLOWED_DOC_TYPES = [
  "ID","Passport","Grade 11 Results","Grade 12 Results",
  "Transcript","Motivation Letter","Proof of Residence","Other",
  "Bank Statement (last 3 months)",
];
const ALLOWED_MIME_TYPES = ["image/jpeg","image/jpg","image/png","application/pdf"];
const MAX_FILE_BYTES     = 10 * 1024 * 1024; // 10 MB
 
Deno.serve(async (req) => {
  origin = req.headers.get("origin");    
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return _json({ error: "Method not allowed" }, 405,origin);
  try {
    const auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId, svc } = auth;
 
    const rl = await _rateLimit(svc, userId, "upload_document", 10, 60);
    if (rl) return rl;
 
    const ct = req.headers.get("Content-Type") ?? "";
 
    // ── Admin: status update via JSON ────────────────────────────────────
    if (ct.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      if (body.action !== "updateStatus")
        return _json({ error: "Unknown action" }, 400,origin);
 
      const { document_id, status, admin_notes } = body;
      if (!document_id || !status)
        return _json({ error: "document_id and status are required" }, 400,origin);
 
      const VALID = ["Pending","Approved","Verified","Rejected","Certify Doc"];
      if (!VALID.includes(status))
        return _json({ error: `Invalid status. Use one of: ${VALID.join(", ")}` }, 400,origin);
 
      // Verify the caller has admin role
      const { data: caller } = await svc
        .from("users").select("role").eq("id", userId).single();
      const isAdmin = Array.isArray(caller?.role)
        ? caller.role.includes("admin") : false;
      if (!isAdmin)
        return _json({ error: "Admin role required to update document status" }, 403,origin);
 
      const update: Record<string, unknown> = {
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
      };
      if (admin_notes !== undefined) update.admin_notes = admin_notes;
 
      const { data: updated, error } = await svc
        .from("documents").update(update).eq("id", document_id)
        .select("id, document_type, file_name, status, admin_notes, reviewed_at").single();
      if (error) return _json({ error: error.message }, 500,origin);
 
      await _log(svc, userId, "upload_document", req, "ok",
        { sub_action: "update_status", document_id, status });
      return _json({ success: true, document: updated },200,origin);
    }
 
    // ── User: file upload via multipart/form-data ────────────────────────
    const fd           = await req.formData();
    const documentType = _clean(fd.get("documentType"), 100);
    const file         = fd.get("documentFile") as File | null;
 
    if (!documentType || !ALLOWED_DOC_TYPES.includes(documentType))
      return _json({ error: "Invalid or missing document type" }, 400,origin);
    if (!file)
      return _json({ error: "No file provided" }, 400,origin);
    if (file.size === 0)
      return _json({ error: "File is empty" }, 400,origin);
    if (file.size > MAX_FILE_BYTES)
      return _json({ error: "File exceeds 10 MB limit" }, 400,origin);
    if (!ALLOWED_MIME_TYPES.includes(file.type))
      return _json({ error: "Only PDF, JPG and PNG files are accepted" }, 400,origin);
 
    // Sanitise filename: keep only safe chars
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
    const fileName = `${Date.now()}_${safeName}`;
    const filePath = `${userId}/${fileName}`;
 
    const { error: uploadErr } = await svc.storage
      .from("user-documents")
      .upload(filePath, file.stream(), { contentType: file.type, upsert: false });
    if (uploadErr) {
      await _log(svc, userId, "upload_document", req, "fail",
        { reason: uploadErr.message, documentType });
      return _json({ error: "Upload failed. Please try again." }, 500,origin);
    }
 
    // 7-day signed URL for immediate use in the dashboard
    const { data: signed } = await svc.storage
      .from("user-documents").createSignedUrl(filePath, 60 * 60 * 24 * 7);
 
    const { data: doc, error: dbErr } = await svc
      .from("documents")
      .insert([{ user_id: userId, document_type: documentType, file_name: fileName, file_path: filePath }])
      .select("id, document_type, file_name, file_path, status, created_at")
      .single();
    if (dbErr) {
      // Clean up orphaned storage object if DB insert fails
      await svc.storage.from("user-documents").remove([filePath]).catch(() => {});
      return _json({ error: "Database error. Please try again." }, 500,origin);
    }
 
    await _log(svc, userId, "upload_document", req, "ok",
      { documentType, fileName, size: file.size });
    return _json({
      success: true, fileName, filePath, documentType,
      status: doc.status, url: signed?.signedUrl ?? null, document: doc,
    },200,origin);
  } catch {
    return _json({ error: "Server error" }, 500,origin);
  }
});