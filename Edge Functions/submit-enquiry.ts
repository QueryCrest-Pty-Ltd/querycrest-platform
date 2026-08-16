import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin":  "https://www.querycrest.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age":       "86400",
};

function _json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const VALID_AUDIENCES = [
  "high_school_learner",
  "gap_year",
  "uni_or_college_student",
  "general_person",
  "other",
];

// Simple, deliberately permissive format check — good enough to catch
// obvious typos without rejecting valid real-world addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function _clean(val: unknown, maxLen = 2000): string {
  if (val == null) return "";
  return String(val).trim().slice(0, maxLen);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return _json({ error: "Method not allowed" }, 405);

  const origin = req.headers.get("origin");
  if (origin && origin !== "https://www.querycrest.com") {
    return _json({ error: "Origin not allowed" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return _json({ error: "Invalid request body" }, 400);
  }

  const fullName = _clean(body.full_name, 200);
  const email = _clean(body.email, 200);
  const phone = _clean(body.phone, 40);
  const enquiry = _clean(body.enquiry, 4000);
  const hasAccountRaw = body.has_account;
  const audience = _clean(body.audience, 60);
  const sourcePage = _clean(body.source_page, 40);

  // Server-side validation — the frontend also validates, but the
  // server is the source of truth and must never trust the client alone.
  const errors: string[] = [];
  if (!fullName) errors.push("Full name is required.");
  if (!email || !EMAIL_RE.test(email)) errors.push("A valid email address is required.");
  if (!phone) errors.push("Phone number is required.");
  if (!enquiry) errors.push("Enquiry message is required.");
  if (typeof hasAccountRaw !== "boolean") errors.push("has_account must be true or false.");
  if (!VALID_AUDIENCES.includes(audience)) errors.push("A valid audience selection is required.");

  if (errors.length > 0) {
    return _json({ error: "Validation failed", details: errors }, 400);
  }

  try {
    const svc = _SVC();
    const { error } = await svc.from("enquiries").insert({
      full_name: fullName,
      email,
      phone,
      enquiry,
      has_account: hasAccountRaw,
      audience,
      source_page: sourcePage || null,
    });

    if (error) {
      console.error("submit-enquiry: db error", error.message);
      return _json({ error: "Unable to save enquiry" }, 500);
    }

    return _json({ success: true });
  } catch (err) {
    console.error("submit-enquiry: unexpected error", err instanceof Error ? err.message : err);
    return _json({ error: "Server error" }, 500);
  }
});
