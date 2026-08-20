import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtVerify, SignJWT } from "https://esm.sh/jose@5";

// ===== ALLOWED ORIGINS =====
const ALLOWED_ORIGINS = [
  "https://www.querycrest.com",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://querycrest.com",
];

// ===== CORS HELPERS =====
function getCorsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function _json(body: unknown, status = 200, origin: string | null = null): Response {
  const corsHeaders = getCorsHeaders(origin);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function _error(message: string, status = 400, origin: string | null = null, details?: unknown): Response {
  const body: Record<string, unknown> = { 
    error: message, 
    status, 
    timestamp: new Date().toISOString() 
  };
  if (details !== undefined) body.details = details;
  return _json(body, status, origin);
}

// ===== CONFIGURATION =====
const ADMIN_VERIFICATION_CODE = Deno.env.get("Verification_Code")!;
const ADMIN_PASSWORD = Deno.env.get("Administrative_Password")!;
const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") || "your-secret-key";

// ===== RATE LIMITING =====
const attemptMap = new Map<string, { count: number; timestamp: number }>();
const RATE_LIMIT = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;

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

// ===== TOKEN GENERATION =====
async function generateToken(username: string): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const token = await new SignJWT({
    sub: username,
    role: "admin",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
    .setProtectedHeader({ alg: "HS256" })
    .sign(secret);

  return token;
}

// ===== MAIN HANDLER =====
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  // Handle OPTIONS (CORS preflight)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return _error("Method not allowed", 405, origin);
  }

  // Origin validation
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    console.log(`❌ Blocked origin: ${origin}`);
    return _error("Origin not allowed", 403, origin);
  }

  // Rate limiting
  const clientIP = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(clientIP)) {
    return _error("Too many attempts. Try again later.", 429, origin);
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return _error("Invalid request body", 400, origin);
  }

  const step = String(body.step || "").trim();
  const verificationCode = String(body.verification_code || "").trim();
  const adminPassword = String(body.admin_password || "").trim();

  // Step 1: Verify the verification code
  if (step === "1") {
    if (!verificationCode) {
      return _error("Verification code required", 400, origin);
    }

    if (verificationCode !== ADMIN_VERIFICATION_CODE) {
      console.error("auth: invalid verification code attempt from", clientIP);
      return _error("Invalid credentials", 401, origin);
    }

    return _json({
      success: true,
      message: "Verification code accepted. Enter admin password.",
      nextStep: 2
    }, 200, origin);
  }

  // Step 2: Verify the admin password
  if (step === "2") {
    if (!adminPassword) {
      return _error("Admin password required", 400, origin);
    }

    if (adminPassword !== ADMIN_PASSWORD) {
      console.error("auth: invalid admin password attempt from", clientIP);
      return _error("Invalid credentials", 401, origin);
    }

    const token = await generateToken("admin");
    console.log("✅ Token generated successfully");

    return _json({
      success: true,
      token: token,
      message: "Authentication successful",
    }, 200, origin);
  }

  return _error("Invalid step. Use step=1 or step=2", 400, origin);
});