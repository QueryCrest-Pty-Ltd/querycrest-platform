import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const CORS = {
  "Access-Control-Allow-Origin":      "https://www.querycrest.com",
  "Access-Control-Allow-Headers":     "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":     "POST, OPTIONS",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return _json({ error: "Method not allowed" }, 405);
  try {
    const auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId, svc } = auth;

    // Generous limit — this is read-only and users may try a code, typo
    // it, and retry a few times.
    const rl = await _rateLimit(svc, userId, "validate_promo_code", 20, 60);
    if (rl) return rl;

    const body = await req.json().catch(() => ({}));
    const rawCode = body.code; // optional — omit to just fetch the base price
    const serviceType = _clean(body.service_type, 60);
    if (!serviceType) return _json({ error: "service_type is required." }, 400);

    let basePriceCents = 0;
    if (serviceType === "application_plan") {
      const planId = _clean(body.service_ref_id, 60);
      if (!planId) return _json({ error: "A plan must be selected first." }, 400);
      const { data: plan } = await svc.from("plans").select("price").eq("plan_id", planId).single();
      if (!plan) return _json({ error: "Invalid plan." }, 400);
      basePriceCents = Math.round(Number(plan.price) * 100);
    } else if (serviceType === "bursary_application") {
      const { data: pricing } = await svc
        .from("service_pricing").select("price_cents").eq("service_key", "bursary_application").eq("active", true).maybeSingle();
      if (!pricing) return _json({ error: "Bursary applications are temporarily unavailable." }, 500);
      basePriceCents = pricing.price_cents;
    } else {
      return _json({ error: "Unknown service type." }, 400);
    }

    const promoResult = await _applyPromo(svc, rawCode, serviceType, userId, basePriceCents);
    if (!promoResult.ok) return _json({ valid: false, error: promoResult.error });

    return _json({
      valid: true,
      promo_applied: !!promoResult.promo,
      discount_type: promoResult.promo?.discount_type ?? null,
      base_price: basePriceCents / 100,
      discount: promoResult.discountCents / 100,
      final_price: promoResult.finalCents / 100,
    });
  } catch {
    return _json({ error: "Server error" }, 500);
  }
});