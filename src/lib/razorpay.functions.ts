import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPaymentSettings } from "./payments.functions";

const CreateOrderInput = z.object({ planId: z.string().uuid() });

export const createRazorpayOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => CreateOrderInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const settings = await getPaymentSettings();
    const keyId = settings.key_id;
    const keySecret = settings.key_secret;
    if (settings.mode !== "live" || !keyId || !keySecret) {
      throw new Error("Live payments not configured. Switch to live mode in Admin → Payments after adding Razorpay keys.");
    }

    // Verify plan
    const { data: plan, error: planErr } = await supabase
      .from("coin_plans")
      .select("id, price_inr, coins, is_active, label")
      .eq("id", data.planId)
      .maybeSingle();
    if (planErr) throw new Error(planErr.message);
    if (!plan || !plan.is_active) throw new Error("Plan unavailable");

    const amountPaise = Math.round(Number(plan.price_inr) * 100);

    // Check user is not banned
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_banned, username")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.is_banned) throw new Error("Account suspended");

    // Create Razorpay order via REST API
    const receipt = `rcpt_${Date.now().toString(36)}_${userId.slice(0, 8)}`;
    const auth = btoa(`${keyId}:${keySecret}`);
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes: { user_id: userId, plan_id: plan.id, plan_label: plan.label },
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("Razorpay order error:", res.status, txt);
      throw new Error("Failed to create payment order. Try again.");
    }
    const order = (await res.json()) as { id: string; amount: number; currency: string };

    // Persist order via admin client
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: insErr } = await supabaseAdmin.from("razorpay_orders").insert({
      user_id: userId,
      plan_id: plan.id,
      razorpay_order_id: order.id,
      amount_paise: amountPaise,
      currency: "INR",
      status: "created",
      notes: { receipt, plan_label: plan.label },
    });
    if (insErr) throw new Error(insErr.message);

    return {
      orderId: order.id,
      amount: amountPaise,
      currency: "INR",
      keyId,
      planLabel: plan.label,
      username: profile?.username ?? "",
    };
  });

const VerifyInput = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
});

// Client-side verification fallback (also handled by webhook). Idempotent.
export const verifyRazorpayPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => VerifyInput.parse(d))
  .handler(async ({ data, context }) => {
    const settings = await getPaymentSettings();
    const keySecret = settings.key_secret;
    if (!keySecret) throw new Error("Gateway not configured");

    // HMAC-SHA256(order_id|payment_id, key_secret) === signature
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(keySecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      enc.encode(`${data.razorpay_order_id}|${data.razorpay_payment_id}`),
    );
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (hex !== data.razorpay_signature) {
      throw new Error("Invalid signature");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Confirm order belongs to this user
    const { data: ord } = await supabaseAdmin
      .from("razorpay_orders")
      .select("user_id, status")
      .eq("razorpay_order_id", data.razorpay_order_id)
      .maybeSingle();
    if (!ord || ord.user_id !== context.userId) throw new Error("Order mismatch");

    if (ord.status !== "credited") {
      await supabaseAdmin
        .from("razorpay_orders")
        .update({ status: "paid", razorpay_payment_id: data.razorpay_payment_id, paid_at: new Date().toISOString() })
        .eq("razorpay_order_id", data.razorpay_order_id);
    }

    const { data: credit } = await supabaseAdmin.rpc("credit_razorpay_payment", {
      _order_id: data.razorpay_order_id,
      _payment_id: data.razorpay_payment_id,
      _payload: { source: "client_verify" },
    });

    return { ok: true, credit };
  });
