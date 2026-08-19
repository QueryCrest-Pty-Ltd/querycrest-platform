import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtVerify } from "https://esm.sh/jose@5";

const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "https://www.querycrest.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function _json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") || "your-secret-key";

async function verifyToken(authHeader: string): Promise<boolean> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.slice(7);
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const origin = req.headers.get("origin");
  if (origin && origin !== "https://www.querycrest.com") {
    return _json({ error: "Origin not allowed" }, 403);
  }

  // All lockdown operations require authentication
  const authHeader = req.headers.get("authorization") || "";
  const isAuthenticated = await verifyToken(authHeader);
  if (!isAuthenticated) {
    return _json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const method = req.method;
  const svc = _SVC();

  try {
    // GET /lockdown/status — check if lockdown is active
    if (method === "GET" && url.pathname === "/functions/v1/lockdown/status") {
      const { data } = await svc
        .from("admin_lockdown")
        .select("is_active, expires_at")
        .order("created_at", { ascending: false })
        .limit(1);

      if (!data || data.length === 0) {
        return _json({ is_active: false, message: "No lockdown record found" });
      }

      const lockdown = data[0];
      const now = new Date();
      const expiresAt = new Date(lockdown.expires_at);

      // If lockdown is active but expired, clear it automatically
      if (lockdown.is_active && now >= expiresAt) {
        await svc.from("admin_lockdown").update({ is_active: false }).eq("expires_at", lockdown.expires_at);
        return _json({ is_active: false, message: "Lockdown has expired and been cleared" });
      }

      return _json({
        is_active: lockdown.is_active,
        expires_at: lockdown.expires_at,
      });
    }

    // POST /lockdown/activate — activate emergency lockdown
    if (method === "POST" && url.pathname === "/functions/v1/lockdown/activate") {
      let body: Record<string, unknown> = {};
      try {
        body = await req.json();
      } catch {
        // Body is optional
      }

      const reason = String(body.reason || "Emergency lockdown activated").trim();

      // Set lockdown as active with 12-hour expiry
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

      const { data, error } = await svc
        .from("admin_lockdown")
        .insert({
          is_active: true,
          activated_by: "admin", // Could be extended to include actual admin ID
          reason,
          expires_at: expiresAt.toISOString(),
        })
        .select();

      if (error) {
        console.error("lockdown: activation error", error.message);
        return _json({ error: "Failed to activate lockdown" }, 500);
      }

      console.warn("EMERGENCY LOCKDOWN ACTIVATED:", reason);

      return _json({
        success: true,
        message: "Emergency lockdown activated",
        data: {
          is_active: true,
          expires_at: expiresAt.toISOString(),
          reason,
        },
      });
    }

    // POST /lockdown/deactivate — manually deactivate lockdown
    if (method === "POST" && url.pathname === "/functions/v1/lockdown/deactivate") {
      const { error } = await svc
        .from("admin_lockdown")
        .update({ is_active: false })
        .eq("is_active", true);

      if (error) {
        console.error("lockdown: deactivation error", error.message);
        return _json({ error: "Failed to deactivate lockdown" }, 500);
      }

      console.warn("EMERGENCY LOCKDOWN DEACTIVATED");

      return _json({
        success: true,
        message: "Lockdown has been deactivated",
      });
    }

    return _json({ error: "Endpoint not found" }, 404);
  } catch (err) {
    console.error("lockdown: unexpected error", err instanceof Error ? err.message : err);
    return _json({ error: "Server error" }, 500);
  }
});