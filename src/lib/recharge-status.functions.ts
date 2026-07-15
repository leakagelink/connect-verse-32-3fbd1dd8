import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ orderId: z.string().min(1).max(100) });

/**
 * Read the current status of one Razorpay order the caller owns, plus the
 * plan label and any coins/bonus that were credited. Used by the recharge
 * status screen to poll for the webhook outcome after the user completes
 * (or cancels) checkout.
 */
export const getRechargeOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ord, error } = await supabaseAdmin
      .from("razorpay_orders")
      .select(
        "user_id, status, amount_paise, currency, coins_credited, bonus_credited, created_at, paid_at, credited_at, plan_id",
      )
      .eq("razorpay_order_id", data.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ord || ord.user_id !== context.userId) throw new Error("Order not found");

    let planLabel: string | null = null;
    if (ord.plan_id) {
      const { data: plan } = await supabaseAdmin
        .from("coin_plans")
        .select("label")
        .eq("id", ord.plan_id)
        .maybeSingle();
      planLabel = plan?.label ?? null;
    }

    return {
      orderId: data.orderId,
      status: ord.status as string, // created | paid | credited | failed | expired
      amountPaise: ord.amount_paise as number,
      currency: ord.currency as string,
      coins: Number(ord.coins_credited ?? 0),
      bonus: Number(ord.bonus_credited ?? 0),
      planLabel,
      createdAt: ord.created_at as string,
      paidAt: ord.paid_at as string | null,
      creditedAt: ord.credited_at as string | null,
    };
  });
