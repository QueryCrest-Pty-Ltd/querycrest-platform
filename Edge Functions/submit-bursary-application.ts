import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const CORS = {
  "Access-Control-Allow-Origin":      "https://www.querycrest.com",
  "Access-Control-Allow-Headers":     "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":     "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Max-Age":           "86400",
  "Access-Control-Allow-Credentials": "true",
};
function _json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
async function _auth(req: Request): Promise<{ userId: string; email: string; svc: ReturnType<typeof _SVC> } | Response> {
  let token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
  if (!token) {
    const cookies = req.headers.get("cookie") ?? "";
    const match   = cookies.match(/(?:^|;\s*)access_token=([^;]+)/);
    token         = match?.[1]?.trim();
  }
  if (!token) return _json({ error: "Unauthorized" }, 401);

  const svc = _SVC();
  const { data: { user }, error } = await svc.auth.getUser(token);
  if (error || !user) return _json({ error: "Unauthorized — invalid token" }, 401);
  return { userId: user.id, email: user.email ?? "", svc };
}
async function _rateLimit(
  svc: ReturnType<typeof _SVC>, userId: string,
  action: string, limit: number, windowSec: number
): Promise<Response | null> {
  try {
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const { count } = await svc.from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId).eq("action", action).eq("result", "ok")
      .gte("created_at", since);
    if ((count ?? 0) >= limit)
      return _json({ error: "Too many requests. Please wait before trying again." }, 429);
  } catch { /* non-blocking */ }
  return null;
}
async function _log(
  svc: ReturnType<typeof _SVC>, userId: string | null,
  action: string, req: Request, result: "ok" | "fail",
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
             ?? req.headers.get("x-real-ip") ?? "unknown";
    await svc.from("audit_log").insert({
      user_id: userId, action,
      ip_address: ip,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 200),
      result, meta,
    });
  } catch { /* never crash a function because logging failed */ }
}
function _clean(val: unknown, maxLen = 500): string {
  if (val == null) return "";
  return String(val)
    .replace(/<[^>]*>/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim()
    .slice(0, maxLen);
}

async function _applyPromo(
  svc: ReturnType<typeof _SVC>,
  rawCode: string | undefined,
  serviceType: string,
  userId: string,
  basePriceCents: number
): Promise<
  | { ok: true; promo: any | null; discountCents: number; finalCents: number }
  | { ok: false; error: string }
> {
  if (!rawCode) return { ok: true, promo: null, discountCents: 0, finalCents: basePriceCents };
  const code = _clean(rawCode, 40).toUpperCase();
  if (!code) return { ok: true, promo: null, discountCents: 0, finalCents: basePriceCents };

  const { data: promo, error } = await svc
    .from("promo_codes").select("*").eq("code", code).eq("active", true).maybeSingle();
  if (error || !promo) return { ok: false, error: "Invalid or expired promo code." };

  const now = new Date();
  if (promo.starts_at && new Date(promo.starts_at) > now)
    return { ok: false, error: "This promo code isn't active yet." };
  if (promo.expires_at && new Date(promo.expires_at) < now)
    return { ok: false, error: "This promo code has expired." };

  const appliesTo: string[] = promo.applies_to || [];
  if (!appliesTo.includes("*") && !appliesTo.includes(serviceType))
    return { ok: false, error: "This promo code doesn't apply to this service." };

  if (promo.max_redemptions != null && promo.redemptions_count >= promo.max_redemptions)
    return { ok: false, error: "This promo code has reached its redemption limit." };

  const { count: userRedemptions } = await svc
    .from("promo_code_redemptions")
    .select("*", { count: "exact", head: true })
    .eq("promo_code_id", promo.id).eq("user_id", userId);
  if ((userRedemptions ?? 0) >= promo.max_redemptions_per_user)
    return { ok: false, error: "You've already used this promo code." };

  let discountCents = 0;
  if (promo.discount_type === "free") discountCents = basePriceCents;
  else if (promo.discount_type === "percentage") discountCents = Math.round(basePriceCents * (Number(promo.discount_value) / 100));
  else if (promo.discount_type === "fixed_amount") discountCents = Math.round(Number(promo.discount_value));
  discountCents = Math.max(0, Math.min(discountCents, basePriceCents));

  return { ok: true, promo, discountCents, finalCents: basePriceCents - discountCents };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return _json({ error: "Method not allowed" }, 405);
  try {
    const auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId, email, svc } = auth;

    const rl = await _rateLimit(svc, userId, "submit_bursary_application", 10, 300);
    if (rl) {
      await _log(svc, userId, "submit_bursary_application", req, "fail", { reason: "rate_limited" });
      return rl;
    }

    const body = await req.json().catch(() => ({}));
    const bursaryId = _clean(body.bursary_id, 60);
    const hasAppliedBefore = body.has_applied_before === true;
    const promoCode = body.promo_code;

    if (!UUID_RE.test(bursaryId))
      return _json({ error: "A valid bursary must be selected." }, 400);

    const { data: bursary, error: bErr } = await svc
      .from("bursaries").select("id, name").eq("id", bursaryId).eq("active", true).maybeSingle();
    if (bErr || !bursary) return _json({ error: "Selected bursary is not available." }, 400);

    const { data: pricing, error: pErr } = await svc
      .from("service_pricing").select("*").eq("service_key", "bursary_application").eq("active", true).maybeSingle();
    if (pErr || !pricing) return _json({ error: "Bursary applications are temporarily unavailable." }, 500);

    const basePriceCents = pricing.price_cents;

    const promoResult = await _applyPromo(svc, promoCode, "bursary_application", userId, basePriceCents);
    if (!promoResult.ok) {
      await _log(svc, userId, "submit_bursary_application", req, "fail", { reason: "invalid_promo" });
      return _json({ error: promoResult.error }, 400);
    }

    // Application row is created up front so it's visible in "awaiting
   
    const { data: application, error: insertErr } = await svc
      .from("bursary_applications")
      .insert({
        user_id: userId,
        bursary_id: bursary.id,
        bursary_name: bursary.name,
        has_applied_before: hasAppliedBefore,
        needs_adviser_contact: hasAppliedBefore,
        status: "awaiting_payment",
      })
      .select("*").single();
    if (insertErr || !application)
      return _json({ error: "Could not create your application. Please try again." }, 500);

    const { data: order, error: orderErr } = await svc
      .from("orders")
      .insert({
        user_id: userId,
        service_type: "bursary_application",
        service_ref_id: application.id,
        base_price_cents: basePriceCents,
        discount_cents: promoResult.discountCents,
        final_price_cents: promoResult.finalCents,
        promo_code_id: promoResult.promo?.id ?? null,
        status: "pending",
      })
      .select("*").single();
    if (orderErr || !order) {
      await svc.from("bursary_applications").update({ status: "payment_failed" }).eq("id", application.id);
      return _json({ error: "Could not start checkout. Please try again." }, 500);
    }

    await svc.from("bursary_applications").update({ order_id: order.id }).eq("id", application.id);

    // Fully-discounted — finalize immediately, no PayFast round trip.
    if (order.final_price_cents === 0) {
      if (promoResult.promo) {
        const { data: redeemed } = await svc.rpc("redeem_promo_code", {
          p_promo_id: promoResult.promo.id, p_max: promoResult.promo.max_redemptions,
        });
        if (!redeemed) {
          await svc.from("orders").update({ status: "failed" }).eq("id", order.id);
          await svc.from("bursary_applications").update({ status: "payment_failed" }).eq("id", application.id);
          return _json({ error: "That promo code was just used up. Please try again." }, 409);
        }
        await svc.from("promo_code_redemptions").insert({
          promo_code_id: promoResult.promo.id, user_id: userId, order_id: order.id,
        });
      }

      const finalStatus = hasAppliedBefore ? "Pending Adviser Contact" : "Submitted";
      await svc.from("bursary_applications").update({ status: finalStatus }).eq("id", application.id);
      await svc.from("orders").update({ status: "free_completed" }).eq("id", order.id);

      await _log(svc, userId, "submit_bursary_application", req, "ok", { application_id: application.id, free: true });
      return _json({ success: true, free: true, application: { id: application.id, status: finalStatus } });
    }

    const merchantId  = Deno.env.get("PAYFAST_MERCHANT_ID");
    const merchantKey = Deno.env.get("PAYFAST_MERCHANT_KEY");
    if (!merchantId || !merchantKey)
      return _json({ error: "Payment configuration error" }, 500);

    const amountStr = (order.final_price_cents / 100).toFixed(2);
    const payFastUrl = [
      "https://www.payfast.co.za/eng/process",
      `?merchant_id=${merchantId}`,
      `&merchant_key=${merchantKey}`,
      `&amount=${amountStr}`,
      `&item_name=${encodeURIComponent("Bursary Application: " + bursary.name)}`,
      `&item_description=${encodeURIComponent(pricing.name)}`,
      `&custom_str1=${userId}`,
      `&custom_str2=${order.id}`,
      `&custom_str3=bursary_application`,
      `&email_address=${encodeURIComponent(email)}`,
      `&return_url=${encodeURIComponent("https://www.querycrest.com/account/user-dashboard")}`,
      `&cancel_url=${encodeURIComponent("https://www.querycrest.com/account/user-dashboard")}`,
    ].join("");

    await _log(svc, userId, "submit_bursary_application", req, "ok", {
      application_id: application.id, order_id: order.id, amount: amountStr, promo: !!promoResult.promo,
    });
    return _json({ success: true, payFastUrl, awaiting_payment: true, application: { id: application.id } });
  } catch (err) {
    console.error("[submit-bursary-application]", err);
    return _json({ error: "Server error" }, 500);
  }
});