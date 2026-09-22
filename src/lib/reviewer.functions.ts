// Reviewer Mode — admin-gated shortcuts to quickly exercise the core flows
// (free trial, matching, coin recharge, and SOS safety) on a test account
// without going through the real payment or moderation pipelines.
//
// Every function requires the caller to have the `admin` role. Grant reviewers
// admin from the Admin panel before they log into /reviewer.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COINS_ENABLED, FREE_MINUTES_ENABLED } from "@/lib/feature-flags";

const FREE_TRIAL_SECONDS = 300; // 5 minutes
const TEST_COIN_GRANT = 500;

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Reviewer Mode is admin-only");
}

export const reviewerStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: profile }, { data: wallet }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("username, free_seconds_remaining, is_creator, gender")
        .eq("id", context.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("wallets")
        .select("coin_balance")
        .eq("user_id", context.userId)
        .maybeSingle(),
    ]);
    return {
      userId: context.userId,
      username: profile?.username ?? null,
      freeSeconds: Number(profile?.free_seconds_remaining ?? 0),
      coinBalance: Number(wallet?.coin_balance ?? 0),
      isCreator: Boolean(profile?.is_creator),
      gender: profile?.gender ?? null,
    };
  });

export const reviewerResetTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    // Free-minute quotas only exist when calls are billed. In the current free
    // release calls are unlimited, so there is no trial to reset.
    if (!FREE_MINUTES_ENABLED) {
      throw new Error("Calls are free and unlimited in this release — no trial quota to reset.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ free_seconds_remaining: FREE_TRIAL_SECONDS })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, freeSeconds: FREE_TRIAL_SECONDS };
  });

export const reviewerGrantCoins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ coins: z.number().int().min(1).max(100_000).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    // Coins are disabled in this release; no test grants can be issued.
    if (!COINS_ENABLED) {
      throw new Error("Coins are disabled in this release.");
    }
    const coins = data.coins ?? TEST_COIN_GRANT;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("coin_balance")
      .eq("user_id", context.userId)
      .maybeSingle();
    const current = Number(wallet?.coin_balance ?? 0);
    const next = current + coins;

    if (wallet) {
      const { error } = await supabaseAdmin
        .from("wallets")
        .update({ coin_balance: next, updated_at: new Date().toISOString() })
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("wallets")
        .insert({ user_id: context.userId, coin_balance: next });
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.from("transactions").insert({
      user_id: context.userId,
      type: "admin_credit",
      coins_delta: coins,
      inr_amount: 0,
      metadata: {
        admin_id: context.userId,
        reason: "reviewer_mode_test_grant",
        previous_balance: current,
        new_balance: next,
        requested_coins: coins,
      },
    });

    return { ok: true, balance: next, granted: coins };
  });

// Return one online creator that the reviewer can call to test matching.
// Excludes self and banned/deleted accounts.
export const reviewerFindMatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    let { data } = await supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url, is_creator, gender, last_seen_at")
      .neq("id", context.userId)
      .eq("is_banned", false)
      .eq("onboarded", true)
      .is("deleted_at", null)
      .eq("is_creator", true)
      .gte("last_seen_at", since)
      .order("last_seen_at", { ascending: false })
      .limit(1);

    // Fall back to any online user, then any user.
    if (!data?.length) {
      ({ data } = await supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, is_creator, gender, last_seen_at")
        .neq("id", context.userId)
        .eq("is_banned", false)
        .eq("onboarded", true)
        .is("deleted_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(1));
    }

    const match = data?.[0] ?? null;
    return { match };
  });

// Simulate an SOS safety flow: files a real report against a chosen target so
// the moderation queue is exercised end-to-end. Reason is fixed to
// `harassment` and clearly tagged as a reviewer test in `context`.
export const reviewerSimulateSOS = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ targetUserId: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let targetId = data.targetUserId;
    if (!targetId) {
      const { data: any } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .neq("id", context.userId)
        .eq("is_banned", false)
        .is("deleted_at", null)
        .limit(1);
      targetId = any?.[0]?.id;
    }
    if (!targetId) throw new Error("No target user available for SOS test");
    if (targetId === context.userId) throw new Error("Cannot SOS yourself");

    const { error } = await supabaseAdmin.from("reports").insert({
      reporter_id: context.userId,
      target_user_id: targetId,
      reason: "harassment",
      context: "[REVIEWER MODE] Simulated SOS — safe to dismiss.",
    });
    if (error) throw new Error(error.message);
    return { ok: true, targetUserId: targetId };
  });
