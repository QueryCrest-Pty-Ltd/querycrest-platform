// supabase/functions/validate-generation-code/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip') ?? 'unknown';
}

function currentWindowStart(): string {
  const ms = Date.now();
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  return new Date(Math.floor(ms / windowMs) * windowMs).toISOString();
}

async function checkRateLimit(ip: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  const windowStart = currentWindowStart();

  const { data, error } = await supabase.rpc('increment_attempt', {
    p_ip: ip,
    p_window_start: windowStart,
  });

  if (error) {
    console.error('Rate limit RPC error:', error);
    return { allowed: true }; // fail open
  }

  if (typeof data === 'number' && data > RATE_LIMIT_MAX_ATTEMPTS) {
    return { allowed: false, retryAfter: RATE_LIMIT_WINDOW_SECONDS };
  }

  return { allowed: true };
}

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  extraHeaders: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // --- Rate limit ---
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip);

  if (!rl.allowed) {
    return jsonResponse(
      { authorized: false, error: 'Too many requests' },
      429,
      corsHeaders,
      { 'Retry-After': String(rl.retryAfter ?? RATE_LIMIT_WINDOW_SECONDS) }
    );
  }

  try {
    const body = await req.json().catch(() => null);

    if (!body || typeof body.code !== 'string') {
      return jsonResponse(
        { authorized: false, error: 'Missing or invalid code' },
        400,
        corsHeaders
      );
    }

    const { code } = body;
    const storedCode = Deno.env.get('QUERYCREST_GENERATION_CODE');

    if (!storedCode) {
      console.error('QUERYCREST_GENERATION_CODE is not set in environment secrets');
      return jsonResponse(
        { authorized: false, error: 'Server configuration error' },
        500,
        corsHeaders
      );
    }

    if (code !== storedCode) {
      return jsonResponse({ authorized: false }, 401, corsHeaders);
    }

    return jsonResponse({ authorized: true }, 200, corsHeaders);

  } catch (err) {
    console.error('Unexpected error:', err);
    return jsonResponse({ authorized: false, error: 'Server error' }, 500, corsHeaders);
  }
});