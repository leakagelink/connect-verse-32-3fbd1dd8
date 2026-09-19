import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Google Play Billing — server side.
 *
 * Rules enforced here:
 *  - The client NEVER tells us how many coins to credit. Coins come from the
 *    coin_plans row mapped to the Play product id.
 *  - Every purchase token is verified with the Play Developer API before any
 *    coins move.
 *  - Crediting goes through credit_play_purchase(), which claims the purchase
 *    token under a unique constraint, so replaying the same token is a no-op.
 *  - Without the Play service-account secret, verification fails closed.
 */

/** Coin packs that are purchasable through Google Play. */
export const listPlayPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("coin_plans")
      .select("id, label, coins, price_inr, play_product_id, sort_order")
      .eq("is_active", true)
      .not("play_product_id", "is", null)
      .order("sort_order");
    return data ?? [];
  });

/** Has the backend got everything it needs to accept real purchases? */
export const getBillingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { isPlayVerificationConfigured } = await import("./billing.server");
    const { count } = await context.supabase
      .from("coin_plans")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .not("play_product_id", "is", null);
    return {
      verificationConfigured: isPlayVerificationConfigured(),
      mappedProducts: count ?? 0,
    };
  });

const VerifyInput = z.object({
  productId: z.string().min(1).max(200),
  purchaseToken: z.string().min(10).max(4000),
});

/**
 * Verify a Play purchase and credit coins. Idempotent — safe to call again for
 * the same token from purchase-restore flows.
 */
export const verifyPlayPurchase = createServerFn({ method: "POST" })
  .validator((d: unknown) => VerifyInput.parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_banned")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.is_banned) throw new Error("Account suspended");

    const { data: plan } = await supabase
      .from("coin_plans")
      .select("id, coins, price_inr, label, is_active")
      .eq("play_product_id", data.productId)
      .maybeSingle();
    if (!plan || !plan.is_active) {
      throw new Error("This coin pack is not available.");
    }

    const { getPlayProductPurchase, acknowledgePlayPurchase } = await import("./billing.server");
    const purchase = await getPlayProductPurchase(data.productId, data.purchaseToken);

    // purchaseState: 0 purchased, 1 cancelled, 2 pending
    if (purchase.purchaseState === 2) {
      return { status: "pending" as const, coins: 0, bonus: 0 };
    }
    if (purchase.purchaseState !== 0) {
      return { status: "not_purchased" as const, coins: 0, bonus: 0 };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: credit, error } = await supabaseAdmin.rpc("credit_play_purchase", {
      _user_id: userId,
      _purchase_token: data.purchaseToken,
      _product_id: data.productId,
      _order_id: (purchase.orderId ?? null) as unknown as string,
      _purchase_time: (purchase.purchaseTimeMillis
        ? new Date(Number(purchase.purchaseTimeMillis)).toISOString()
        : null) as unknown as string,
      _acknowledged: purchase.acknowledgementState === 1,
      _payload: purchase as never,
    });
    if (error) throw new Error(error.message);

    const result = (credit ?? {}) as {
      ok?: boolean;
      reason?: string;
      already?: boolean;
      coins?: number;
      bonus?: number;
      balance?: number;
    };
    if (!result.ok) {
      if (result.reason === "token_owned_by_other_user") {
        throw new Error("This purchase belongs to a different account.");
      }
      if (result.reason === "revoked") {
        throw new Error("This purchase was refunded.");
      }
      throw new Error("Could not credit this purchase. Contact support.");
    }

    // Acknowledge only after coins are safely credited.
    if (purchase.acknowledgementState !== 1) {
      try {
        await acknowledgePlayPurchase(data.productId, data.purchaseToken);
      } catch (e) {
        console.warn("acknowledge failed (coins already credited)", e);
      }
    }

    return {
      status: (result.already ? "already_credited" : "credited") as
        | "credited"
        | "already_credited",
      coins: Number(result.coins ?? 0),
      bonus: Number(result.bonus ?? 0),
      balance: Number(result.balance ?? 0),
    };
  });

/** Recent Play purchases for the signed-in user (receipts screen). */
export const listMyPlayPurchases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("play_purchases")
      .select("id, product_id, order_id, coins, bonus_coins, status, purchase_time, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    return data ?? [];
  });
