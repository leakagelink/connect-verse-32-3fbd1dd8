import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * List recent Razorpay orders for the signed-in user with the associated
 * plan label, so the wallet/receipts screen can show one row per purchase
 * along with its lifecycle status (created, paid, credited, failed, expired).
 */
export const listMyRechargeReceipts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(100).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = data.limit ?? 30;

    const { data: rows, error } = await supabaseAdmin
      .from("razorpay_orders")
      .select(
        "razorpay_order_id, razorpay_payment_id, plan_id, status, amount_paise, currency, coins_credited, bonus_credited, created_at, paid_at, credited_at, webhook_payload",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    if (!rows?.length) return [];

    const planIds = Array.from(
      new Set(rows.map((r) => r.plan_id).filter((x): x is string => !!x)),
    );
    let planMap = new Map<string, { label: string; coins: number }>();
    if (planIds.length) {
      const { data: plans } = await supabaseAdmin
        .from("coin_plans")
        .select("id, label, coins")
        .in("id", planIds);
      planMap = new Map(
        (plans ?? []).map((p) => [
          p.id as string,
          { label: p.label as string, coins: Number(p.coins ?? 0) },
        ]),
      );
    }

    return rows.map((r) => {
      const plan = r.plan_id ? planMap.get(r.plan_id) : null;
      const wp = (r.webhook_payload ?? {}) as Record<string, any>;
      const failureReason =
        (wp?.error_description as string | undefined) ??
        (wp?.error?.description as string | undefined) ??
        (wp?.error_reason as string | undefined) ??
        null;
      return {
        orderId: r.razorpay_order_id as string,
        paymentId: (r.razorpay_payment_id as string | null) ?? null,
        planLabel: plan?.label ?? null,
        planCoins: plan?.coins ?? null,
        status: r.status as
          | "created"
          | "paid"
          | "credited"
          | "failed"
          | "expired"
          | "refunded",
        amountPaise: Number(r.amount_paise ?? 0),
        currency: (r.currency as string) ?? "INR",
        coinsCredited: Number(r.coins_credited ?? 0),
        bonusCredited: Number(r.bonus_credited ?? 0),
        createdAt: r.created_at as string,
        paidAt: (r.paid_at as string | null) ?? null,
        creditedAt: (r.credited_at as string | null) ?? null,
        failureReason,
      };
    });
  });
