import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const url = new URL(req.url);
    const dashboardType = url.searchParams.get('dashboard') || 'admin';

    const { data, error } = await supabase
      .from('onboarding_steps')
      .select('id, step_order, target_element, title, content, placement')
      .eq('dashboard_type', dashboardType)
      .order('step_order', { ascending: true });

    if (error) {
      console.error('Error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to get steps' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const steps = data.map(row => ({
      id: row.id,
      stepOrder: row.step_order,
      targetElement: row.target_element,
      title: row.title,
      content: row.content,
      placement: row.placement
    }));

    return new Response(
      JSON.stringify({ steps }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});