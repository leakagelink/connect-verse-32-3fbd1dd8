import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withAiAvatars } from "./ai-avatar";

// If `resumeId` is supplied AND it matches an in-progress call between the
// same two users that was last touched within RESUME_WINDOW_SECONDS, we
// reuse it instead of creating a duplicate row. This is what lets a refresh
// / reconnect continue the same call_log without double-charging the user.
const RESUME_WINDOW_SECONDS = 5 * 60;

// Cooling-off: new male accounts (first 24h since signup) may only initiate
// NEW_MALE_DAILY_CALL_CAP outbound calls in their first 24h. Drastically cuts
// spam/harassment from disposable accounts.
const NEW_MALE_DAILY_CALL_CAP = 10;
const NEW_ACCOUNT_WINDOW_HOURS = 24;

export const startCallLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: {
    calleeId: string;
    kind: "voice" | "video";
    resumeId?: string | null;
  }) => input)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // ---- Pre-flight safety checks ----
    const [{ data: caller }, { data: callee }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, gender, country, state, is_banned, created_at")
        .eq("id", userId)
        .is("deleted_at", null)
        .maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("id, availability, blocked_countries, blocked_states, is_banned, onboarded")
        .eq("id", data.calleeId)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);

    if (!caller || caller.is_banned) {
      throw new Error("Your account is suspended.");
    }
    if (!callee || callee.is_banned || !callee.onboarded) {
      throw new Error("This person isn't available right now.");
    }

    // Callee availability: busy = no new calls, dnd = same.
    if (callee.availability && callee.availability !== "online") {
      throw new Error(
        callee.availability === "dnd"
          ? "This creator is on Do Not Disturb."
          : "This creator is busy right now.",
      );
    }

    // Callee's geo blocklist
    const blockedCountries: string[] = (callee as any).blocked_countries ?? [];
    const blockedStates: string[] = (callee as any).blocked_states ?? [];
    if (caller.country && blockedCountries.includes(caller.country)) {
      throw new Error("This creator does not accept calls from your country.");
    }
    if (caller.state && blockedStates.includes(caller.state)) {
      throw new Error("This creator does not accept calls from your state.");
    }

    // Cooling-off cap for brand-new male accounts
    if (caller.gender === "male" && caller.created_at) {
      const accountAgeHours = (Date.now() - new Date(caller.created_at).getTime()) / 3600_000;
      if (accountAgeHours < NEW_ACCOUNT_WINDOW_HOURS) {
        const since = new Date(Date.now() - 24 * 3600_000).toISOString();
        const { count } = await supabaseAdmin
          .from("call_logs")
          .select("id", { count: "exact", head: true })
          .eq("caller_id", userId)
          .gte("started_at", since);
        if ((count ?? 0) >= NEW_MALE_DAILY_CALL_CAP) {
          throw new Error(
            `New accounts are limited to ${NEW_MALE_DAILY_CALL_CAP} calls in the first 24 hours. This cap lifts automatically.`,
          );
        }
      }
    }

    if (data.resumeId) {
      const { data: existing } = await supabaseAdmin
        .from("call_logs")
        .select("id, caller_id, callee_id, kind, ended_at, last_flushed_at, started_at, duration_seconds, coins_spent, free_seconds_used")
        .eq("id", data.resumeId)
        .maybeSingle();
      const lastTouch = existing?.last_flushed_at ?? existing?.started_at;
      const fresh = lastTouch
        ? (Date.now() - new Date(lastTouch).getTime()) / 1000 < RESUME_WINDOW_SECONDS
        : false;
      if (
        existing &&
        existing.caller_id === userId &&
        existing.callee_id === data.calleeId &&
        existing.kind === data.kind &&
        !existing.ended_at &&
        fresh
      ) {
        return {
          id: existing.id as string,
          resumed: true,
          baselineDurationSeconds: Number(existing.duration_seconds ?? 0),
          baselineFreeSecondsUsed: Number(existing.free_seconds_used ?? 0),
          baselineCoinsSpent: Number(existing.coins_spent ?? 0),
        };
      }
    }

    const { data: row, error } = await supabaseAdmin
      .from("call_logs")
      .insert({
        caller_id: userId,
        callee_id: data.calleeId,
        kind: data.kind,
        status: "completed",
      })
      .select("id")
      .single();
    if (error) throw error;

    return {
      id: row.id as string,
      resumed: false,
      baselineDurationSeconds: 0,
      baselineFreeSecondsUsed: 0,
      baselineCoinsSpent: 0,
    };
  });


export const endCallLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: {
    id: string;
    durationSeconds: number;
    coinsSpent: number;
    status?: "completed" | "cancelled";
    endReason?: "user_ended" | "peer_left" | "coins_exhausted" | "media_error" | "network" | "unknown";
  }) => input)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Verify ownership: only the caller or callee can end their own call.
    const { data: log } = await supabaseAdmin
      .from("call_logs")
      .select("caller_id, callee_id, end_reason, ended_by")
      .eq("id", data.id)
      .maybeSingle();
    if (!log || (log.caller_id !== userId && log.callee_id !== userId)) {
      throw new Error("Not authorized to end this call.");
    }
    // Don't overwrite an already-recorded end_reason (first side to report wins,
    // so "peer_left" from the survivor doesn't clobber "coins_exhausted" from
    // the payer who actually triggered the disconnect).
    const patch: {
      ended_at: string;
      duration_seconds: number;
      coins_spent: number;
      status: string;
      end_reason?: string;
      ended_by?: string;
    } = {
      ended_at: new Date().toISOString(),
      duration_seconds: data.durationSeconds,
      coins_spent: data.coinsSpent,
      status: data.status ?? "completed",
    };
    if (!log.end_reason && data.endReason) {
      patch.end_reason = data.endReason;
      patch.ended_by = userId;
    }
    const { error } = await supabaseAdmin
      .from("call_logs")
      .update(patch)
      .eq("id", data.id);

    if (error) throw error;
    return { ok: true };
  });



// Periodic heartbeat from the active call screen: persist the seconds-of-free-time
// and coins consumed so far. Lets the "5:00 free" countdown / coin balance survive
// reconnects, refresh, accidental tab close, or app restart.
// Idempotent usage reconciliation.
//
// The client sends CUMULATIVE totals for this call_log (free seconds used so
// far + coins spent so far + elapsed seconds). The server compares against
// what is already persisted on the call_logs row and applies only the delta.
// This means:
//   - duplicate flushes are no-ops
//   - a reconnect that resumes the same call_log can safely re-send totals
//   - if a flush is lost, the next one self-heals via the stored cumulative
export const applyCallUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: {
    callLogId: string;
    idempotencyKey: string;
    totalFreeSeconds: number;
    totalCoins: number;
    elapsedSeconds: number;
  }) => input)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const sentFree = Math.max(0, Math.floor(data.totalFreeSeconds || 0));
    const sentCoins = Math.max(0, Math.floor(data.totalCoins || 0));
    const sentElapsed = Math.max(0, Math.floor(data.elapsedSeconds || 0));
    const idemKey = String(data.idempotencyKey || "").slice(0, 80);
    if (!idemKey) {
      return { ok: false, freeSeconds: null, balance: null, reason: "missing-key" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Idempotency: if we've already seen this (call_log_id, idempotency_key)
    // pair, return the original outcome and apply nothing again.
    const { data: existingFlush } = await supabaseAdmin
      .from("call_usage_flushes")
      .select("applied_free_delta, applied_coins_delta")
      .eq("call_log_id", data.callLogId)
      .eq("idempotency_key", idemKey)
      .maybeSingle();
    if (existingFlush) {
      return {
        ok: true,
        freeSeconds: null,
        balance: null,
        deltaFree: Number(existingFlush.applied_free_delta ?? 0),
        deltaCoins: Number(existingFlush.applied_coins_delta ?? 0),
        deduped: true,
      };
    }

    // Verify ownership of the call.
    const { data: log, error: logErr } = await supabaseAdmin
      .from("call_logs")
      .select("id, caller_id, duration_seconds, coins_spent, free_seconds_used, ended_at")
      .eq("id", data.callLogId)
      .maybeSingle();
    if (logErr) throw logErr;
    if (!log || log.caller_id !== userId) {
      return { ok: false, freeSeconds: null, balance: null, reason: "no-log" };
    }

    const storedFree = Number(log.free_seconds_used ?? 0);
    const storedCoins = Number(log.coins_spent ?? 0);
    const storedDuration = Number(log.duration_seconds ?? 0);

    const deltaFree = Math.max(0, sentFree - storedFree);
    const deltaCoins = Math.max(0, sentCoins - storedCoins);

    // Reserve the idempotency slot BEFORE touching wallets/profile. A unique
    // constraint on (call_log_id, idempotency_key) makes concurrent retries
    // collide here, so only one wins and gets to apply the delta.
    const { error: reserveErr } = await supabaseAdmin
      .from("call_usage_flushes")
      .insert({
        call_log_id: data.callLogId,
        idempotency_key: idemKey,
        total_free_seconds: sentFree,
        total_coins: sentCoins,
        elapsed_seconds: sentElapsed,
        applied_free_delta: deltaFree,
        applied_coins_delta: deltaCoins,
      });
    if (reserveErr) {
      // Lost the race: another concurrent flush with the same key already won.
      // Treat as a successful dedupe rather than failing the request.
      return {
        ok: true,
        freeSeconds: null,
        balance: null,
        deltaFree: 0,
        deltaCoins: 0,
        deduped: true,
      };
    }

    let freeSeconds: number | null = null;
    if (deltaFree > 0) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("free_seconds_remaining")
        .eq("id", userId)
        .maybeSingle();
      const current = Number(prof?.free_seconds_remaining ?? 0);
      const next = Math.max(0, current - deltaFree);
      await supabaseAdmin
        .from("profiles")
        .update({ free_seconds_remaining: next })
        .eq("id", userId);
      freeSeconds = next;
    }

    let balance: number | null = null;
    if (deltaCoins > 0) {
      const { data: wallet } = await supabaseAdmin
        .from("wallets")
        .select("coin_balance")
        .eq("user_id", userId)
        .maybeSingle();
      const current = Number(wallet?.coin_balance ?? 0);
      const next = Math.max(0, current - deltaCoins);
      await supabaseAdmin
        .from("wallets")
        .update({ coin_balance: next, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      balance = next;

      await supabaseAdmin.from("transactions").insert({
        user_id: userId,
        type: "chat_spend",
        coins_delta: -deltaCoins,
        inr_amount: 0,
        metadata: {
          call_log_id: data.callLogId,
          seconds: sentElapsed,
          idempotency_key: idemKey,
          reconciled: true,
        },
      });
    }

    await supabaseAdmin
      .from("call_logs")
      .update({
        duration_seconds: Math.max(storedDuration, sentElapsed),
        coins_spent: storedCoins + deltaCoins,
        free_seconds_used: storedFree + deltaFree,
        last_flushed_at: new Date().toISOString(),
      })
      .eq("id", data.callLogId);

    return { ok: true, freeSeconds, balance, deltaFree, deltaCoins, deduped: false };
  });



export type RecentCall = {
  id: string;
  kind: "voice" | "video";
  direction: "outgoing" | "incoming";
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  coins_spent: number;
  status: "completed" | "missed" | "cancelled";
  missed_reason: "expired" | "caller_cancelled" | "callee_rejected" | null;
  partner: {
    id: string;
    username: string | null;
    avatar_url: string | null;
    country: string | null;
    state: string | null;
  };
};

export const listRecentCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RecentCall[]> => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabase
      .from("call_logs")
      .select("id, kind, caller_id, callee_id, started_at, ended_at, duration_seconds, coins_spent, status, missed_reason")
      .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
      .order("started_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const partnerIds = Array.from(
      new Set((data ?? []).map((r) => (r.caller_id === userId ? r.callee_id : r.caller_id)))
    );
    let profilesById = new Map<string, any>();
    if (partnerIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, ai_avatar_style, gender, country, state, is_banned, onboarded, deleted_at")
        .in("id", partnerIds)
        .eq("is_banned", false)
        .eq("onboarded", true)
        .is("deleted_at", null);
      profilesById = new Map(withAiAvatars(profs ?? []).map((p) => [p.id as string, p]));
    }

    return (data ?? []).map((r: any) => {
      const partnerId = r.caller_id === userId ? r.callee_id : r.caller_id;
      const p = profilesById.get(partnerId) ?? {};
      return {
        id: r.id,
        kind: r.kind as "voice" | "video",
        direction: r.caller_id === userId ? "outgoing" : "incoming",
        started_at: r.started_at,
        ended_at: r.ended_at,
        duration_seconds: r.duration_seconds,
        coins_spent: r.coins_spent,
        status: r.status as "completed" | "missed" | "cancelled",
        missed_reason: (r.missed_reason ?? null) as RecentCall["missed_reason"],
        partner: {
          id: partnerId,
          username: p.username ?? null,
          avatar_url: p.avatar_url ?? null,
          country: p.country ?? null,
          state: p.state ?? null,
        },
      };
    });
  });
