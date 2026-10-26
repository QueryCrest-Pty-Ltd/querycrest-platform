import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "https://www.querycrest.com",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const WINDOW_MINUTES = 30;
const MAX_ATTEMPTS   = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    console.error(err);
    return errorResponse("Server error.", 500);
  }

  function errorResponse(msg: string, status: number): Response {
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: corsHeaders,
    });
  }
});