import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // -----------------------------
    // PARSE BODY (JSON OR FORMDATA)
    // -----------------------------
    let paymentStatus, userId, planId, paymentId;

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await req.json();

      paymentStatus = body.payment_status;
      userId = body.custom_str1;
      planId = body.custom_str2;
      paymentId = body.m_payment_id;

    } else {
      const formData = await req.formData();

      paymentStatus = formData.get("payment_status");
      userId = formData.get("custom_str1");
      planId = formData.get("custom_str2");
      paymentId = formData.get("m_payment_id");
    }

    console.log("🔥 ITN RECEIVED:", {
      paymentStatus,
      userId,
      planId,
      paymentId,
    });

    // -----------------------------
    // VALIDATION
    // -----------------------------
    if (!paymentStatus || !userId || !planId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required payment data."
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Ignore non-complete payments
    if (paymentStatus !== "COMPLETE") {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Payment not completed. Ignored."
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // -----------------------------
    // VERIFY PLAN EXISTS
    // -----------------------------
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("plan_id, applications")
      .eq("plan_id", planId)
      .single();

    if (planError || !plan) {
      console.error("❌ Plan not found:", planError);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid plan selected."
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // -----------------------------
    // PREVENT SAME-DAY DUPLICATE
    // -----------------------------
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: existingToday, error: checkError } = await supabase
      .from("user_plans")
      .select("user_plan_id")
      .eq("user_id", userId)
      .eq("plan_id", planId)
      .gte("created_at", todayStart.toISOString());

    if (checkError) {
      console.error("❌ Duplicate check failed:", checkError);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Could not verify previous purchases. Try again."
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    if (existingToday && existingToday.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "You have already purchased this plan today. Please try again tomorrow."
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // -----------------------------
    // INSERT PURCHASE
    // -----------------------------
    const { error: insertError } = await supabase
      .from("user_plans")
      .insert({
        user_id: userId,
        plan_id: planId,
        applications_added: plan.applications,
        payment_id: paymentId,
        created_at: new Date().toISOString()
      });

    if (insertError) {
      console.error("❌ Insert failed:", insertError);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Payment processed but failed to activate plan. Contact support."
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    console.log("✅ Payment processed successfully");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Plan activated successfully."
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    console.error("🔥 ITN ERROR:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: "Server error. Please try again later."
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});