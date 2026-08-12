import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin":  "https://www.querycrest.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age":       "86400",
};

function _json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const TARGET_SLUG = "terms-of-service";

// Public, read-only endpoint — no user auth required, unlike
// ProcessPayment.ts / validate-promo-code.ts. Only serves one
// specific, non-sensitive row from public.pages.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return _json({ error: "Method not allowed" }, 405);

  // Defense-in-depth beyond CORS: CORS headers only stop a *browser* from
  // letting a disallowed page read the response — they don't stop the
  // request from being sent. Reject non-approved origins outright too.
  const origin = req.headers.get("origin");
  if (origin && origin !== "https://www.querycrest.com") {
    return _json({ error: "Origin not allowed" }, 403);
  }

  try {
    const svc = _SVC();
    const { data, error } = await svc
      .from("pages")
      .select("content, updated_at")   // only what the frontend needs
      .eq("slug", TARGET_SLUG)
      .single();

    if (error || !data?.content) {
      // Log detail server-side only; never leak DB/SQL errors to the client.
      if (error) console.error("terms-of-service: db error", error.message);
      return _json({ error: "Content not found" }, 404);
    }

    return _json({ content: data.content, updated_at: data.updated_at });
  } catch (err) {
    console.error("terms-of-service: unexpected error", err instanceof Error ? err.message : err);
    return _json({ error: "Server error" }, 500);
  }
});