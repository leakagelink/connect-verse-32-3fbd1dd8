import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// AVAILABILITY
// ============================================================

const SlotSchema = z.object({
  dow: z.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const getMyAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("creator_availability")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    return (
      data ?? {
        user_id: userId,
        accepting_calls: true,
        slots: [],
        tz: "Asia/Kolkata",
      }
    );
  });

export const saveMyAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z
      .object({
        accepting_calls: z.boolean(),
        slots: z.array(SlotSchema).max(50),
        tz: z.string().min(1).max(64),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("creator_availability").upsert({
      user_id: userId,
      accepting_calls: data.accepting_calls,
      slots: data.slots,
      tz: data.tz,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// EARNINGS
// ============================================================

export const getMyEarnings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [rollup, daily, wallet] = await Promise.all([
      supabase
        .from("creator_earnings_30d")
        .select("*")
        .eq("creator_id", userId)
        .maybeSingle(),
      supabase
        .from("creator_earnings_daily")
        .select("day, coins")
        .eq("creator_id", userId)
        .order("day", { ascending: true }),
      supabase
        .from("wallets")
        .select("coin_balance")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    return {
      summary: rollup.data ?? {
        gift_coins_30d: 0,
        gift_count_30d: 0,
        unique_senders_30d: 0,
        call_seconds_30d: 0,
        call_count_30d: 0,
        fan_club_coins_30d: 0,
        fan_club_signups_30d: 0,
        total_coins_30d: 0,
      },
      daily: daily.data ?? [],
      balance: Number(wallet.data?.coin_balance ?? 0),
    };
  });

// ============================================================
// FAN CLUB — creator side
// ============================================================

export const getMyFanClub = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [club, members] = await Promise.all([
      supabase.from("fan_clubs").select("*").eq("creator_id", userId).maybeSingle(),
      supabase
        .from("fan_club_members")
        .select("fan_id, joined_at, expires_at, coins_paid")
        .eq("creator_id", userId)
        .order("joined_at", { ascending: false })
        .limit(100),
    ]);
    return { club: club.data, members: members.data ?? [] };
  });

export const saveMyFanClub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z
      .object({
        name: z.string().min(2).max(40),
        tagline: z.string().max(120).optional().nullable(),
        perks: z.array(z.string().max(80)).max(8),
        monthly_coins: z.number().int().min(50).max(50000),
        is_open: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("fan_clubs").upsert({
      creator_id: userId,
      name: data.name,
      tagline: data.tagline ?? null,
      perks: data.perks,
      monthly_coins: data.monthly_coins,
      is_open: data.is_open,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// FAN CLUB — fan side
// ============================================================

export const joinFanClub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ creatorId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    // Fan clubs are coin-priced — unavailable until monetization returns.
    assertFeatureEnabled(PAID_EXTRAS_ENABLED, FEATURE_OFF_MESSAGES.extras);
    const { userId } = context;
    if (userId === data.creatorId) throw new Error("Cannot join your own fan club");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Load club + fan wallet
    const [{ data: club }, { data: fanWallet }] = await Promise.all([
      supabaseAdmin.from("fan_clubs").select("*").eq("creator_id", data.creatorId).maybeSingle(),
      supabaseAdmin.from("wallets").select("coin_balance").eq("user_id", userId).maybeSingle(),
    ]);
    if (!club || !club.is_open) throw new Error("Fan club is not open right now");
    const cost = Number(club.monthly_coins);
    const fanBal = Number(fanWallet?.coin_balance ?? 0);
    if (fanBal < cost) throw new Error("Insufficient coins. Please recharge.");

    // 2. Already a member with active subscription? extend; else create
    const { data: existing } = await supabaseAdmin
      .from("fan_club_members")
      .select("expires_at")
      .eq("creator_id", data.creatorId)
      .eq("fan_id", userId)
      .maybeSingle();
    const now = new Date();
    const baseExpiry =
      existing && new Date(existing.expires_at) > now ? new Date(existing.expires_at) : now;
    const newExpiry = new Date(baseExpiry);
    newExpiry.setUTCDate(newExpiry.getUTCDate() + 30);

    // 3. Debit fan, credit creator (atomic-ish; same service call)
    const { data: creatorWallet } = await supabaseAdmin
      .from("wallets")
      .select("coin_balance")
      .eq("user_id", data.creatorId)
      .maybeSingle();

    const newFanBal = fanBal - cost;
    const newCreatorBal = Number(creatorWallet?.coin_balance ?? 0) + cost;

    await supabaseAdmin
      .from("wallets")
      .update({ coin_balance: newFanBal, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    await supabaseAdmin
      .from("wallets")
      .update({ coin_balance: newCreatorBal, updated_at: new Date().toISOString() })
      .eq("user_id", data.creatorId);

    await supabaseAdmin.from("fan_club_members").upsert({
      creator_id: data.creatorId,
      fan_id: userId,
      joined_at: existing ? existing.expires_at : now.toISOString(),
      expires_at: newExpiry.toISOString(),
      coins_paid: cost,
    });

    await supabaseAdmin.from("transactions").insert([
      {
        user_id: userId,
        type: "fan_club_spend",
        coins_delta: -cost,
        inr_amount: 0,
        metadata: { creator_id: data.creatorId, expires_at: newExpiry.toISOString() },
      },
      {
        user_id: data.creatorId,
        type: "fan_club_income",
        coins_delta: cost,
        inr_amount: 0,
        metadata: { fan_id: userId },
      },
    ]);

    return { ok: true, expires_at: newExpiry.toISOString(), balance: newFanBal };
  });

export const getFanClubFor = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ creatorId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const [{ data: club }, { data: membership }] = await Promise.all([
      supabase.from("fan_clubs").select("*").eq("creator_id", data.creatorId).maybeSingle(),
      supabase
        .from("fan_club_members")
        .select("expires_at, joined_at")
        .eq("creator_id", data.creatorId)
        .eq("fan_id", userId)
        .maybeSingle(),
    ]);
    const active = membership && new Date(membership.expires_at) > new Date();
    return { club, membership, active: !!active };
  });
