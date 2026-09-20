import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COIN_REWARDS_ENABLED, FEATURE_OFF_MESSAGES, assertFeatureEnabled } from "./feature-flags";

// Day-N reward schedule (resets after day 7).
export const STREAK_REWARDS = [10, 20, 30, 50, 75, 100, 200];

// Signup bonus credited to the new user when they apply a referral code.
const REFERRAL_SIGNUP_BONUS_COINS = 50;
// Recharge bonus % credited to the referrer on the referee's first recharge.
const REFERRAL_RECHARGE_BONUS_PCT = 0.10;
const REFERRAL_RECHARGE_BONUS_CAP = 1000;

/** Today's UTC date as YYYY-MM-DD (matches Postgres DATE). */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// =============================================================
// DAILY CHECK-IN
// =============================================================

export const getCheckinStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("streak_days, last_checkin_date")
      .eq("id", userId)
      .maybeSingle();

    const today = todayUTC();
    const yest = yesterdayUTC();
    const last = prof?.last_checkin_date ?? null;
    const claimedToday = last === today;
    // Effective streak: if last==today or yesterday, keep; else reset to 0
    const effectiveStreak =
      last === today || last === yest ? (prof?.streak_days ?? 0) : 0;
    const nextDayIndex = claimedToday
      ? ((effectiveStreak - 1) % 7) + 1
      : (effectiveStreak % 7) + 1;
    const nextReward = STREAK_REWARDS[nextDayIndex - 1];

    return {
      claimedToday,
      streakDays: effectiveStreak,
      nextDayIndex,
      nextReward,
      schedule: STREAK_REWARDS,
    };
  });

export const claimDailyCheckin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // No coin rewards can be minted while the coin economy is off.
    assertFeatureEnabled(COIN_REWARDS_ENABLED, FEATURE_OFF_MESSAGES.coins);
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("streak_days, last_checkin_date")
      .eq("id", userId)
      .maybeSingle();
    if (profErr) throw new Error(profErr.message);
    if (!prof) throw new Error("Profile missing");

    const today = todayUTC();
    if (prof.last_checkin_date === today) {
      throw new Error("Already claimed today. Come back tomorrow!");
    }

    const yest = yesterdayUTC();
    const continued = prof.last_checkin_date === yest;
    const newStreak = continued ? (prof.streak_days ?? 0) + 1 : 1;
    const dayIndex = ((newStreak - 1) % 7) + 1;
    const reward = STREAK_REWARDS[dayIndex - 1];

    // Insert checkin log (unique constraint guards double-claim)
    const { error: insErr } = await supabaseAdmin.from("daily_checkins").insert({
      user_id: userId,
      checkin_date: today,
      day_index: dayIndex,
      coins_awarded: reward,
    });
    if (insErr) {
      if (insErr.code === "23505") throw new Error("Already claimed today.");
      throw new Error(insErr.message);
    }

    // Update profile streak
    await supabaseAdmin
      .from("profiles")
      .update({
        streak_days: newStreak,
        last_checkin_date: today,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    // Credit wallet + log transaction
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("coin_balance")
      .eq("user_id", userId)
      .maybeSingle();
    const newBalance = Number(wallet?.coin_balance ?? 0) + reward;
    await supabaseAdmin
      .from("wallets")
      .update({ coin_balance: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    await supabaseAdmin.from("transactions").insert({
      user_id: userId,
      type: "daily_checkin",
      coins_delta: reward,
      inr_amount: 0,
      metadata: { day_index: dayIndex, streak: newStreak },
    });

    return { ok: true, reward, dayIndex, streakDays: newStreak, balance: newBalance };
  });

// =============================================================
// REFERRALS
// =============================================================

export const getMyReferralStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: prof }, { data: refs }] = await Promise.all([
      supabase
        .from("profiles")
        .select("referral_code, referred_by")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("referrals")
        .select(
          "id, referee_id, code_used, signup_bonus_coins, recharge_bonus_coins, first_recharge_at, created_at",
        )
        .eq("referrer_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const totalCoinsEarned = (refs ?? []).reduce(
      (s, r) => s + (r.recharge_bonus_coins ?? 0),
      0,
    );
    const converted = (refs ?? []).filter((r) => r.first_recharge_at).length;

    return {
      code: prof?.referral_code ?? null,
      referredBy: prof?.referred_by ?? null,
      totalReferrals: refs?.length ?? 0,
      converted,
      totalCoinsEarned,
      referrals: refs ?? [],
    };
  });

export const applyReferralCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ code: z.string().trim().min(4).max(16) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const code = data.code.toUpperCase();

    const { data: me } = await supabase
      .from("profiles")
      .select("id, referred_by, referral_code, created_at")
      .eq("id", userId)
      .maybeSingle();
    if (!me) throw new Error("Profile missing");
    if (me.referred_by) throw new Error("You have already applied a referral code.");
    if (me.referral_code === code) throw new Error("You cannot use your own code.");

    // Only allow applying within first 7 days of signup to prevent abuse
    const ageDays =
      (Date.now() - new Date(me.created_at as string).getTime()) / 86400000;
    if (ageDays > 7) {
      throw new Error("Referral codes can only be applied within 7 days of signup.");
    }

    const { data: referrer } = await supabaseAdmin
      .from("profiles")
      .select("id, is_banned")
      .eq("referral_code", code)
      .maybeSingle();
    if (!referrer) throw new Error("Invalid referral code.");
    if (referrer.is_banned) throw new Error("This referral code is no longer valid.");
    if (referrer.id === userId) throw new Error("You cannot use your own code.");

    // Mark referee + create referrals row
    const { error: upErr } = await supabaseAdmin
      .from("profiles")
      .update({ referred_by: referrer.id, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (upErr) throw new Error(upErr.message);

    const { error: refErr } = await supabaseAdmin.from("referrals").insert({
      referrer_id: referrer.id,
      referee_id: userId,
      code_used: code,
      signup_bonus_coins: REFERRAL_SIGNUP_BONUS_COINS,
    });
    if (refErr) {
      if (refErr.code === "23505") throw new Error("Referral already recorded.");
      throw new Error(refErr.message);
    }

    // Credit signup bonus to referee
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("coin_balance")
      .eq("user_id", userId)
      .maybeSingle();
    const newBalance =
      Number(wallet?.coin_balance ?? 0) + REFERRAL_SIGNUP_BONUS_COINS;
    await supabaseAdmin
      .from("wallets")
      .update({ coin_balance: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    await supabaseAdmin.from("transactions").insert({
      user_id: userId,
      type: "referral_bonus",
      coins_delta: REFERRAL_SIGNUP_BONUS_COINS,
      inr_amount: 0,
      metadata: { kind: "signup", code, referrer_id: referrer.id },
    });

    return {
      ok: true,
      bonus: REFERRAL_SIGNUP_BONUS_COINS,
      balance: newBalance,
    };
  });

// =============================================================
// LEADERBOARD
// =============================================================

export const getCreatorLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("creator_leaderboard_7d")
      .select("user_id, username, avatar_url, country, language, is_creator, coins_received, gifts_count")
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
