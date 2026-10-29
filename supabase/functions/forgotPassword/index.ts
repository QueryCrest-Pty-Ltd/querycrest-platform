import { createClient } from "https://esm.sh/@supabase/supabase-js@2";




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
    'Access-Control-Allow-Headers': ' x-client-info, content-type',
    'Access-Control-Allow-Methods': " POST OPTIONS",
  };
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const WINDOW_MINUTES = 30;
const MAX_ATTEMPTS   = 3;

Deno.serve(async (req) => {
  origin = req.headers.get("origin");  
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });

  try {
    const { email } = await req.json();

    if (!email) return errorResponse("Email is required.", 400);

    const normalizedEmail = String(email).toLowerCase().trim();

    // ── Rate limit check ─────────────────────────────────────────
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

    const { count, error: countError } = await supabase
      .from("password_reset_attempts")
      .select("*", { count: "exact", head: true })
      .eq("email", normalizedEmail)
      .gte("attempted_at", windowStart);

    if (countError) {
      console.error("Rate limit check failed:", countError);
      return errorResponse("Server error.", 500);
    }

    if ((count ?? 0) >= MAX_ATTEMPTS) {
      // Find the oldest attempt in the window to calculate exact wait time
      const { data: oldest } = await supabase
        .from("password_reset_attempts")
        .select("attempted_at")
        .eq("email", normalizedEmail)
        .gte("attempted_at", windowStart)
        .order("attempted_at", { ascending: true })
        .limit(1)
        .single();

      let waitMinutes = WINDOW_MINUTES;
      if (oldest?.attempted_at) {
        const unlockAt = new Date(oldest.attempted_at).getTime() + WINDOW_MINUTES * 60 * 1000;
        waitMinutes    = Math.max(1, Math.ceil((unlockAt - Date.now()) / 60000));
      }

      return errorResponse(
        `Too many reset requests. Please wait ${waitMinutes} minute${waitMinutes !== 1 ? "s" : ""} before trying again.`,
        429
      );
    }

    // ── Log this attempt before sending ──────────────────────────
    const { error: insertError } = await supabase
      .from("password_reset_attempts")
      .insert({ email: normalizedEmail });

    if (insertError) {
      console.error("Failed to log attempt:", insertError);
      // Non-fatal — still send the email
    }

    // ── Send the reset email ──────────────────────────────────────
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: "https://www.querycrest.com/account/reset-password.html",
    });

    if (error) return errorResponse(error.message, 400);

    return new Response(
      JSON.stringify({ message: "Password reset link sent to your email." }),
      { status: 200, headers: getCorsHeaders(origin) }
    );

  } catch (err) {
    console.error(err);
    return errorResponse("Server error.", 500);
  }

  function errorResponse(msg: string, status: number): Response {
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: getCorsHeaders(origin),
    });
  }
});