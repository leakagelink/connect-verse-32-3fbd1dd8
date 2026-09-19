import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { bonusForDeposit } from "./constants";
import { makeRechargeError } from "./recharge-errors";

const RechargeInput = z.object({ planId: z.string().uuid() });

/**
 * Test-only coin credit. This never runs for ordinary users: it is restricted
 * to admin accounts so the production build has no way to mint coins outside
 * Google Play Billing (a Play policy + fraud requirement).
 */
export const mockRecharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => RechargeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) {
      throw makeRechargeError(
        "GATEWAY_UNAVAILABLE",
        "Coin packs are purchased through Google Play.",
      );
    }


    const { data: plan, error: planErr } = await supabase
      .from("coin_plans")
      .select("id, price_inr, coins, is_active")
      .eq("id", data.planId)
      .maybeSingle();
    if (planErr) throw makeRechargeError("DB_UPDATE_FAILED", planErr.message);
    if (!plan) throw makeRechargeError("PLAN_NOT_FOUND", "Plan not found");
    if (!plan.is_active) throw makeRechargeError("PLAN_INACTIVE", "Plan is inactive");

    const { data: wallet, error: walletErr } = await supabase
      .from("wallets")
      .select("coin_balance, deposit_count, total_recharged_inr")
      .eq("user_id", userId)
      .maybeSingle();
    if (walletErr) throw makeRechargeError("DB_UPDATE_FAILED", walletErr.message);
    if (!wallet) throw makeRechargeError("WALLET_MISSING", "Wallet missing");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Idempotency guard — block accidental double-tap (same plan within 5s)
    const fiveSecAgo = new Date(Date.now() - 5000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("transactions")
      .select("id, created_at")
      .eq("user_id", userId)
      .eq("plan_id", plan.id)
      .eq("type", "recharge")
      .gte("created_at", fiveSecAgo)
      .limit(1);
    if (recent && recent.length > 0) {
      throw makeRechargeError(
        "ALREADY_PURCHASED",
        "This plan was credited a moment ago",
      );
    }

    const baseCoins = Number(plan.coins);
    const bonusPct = bonusForDeposit(wallet.deposit_count);
    const bonusCoins = Math.floor(baseCoins * bonusPct);

    const newBalance = Number(wallet.coin_balance) + baseCoins + bonusCoins;
    const newTotal = Number(wallet.total_recharged_inr) + Number(plan.price_inr);
    const newCount = wallet.deposit_count + 1;

    const { error: upErr } = await supabaseAdmin
      .from("wallets")
      .update({
        coin_balance: newBalance,
        total_recharged_inr: newTotal,
        deposit_count: newCount,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (upErr) throw makeRechargeError("DB_UPDATE_FAILED", upErr.message);

    await supabaseAdmin.from("transactions").insert({
      user_id: userId,
      type: "recharge",
      coins_delta: baseCoins,
      inr_amount: plan.price_inr,
      plan_id: plan.id,
      metadata: { mock: true },
    });
    if (bonusCoins > 0) {
      await supabaseAdmin.from("transactions").insert({
        user_id: userId,
        type: "bonus",
        coins_delta: bonusCoins,
        inr_amount: 0,
        plan_id: plan.id,
        metadata: { bonus_pct: bonusPct, deposit_no: newCount },
      });
    }

    // Phase 8: pay out referral bonus to referrer on referee's first recharge
    try {
      if (newCount === 1) {
        const { creditFirstRechargeReferralBonus } = await import("./engagement.server");
        await creditFirstRechargeReferralBonus(userId, baseCoins);
      }
    } catch (err) {
      // Referral bonus failures must never block the recharge itself.
      console.warn("referral bonus payout skipped:", err);
    }

    return {
      ok: true,
      added: baseCoins,
      bonus: bonusCoins,
      bonusPct,
      balance: newBalance,
    };
  });


export const getWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: wallet }, { data: profile }, { data: txns }] = await Promise.all([
      supabase.from("wallets").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("profiles").select("free_seconds_remaining").eq("id", userId).maybeSingle(),
      supabase.from("transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    ]);
    return {
      balance: Number(wallet?.coin_balance ?? 0),
      depositCount: wallet?.deposit_count ?? 0,
      totalRecharged: Number(wallet?.total_recharged_inr ?? 0),
      freeSeconds: profile?.free_seconds_remaining ?? 0,
      transactions: txns ?? [],
    };
  });

export const listPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("coin_plans")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");
    return data ?? [];
  });
