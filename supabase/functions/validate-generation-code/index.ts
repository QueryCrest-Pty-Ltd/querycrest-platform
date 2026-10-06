const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
// Handle CORS preflight
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
// 1. Parse the request body
  try {
    const body = await req.json().catch(() => null);

    if (!body || typeof body.code !== 'string') {
      return new Response(
        JSON.stringify({ authorized: false, error: 'Missing or invalid code' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
// stored secret
    const { code } = body;
    const storedCode = Deno.env.get('QUERYCREST_GENERATION_CODE');

    if (!storedCode) {
      console.error('QUERYCREST_GENERATION_CODE is not set in environment secrets');
      return new Response(
        JSON.stringify({ authorized: false, error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Compare
    if (code !== storedCode) {
      return new Response(
        JSON.stringify({ authorized: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Success — never return the stored code
    return new Response(
      JSON.stringify({ authorized: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(
      JSON.stringify({ authorized: false, error: 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});