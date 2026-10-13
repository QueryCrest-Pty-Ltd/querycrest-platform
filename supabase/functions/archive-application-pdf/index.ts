// supabase/functions/archive-application-pdf/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

Deno.serve(async (req) => {
  // Compute CORS headers from the request's Origin
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Re-validate the generation code
    const { code, filename, pdfBase64, studentName, studentNumber } = await req.json();

    const storedCode = Deno.env.get('QUERYCREST_GENERATION_CODE');
    if (!storedCode || code !== storedCode) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (typeof filename !== 'string' || typeof pdfBase64 !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing filename or pdfBase64' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Decode base64 → bytes
    const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));

    // 3. Build the storage path: YYYY-MM/<filename>_<studentNumber>.pdf
    const now = new Date();
    const yyyymm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const baseName = safeName(filename).replace(/\.pdf$/i, '');
    const sn = studentNumber ? safeName(String(studentNumber)) : 'unknown';
    const path = `${yyyymm}/${baseName}_${sn}.pdf`;

    // 4. Upload via service role — bucket RLS is bypassed
    const { data, error } = await supabase.storage
      .from('application-pdfs')
      .upload(path, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (error) {
      console.error('Upload error:', error);
      return new Response(
        JSON.stringify({ error: 'Upload failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ path: data.path }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});