import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtVerify, SignJWT } from "https://esm.sh/jose@5";

const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "https://www.querycrest.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function _json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const ADMIN_VERIFICATION_CODE = Deno.env.get("ADMIN_VERIFICATION_CODE")!;
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD")!;
const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") || "your-secret-key";

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

async function generateToken(username: string): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const token = await new SignJWT({
    sub: username,
    role: "admin",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
  })
    .setProtectedHeader({ alg: "HS256" })
    .sign(secret);

  return token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return _json({ error: "Method not allowed" }, 405);

  const origin = req.headers.get("origin");
  if (origin && origin !== "https://www.querycrest.com") {
    return _json({ error: "Origin not allowed" }, 403);
  }

  const clientIP = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(clientIP)) {
    return _json({ error: "Too many attempts. Try again later." }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return _json({ error: "Invalid request body" }, 400);
  }

  const step = String(body.step || "").trim();
  const verificationCode = String(body.verification_code || "").trim();
  const adminPassword = String(body.admin_password || "").trim();

  // Step 1: Verify the verification code
  if (step === "1") {
    if (!verificationCode) {
      return _json({ error: "Verification code required" }, 400);
    }

    if (verificationCode !== ADMIN_VERIFICATION_CODE) {
      console.error("auth: invalid verification code attempt from", clientIP);
      return _json({ error: "Invalid credentials" }, 401);
    }

    // Code is correct — prompt for password (step 2)
    return _json({ success: true, message: "Verification code accepted. Enter admin password.", nextStep: 2 });
  }

  // Step 2: Verify the admin password
  if (step === "2") {
    if (!adminPassword) {
      return _json({ error: "Admin password required" }, 400);
    }

    if (adminPassword !== ADMIN_PASSWORD) {
      console.error("auth: invalid admin password attempt from", clientIP);
      return _json({ error: "Invalid credentials" }, 401);
    }

    // Both credentials correct — generate and return token
    const token = await generateToken("admin");
    return _json({
      success: true,
      token,
      message: "Authentication successful",
    });
  }

  return _json({ error: "Invalid step. Use step=1 or step=2" }, 400);
});