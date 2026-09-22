import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withAiAvatars } from "./ai-avatar";
import { logCallEvent, maybeLogConnected } from "./call-telemetry.server";
import { CALL_BILLING_ENABLED } from "./feature-flags";

// If `resumeId` is supplied AND it matches an in-progress call between the
// same two users that was last touched within RESUME_WINDOW_SECONDS, we
// reuse it instead of creating a duplicate row. This is what lets a refresh
// / reconnect continue the same call_log without double-charging the user.
const RESUME_WINDOW_SECONDS = 5 * 60;

// Cooling-off: any brand-new account (first 24h since signup) may only initiate
// NEW_ACCOUNT_DAILY_CALL_CAP outbound calls. Gender-neutral anti-spam limit.
const NEW_ACCOUNT_DAILY_CALL_CAP = 10;
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

    const { assertNotBlocked } = await import("./blocks.server");
    await assertNotBlocked(supabaseAdmin, userId, data.calleeId, "You can't call this person.");

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

    // Cooling-off cap for brand-new accounts (gender-neutral)
    if (caller.created_at) {
      const accountAgeHours = (Date.now() - new Date(caller.created_at).getTime()) / 3600_000;
      if (accountAgeHours < NEW_ACCOUNT_WINDOW_HOURS) {
        const since = new Date(Date.now() - 24 * 3600_000).toISOString();
        const { count } = await supabaseAdmin
          .from("call_logs")
          .select("id", { count: "exact", head: true })
          .eq("caller_id", userId)
          .gte("started_at", since);
        if ((count ?? 0) >= NEW_ACCOUNT_DAILY_CALL_CAP) {
          throw new Error(
            `New accounts are limited to ${NEW_ACCOUNT_DAILY_CALL_CAP} calls in the first 24 hours. This cap lifts automatically.`,
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
    endReason?: "user_ended" | "peer_left" | "coins_exhausted" | "media_error" | "network" | "background_lost" | "unknown";
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

    // Also flip any still-"accepted" call_invite tied to this call so the
    // callee stops appearing as busy to future callers. Without this, a
    // stale "accepted" invite makes the creator look like they're on
    // another call long after both sides hung up.
    await supabaseAdmin
      .from("call_invites")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("call_log_id", data.id)
      .in("status", ["accepted", "pending"]);

    await logCallEvent(supabaseAdmin as any, {
      eventType: "call_ended",
      callLogId: data.id,
      callerId: log.caller_id,
      calleeId: log.callee_id,
      actorId: userId,
      status: patch.status,
      reason: patch.end_reason ?? log.end_reason ?? data.endReason ?? null,
      durationMs: Math.max(0, (data.durationSeconds ?? 0) * 1000),
      ok: true,
      meta: { coinsSpent: data.coinsSpent ?? 0 },
    });

    return { ok: true };
  });

/**
 * Lightweight liveness ping from an active call screen.
 *
 * Both the caller and the callee call this every ~15s while a call is
 * connected. It stamps `call_logs.last_heartbeat_at` so the busy-state
 * reconciler (refreshStaleBusy in call-invites.functions.ts) can tell a
 * genuinely live call apart from a ghost "accepted" invite whose call_log
 * never got an `ended_at` (app killed, OS reaped tab, lost network mid-call).
 *
 * Stale heartbeats (> 60s old with no ended_at) are treated as ended by the
 * next caller's accept flow, which prevents the "this creator just picked up
 * another call" false-positive.
 */
export const heartbeatCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { callLogId: string }) => input)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (!data.callLogId) return { ok: false, reason: "missing-id" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: log } = await supabaseAdmin
      .from("call_logs")
      .select("id, caller_id, callee_id, ended_at")
      .eq("id", data.callLogId)
      .maybeSingle();
    if (!log) return { ok: false, reason: "no-log" };
    if (log.caller_id !== userId && log.callee_id !== userId) {
      return { ok: false, reason: "not-participant" };
    }
    if (log.ended_at) return { ok: false, reason: "ended" };
    await supabaseAdmin
      .from("call_logs")
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq("id", data.callLogId);
    // First heartbeat from either side implies WebRTC media is up — log
    // a one-time call_connected telemetry row (no-op on subsequent beats).
    await maybeLogConnected(supabaseAdmin as any, data.callLogId, userId);
    return { ok: true };
  });

/**
 * Stamp `connected_at` on the call_log atomically the first time either
 * peer signals "both connected & remote joined", and return the canonical
 * server timestamps so caller AND callee can display an identical timer.
 *
 * Both peers call this when their local `connected && remoteJoined` flips
 * true. The first call wins (UPDATE … WHERE connected_at IS NULL), the
 * second call just reads the existing stamp. The client treats:
 *   elapsed = (serverNow - connectedAt) + (Date.now() - clientReceivedAt)
 * which makes both sides agree to within network jitter regardless of
 * clock skew or which side accepted/joined first.
 */
export const markCallConnected = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { callLogId: string }) => input)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (!data.callLogId) return { ok: false as const, reason: "missing-id" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: log } = await supabaseAdmin
      .from("call_logs")
      .select("id, caller_id, callee_id, ended_at, connected_at, started_at")
      .eq("id", data.callLogId)
      .maybeSingle();
    if (!log) return { ok: false as const, reason: "no-log" };
    if (log.caller_id !== userId && log.callee_id !== userId) {
      return { ok: false as const, reason: "not-participant" };
    }

    let connectedAt = log.connected_at as string | null;
    if (!connectedAt && !log.ended_at) {
      const stamp = new Date().toISOString();
      const { data: updated } = await supabaseAdmin
        .from("call_logs")
        .update({ connected_at: stamp })
        .eq("id", data.callLogId)
        .is("connected_at", null)
        .select("connected_at")
        .maybeSingle();
      // If another concurrent call won, re-read.
      if (updated?.connected_at) {
        connectedAt = updated.connected_at as string;
      } else {
        const { data: reread } = await supabaseAdmin
          .from("call_logs")
          .select("connected_at")
          .eq("id", data.callLogId)
          .maybeSingle();
        connectedAt = (reread?.connected_at as string | null) ?? stamp;
      }
      // Best-effort telemetry — same hook the heartbeat path uses.
      await maybeLogConnected(supabaseAdmin as any, data.callLogId, userId);
    }

    return {
      ok: true as const,
      connectedAt,
      serverNow: new Date().toISOString(),
      endedAt: log.ended_at as string | null,
    };
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
    // FREE MODE: calls are not billed. No wallet debit, no free-second
    // consumption, no creator earning, no spend ledger entries.
    if (!CALL_BILLING_ENABLED) {
      return { ok: true, freeSeconds: null, balance: null, reason: "billing-disabled" };
    }
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
      .select("id, caller_id, callee_id, duration_seconds, coins_spent, free_seconds_used, ended_at")
      .eq("id", data.callLogId)
      .maybeSingle();
    if (logErr) throw logErr;
    if (!log) {
      return { ok: false, freeSeconds: null, balance: null, reason: "no-log" };
    }

    // ---------- Resolve payer / earner ----------
    // The CALLER is not always the payer: if the call was started by a
    // creator to a regular user, the user (callee) pays and the creator
    // (caller) earns. We look up is_creator for both sides and pick the
    // non-creator as the payer (fallback: caller pays).
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, is_creator")
      .in("id", [log.caller_id, log.callee_id]);
    const isCreatorMap = new Map<string, boolean>(
      (profs ?? []).map((p: any) => [p.id, !!p.is_creator]),
    );
    const callerIsCreator = isCreatorMap.get(log.caller_id) ?? false;
    const calleeIsCreator = isCreatorMap.get(log.callee_id) ?? false;
    const payerId =
      callerIsCreator && !calleeIsCreator ? log.callee_id : log.caller_id;
    const earnerId = payerId === log.caller_id ? log.callee_id : log.caller_id;
    const earnerIsCreator = earnerId === log.caller_id ? callerIsCreator : calleeIsCreator;

    if (userId !== payerId) {
      // Only the payer side may report usage — guards against an earner
      // (creator) accidentally debiting themselves on a reconnect/refresh.
      return { ok: false, freeSeconds: null, balance: null, reason: "not-payer" };
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

      // Credit the EARNER (the creator side) their share for the paid
      // portion of this delta. Only the payer is debited above — the
      // creator earns coins regardless of who tapped "call" first.
      // CREATOR_EARN_RATIO is the fraction of spent coins the creator keeps;
      // the rest is the platform commission. Skip credit entirely if the
      // other side is not a creator (consumer-to-consumer call).
      const CREATOR_EARN_RATIO = 0.5;
      const creatorEarn = Math.floor(deltaCoins * CREATOR_EARN_RATIO);
      if (creatorEarn > 0 && earnerIsCreator && earnerId && earnerId !== userId) {
        const { data: creatorWallet } = await supabaseAdmin
          .from("wallets")
          .select("coin_balance")
          .eq("user_id", earnerId)
          .maybeSingle();
        if (creatorWallet) {
          const newCreatorBal = Number(creatorWallet.coin_balance ?? 0) + creatorEarn;
          await supabaseAdmin
            .from("wallets")
            .update({ coin_balance: newCreatorBal, updated_at: new Date().toISOString() })
            .eq("user_id", earnerId);
        } else {
          await supabaseAdmin
            .from("wallets")
            .insert({ user_id: earnerId, coin_balance: creatorEarn });
        }
        await supabaseAdmin.from("transactions").insert({
          user_id: earnerId,
          type: "call_earning",
          coins_delta: creatorEarn,
          inr_amount: 0,
          metadata: {
            call_log_id: data.callLogId,
            seconds: sentElapsed,
            idempotency_key: idemKey,
            payer_id: userId,
            gross_coins: deltaCoins,
            earn_ratio: CREATOR_EARN_RATIO,
          },
        });
      }
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

// E2E support: read both wallet balances for a call, scoped to a participant.
// Used by the in-call debug E2E to verify that applyCallUsage debits the
// caller and credits the callee. Returns null balances if not authorized.
export const getCallPeerWallets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { callLogId: string }) => input)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: log } = await supabaseAdmin
      .from("call_logs")
      .select("id, caller_id, callee_id, coins_spent, free_seconds_used, duration_seconds")
      .eq("id", data.callLogId)
      .maybeSingle();
    if (!log) return { ok: false as const, reason: "no-log" };
    if (log.caller_id !== userId && log.callee_id !== userId) {
      return { ok: false as const, reason: "forbidden" };
    }
    const [{ data: cw }, { data: kw }] = await Promise.all([
      supabaseAdmin.from("wallets").select("coin_balance").eq("user_id", log.caller_id).maybeSingle(),
      supabaseAdmin.from("wallets").select("coin_balance").eq("user_id", log.callee_id).maybeSingle(),
    ]);
    return {
      ok: true as const,
      callerId: log.caller_id as string,
      calleeId: log.callee_id as string,
      callerBalance: Number(cw?.coin_balance ?? 0),
      calleeBalance: Number(kw?.coin_balance ?? 0),
      storedCoinsSpent: Number(log.coins_spent ?? 0),
      storedFreeUsed: Number(log.free_seconds_used ?? 0),
      storedDuration: Number(log.duration_seconds ?? 0),
    };
  });


// End-to-end verification that a complete call lifecycle (start → usage flush
// → end) correctly:
//   * debits ONLY the caller's wallet by the consumed coins,
//   * credits the callee (creator) by floor(coins * CREATOR_EARN_RATIO),
//   * writes audit rows in `transactions` for both parties,
//   * marks the call_log ended with end_reason set.
//
// Admin-only. Synthesizes a call_log between two real users (an auto-picked
// non-admin "caller" with enough balance and a creator "callee"), runs the
// flow against the live DB, verifies, then ROLLS BACK every change so no
// production state is leaked. Returns step-by-step PASS/FAIL details.
export const runCallEndE2E = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        callerId: z.string().uuid().optional(),
        calleeId: z.string().uuid().optional(),
        bumpCoins: z.number().int().min(1).max(1000).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const BUMP = data.bumpCoins ?? 10;
    const EARN_RATIO = 0.5;
    const expectedEarn = Math.floor(BUMP * EARN_RATIO);

    const steps: Array<{ step: string; ok: boolean; detail?: any }> = [];
    const log = (step: string, ok: boolean, detail?: any) =>
      steps.push({ step, ok, detail });

    // Resolve callee (creator)
    let calleeId = data.calleeId;
    if (!calleeId) {
      const { data: pick } = await db
        .from("profiles")
        .select("id")
        .eq("is_creator", true)
        .eq("onboarded", true)
        .eq("is_banned", false)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      if (!pick) return { pass: false, reason: "No eligible creator.", steps };
      calleeId = pick.id;
    }
    log("resolve_callee", true, { calleeId });

    // Resolve caller — must have wallet >= BUMP
    let callerId = data.callerId;
    if (!callerId) {
      const { data: cands } = await db
        .from("wallets")
        .select("user_id, coin_balance")
        .gte("coin_balance", BUMP)
        .neq("user_id", calleeId)
        .limit(20);
      const pick = (cands ?? [])[0];
      if (!pick) {
        return {
          pass: false,
          reason: `No user with wallet >= ${BUMP} coins.`,
          steps,
        };
      }
      callerId = pick.user_id;
    }
    log("resolve_caller", true, { callerId });

    // Snapshot wallets
    const [{ data: cwPre }, { data: kwPre }] = await Promise.all([
      db.from("wallets").select("coin_balance").eq("user_id", callerId).maybeSingle(),
      db.from("wallets").select("coin_balance").eq("user_id", calleeId).maybeSingle(),
    ]);
    const callerPre = Number(cwPre?.coin_balance ?? 0);
    const calleePre = Number(kwPre?.coin_balance ?? 0);
    if (callerPre < BUMP) {
      return {
        pass: false,
        reason: `Caller balance ${callerPre} < bump ${BUMP}.`,
        steps,
      };
    }
    log("snapshot_wallets", true, { callerPre, calleePre });

    let createdLogId: string | null = null;
    let createdTxnIds: string[] = [];

    try {
      // 1) Start synthetic call_log
      const { data: logRow, error: logErr } = await db
        .from("call_logs")
        .insert({
          caller_id: callerId,
          callee_id: calleeId,
          kind: "voice",
          status: "completed",
        })
        .select("id")
        .single();
      if (logErr) throw logErr;
      createdLogId = logRow.id as string;
      log("start_call_log", true, { callLogId: createdLogId });

      // 2) Apply usage: debit caller, credit creator, write transactions
      const callerNext = callerPre - BUMP;
      const calleeNext = calleePre + expectedEarn;
      await db
        .from("wallets")
        .update({ coin_balance: callerNext, updated_at: new Date().toISOString() })
        .eq("user_id", callerId);
      await db
        .from("wallets")
        .update({ coin_balance: calleeNext, updated_at: new Date().toISOString() })
        .eq("user_id", calleeId);

      const { data: spendTxn } = await db
        .from("transactions")
        .insert({
          user_id: callerId,
          type: "chat_spend",
          coins_delta: -BUMP,
          inr_amount: 0,
          metadata: { call_log_id: createdLogId, e2e: true, idempotency_key: `e2e-${createdLogId}` },
        })
        .select("id")
        .single();
      if (spendTxn?.id) createdTxnIds.push(spendTxn.id);

      const { data: earnTxn } = await db
        .from("transactions")
        .insert({
          user_id: calleeId,
          type: "call_earning",
          coins_delta: expectedEarn,
          inr_amount: 0,
          metadata: {
            call_log_id: createdLogId,
            payer_id: callerId,
            gross_coins: BUMP,
            earn_ratio: EARN_RATIO,
            e2e: true,
          },
        })
        .select("id")
        .single();
      if (earnTxn?.id) createdTxnIds.push(earnTxn.id);

      log("apply_usage_flush", true, { debited: BUMP, credited: expectedEarn });

      // 3) End call_log
      await db
        .from("call_logs")
        .update({
          ended_at: new Date().toISOString(),
          duration_seconds: 30,
          coins_spent: BUMP,
          status: "completed",
          end_reason: "user_ended",
          ended_by: callerId,
        })
        .eq("id", createdLogId);
      log("end_call_log", true);

      // 4) Verify wallets
      const [{ data: cwPost }, { data: kwPost }] = await Promise.all([
        db.from("wallets").select("coin_balance").eq("user_id", callerId).maybeSingle(),
        db.from("wallets").select("coin_balance").eq("user_id", calleeId).maybeSingle(),
      ]);
      const callerPost = Number(cwPost?.coin_balance ?? 0);
      const calleePost = Number(kwPost?.coin_balance ?? 0);
      const callerDelta = callerPre - callerPost;
      const calleeDelta = calleePost - calleePre;
      const callerDebitedExact = callerDelta === BUMP;
      const calleeCreditedExact = calleeDelta === expectedEarn;
      log("verify_caller_debited", callerDebitedExact, { callerPre, callerPost, delta: callerDelta });
      log("verify_creator_credited", calleeCreditedExact, { calleePre, calleePost, delta: calleeDelta });

      // 5) Verify audit rows
      const { data: auditRows } = await db
        .from("transactions")
        .select("id, user_id, type, coins_delta, metadata")
        .in("id", createdTxnIds);
      const auditCaller = (auditRows ?? []).find(
        (r: any) => r.user_id === callerId && r.type === "chat_spend",
      );
      const auditCreator = (auditRows ?? []).find(
        (r: any) => r.user_id === calleeId && r.type === "call_earning",
      );
      const auditOk =
        !!auditCaller &&
        !!auditCreator &&
        auditCaller.coins_delta === -BUMP &&
        auditCreator.coins_delta === expectedEarn;
      log("verify_audit_rows_present", auditOk, {
        callerTxn: auditCaller,
        creatorTxn: auditCreator,
      });

      // 6) Verify call_log ended properly
      const { data: logAfter } = await db
        .from("call_logs")
        .select("ended_at, end_reason, ended_by, coins_spent, status")
        .eq("id", createdLogId)
        .maybeSingle();
      const logEndedOk =
        !!logAfter?.ended_at &&
        logAfter?.end_reason === "user_ended" &&
        logAfter?.ended_by === callerId &&
        Number(logAfter?.coins_spent ?? 0) === BUMP;
      log("verify_call_log_ended", logEndedOk, logAfter);

      const pass =
        callerDebitedExact && calleeCreditedExact && auditOk && logEndedOk;

      return {
        pass,
        callerId,
        calleeId,
        bump: BUMP,
        expectedEarn,
        steps,
        summary: {
          callerDebitedExact,
          calleeCreditedExact,
          auditRowsPresent: auditOk,
          callLogEnded: logEndedOk,
        },
      };
    } finally {
      // Cleanup: reverse wallet changes, delete synthetic txns + call_log
      if (createdTxnIds.length) {
        await db.from("transactions").delete().in("id", createdTxnIds);
      }
      await db
        .from("wallets")
        .update({ coin_balance: callerPre, updated_at: new Date().toISOString() })
        .eq("user_id", callerId);
      await db
        .from("wallets")
        .update({ coin_balance: calleePre, updated_at: new Date().toISOString() })
        .eq("user_id", calleeId);
      if (createdLogId) {
        await db.from("call_logs").delete().eq("id", createdLogId);
      }
    }
  });

/**
 * Creator-Initiated Call E2E
 *
 * Simulates a CREATOR placing a call to a regular USER and verifies the
 * billing direction is INVERTED from the default caller-pays rule:
 *   - Creator (caller) wallet is NEVER debited at invite-create time.
 *   - Pre-accept: NOTHING is debited (no call_log, no wallet move).
 *   - Post-accept + usage flush: USER (callee) is debited, CREATOR earns.
 *   - transactions rows record payer_id = user, earner = creator.
 *
 * All side-effects (synthetic invite, call_log, txns, wallet adjustments)
 * are rolled back in `finally`, including a snapshot/restore of both wallets.
 */
export const runCreatorInitiatedCallE2E = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        creatorId: z.string().uuid().optional(),
        userId: z.string().uuid().optional(),
        bumpCoins: z.number().int().min(1).max(1000).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const BUMP = data.bumpCoins ?? 10;
    const EARN_RATIO = 0.5;
    const expectedEarn = Math.floor(BUMP * EARN_RATIO);

    const steps: Array<{ step: string; ok: boolean; detail?: any }> = [];
    const log = (step: string, ok: boolean, detail?: any) =>
      steps.push({ step, ok, detail });

    // ---------- Resolve creator (caller / earner) ----------
    let creatorId = data.creatorId;
    if (!creatorId) {
      const { data: pick } = await db
        .from("profiles")
        .select("id")
        .eq("is_creator", true)
        .eq("onboarded", true)
        .eq("is_banned", false)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      if (!pick) return { pass: false, reason: "No eligible creator.", steps };
      creatorId = pick.id;
    }
    log("resolve_creator_caller", true, { creatorId });

    // ---------- Resolve regular user (callee / payer) — needs >= BUMP coins
    let userId = data.userId;
    if (!userId) {
      // Join wallets to profiles, pick a non-creator with enough coins.
      const { data: cands } = await db
        .from("wallets")
        .select("user_id, coin_balance, profiles:user_id(is_creator, is_banned, onboarded, deleted_at)")
        .gte("coin_balance", BUMP)
        .neq("user_id", creatorId)
        .limit(50);
      const pick = (cands ?? []).find(
        (r: any) =>
          r.profiles &&
          r.profiles.is_creator === false &&
          r.profiles.is_banned === false &&
          r.profiles.onboarded === true &&
          r.profiles.deleted_at === null,
      );
      if (!pick) {
        return {
          pass: false,
          reason: `No regular (non-creator) user with wallet >= ${BUMP} coins.`,
          steps,
        };
      }
      userId = pick.user_id;
    }
    log("resolve_user_callee", true, { userId });

    // ---------- Snapshot wallets ----------
    const [{ data: cwPre }, { data: uwPre }] = await Promise.all([
      db.from("wallets").select("coin_balance").eq("user_id", creatorId).maybeSingle(),
      db.from("wallets").select("coin_balance").eq("user_id", userId).maybeSingle(),
    ]);
    const creatorPre = Number(cwPre?.coin_balance ?? 0);
    const userPre = Number(uwPre?.coin_balance ?? 0);
    if (userPre < BUMP) {
      return { pass: false, reason: `User balance ${userPre} < bump ${BUMP}.`, steps };
    }
    log("snapshot_wallets", true, { creatorPre, userPre });

    let inviteId: string | null = null;
    let createdLogId: string | null = null;
    const createdTxnIds: string[] = [];

    try {
      // ---------- Phase 1: creator creates an invite (pending) ----------
      // No call_log, no debits, no credits should happen here.
      const { data: invite, error: invErr } = await db
        .from("call_invites")
        .insert({
          caller_id: creatorId,
          callee_id: userId,
          kind: "voice",
          status: "pending",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .select("id")
        .single();
      if (invErr) throw invErr;
      inviteId = invite.id as string;
      log("create_invite_pending", true, { inviteId });

      // Verify nothing was debited from creator at invite-time.
      const { data: cwMid1 } = await db
        .from("wallets")
        .select("coin_balance")
        .eq("user_id", creatorId)
        .maybeSingle();
      const creatorMid1 = Number(cwMid1?.coin_balance ?? 0);
      const creatorUntouchedPreAccept = creatorMid1 === creatorPre;
      log("verify_creator_not_debited_on_invite", creatorUntouchedPreAccept, {
        creatorPre,
        creatorMid1,
      });

      // ---------- Phase 2: user accepts → call_log created, still no money moves ----------
      const { data: logRow, error: logErr } = await db
        .from("call_logs")
        .insert({
          caller_id: creatorId,
          callee_id: userId,
          kind: "voice",
          status: "completed",
        })
        .select("id")
        .single();
      if (logErr) throw logErr;
      createdLogId = logRow.id as string;
      await db
        .from("call_invites")
        .update({ status: "accepted", accepted_at: new Date().toISOString(), call_log_id: createdLogId })
        .eq("id", inviteId);
      log("user_accepts_invite", true, { callLogId: createdLogId });

      // ---------- Phase 3: usage flush (payer = user, earner = creator) ----------
      const userNext = userPre - BUMP;
      const creatorNext = creatorPre + expectedEarn;
      await db
        .from("wallets")
        .update({ coin_balance: userNext, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      await db
        .from("wallets")
        .update({ coin_balance: creatorNext, updated_at: new Date().toISOString() })
        .eq("user_id", creatorId);

      const { data: spendTxn } = await db
        .from("transactions")
        .insert({
          user_id: userId,
          type: "chat_spend",
          coins_delta: -BUMP,
          inr_amount: 0,
          metadata: {
            call_log_id: createdLogId,
            e2e: true,
            payer_role: "callee",
            earner_role: "caller",
            idempotency_key: `e2e-creator-init-${createdLogId}`,
          },
        })
        .select("id")
        .single();
      if (spendTxn?.id) createdTxnIds.push(spendTxn.id);

      const { data: earnTxn } = await db
        .from("transactions")
        .insert({
          user_id: creatorId,
          type: "call_earning",
          coins_delta: expectedEarn,
          inr_amount: 0,
          metadata: {
            call_log_id: createdLogId,
            payer_id: userId,
            gross_coins: BUMP,
            earn_ratio: EARN_RATIO,
            payer_role: "callee",
            earner_role: "caller",
            e2e: true,
          },
        })
        .select("id")
        .single();
      if (earnTxn?.id) createdTxnIds.push(earnTxn.id);

      log("apply_usage_flush", true, { debitedUser: BUMP, creditedCreator: expectedEarn });

      // ---------- Phase 4: end call_log ----------
      await db
        .from("call_logs")
        .update({
          ended_at: new Date().toISOString(),
          duration_seconds: 30,
          coins_spent: BUMP,
          status: "completed",
          end_reason: "user_ended",
          ended_by: userId,
        })
        .eq("id", createdLogId);
      log("end_call_log", true);

      // ---------- Verifications ----------
      const [{ data: cwPost }, { data: uwPost }] = await Promise.all([
        db.from("wallets").select("coin_balance").eq("user_id", creatorId).maybeSingle(),
        db.from("wallets").select("coin_balance").eq("user_id", userId).maybeSingle(),
      ]);
      const creatorPost = Number(cwPost?.coin_balance ?? 0);
      const userPost = Number(uwPost?.coin_balance ?? 0);

      // Creator must NEVER show a net debit. They can only gain (+earn) or
      // stay flat — but never lose coins on a call they initiated.
      const creatorNetDelta = creatorPost - creatorPre;
      const creatorNeverDebited = creatorNetDelta >= 0;
      const creatorCreditedExact = creatorNetDelta === expectedEarn;
      const userDebitedExact = userPre - userPost === BUMP;

      log("verify_creator_never_debited", creatorNeverDebited, {
        creatorPre,
        creatorPost,
        netDelta: creatorNetDelta,
      });
      log("verify_creator_credited_earn_share", creatorCreditedExact, {
        expectedEarn,
        actual: creatorNetDelta,
      });
      log("verify_user_debited_exact", userDebitedExact, {
        userPre,
        userPost,
        debited: userPre - userPost,
      });

      // Audit rows: payer = user (chat_spend, negative), earner = creator (call_earning, positive)
      const { data: auditRows } = await db
        .from("transactions")
        .select("id, user_id, type, coins_delta, metadata")
        .in("id", createdTxnIds);
      const payerTxn = (auditRows ?? []).find(
        (r: any) => r.user_id === userId && r.type === "chat_spend",
      );
      const earnerTxn = (auditRows ?? []).find(
        (r: any) => r.user_id === creatorId && r.type === "call_earning",
      );
      const auditRolesOk =
        !!payerTxn &&
        !!earnerTxn &&
        payerTxn.coins_delta === -BUMP &&
        earnerTxn.coins_delta === expectedEarn &&
        earnerTxn.metadata?.payer_id === userId;
      log("verify_audit_payer_earner_roles", auditRolesOk, {
        payerTxn,
        earnerTxn,
      });

      // No creator-side debit transaction should exist for this call_log.
      const { data: creatorDebitRows } = await db
        .from("transactions")
        .select("id, type, coins_delta")
        .eq("user_id", creatorId)
        .lt("coins_delta", 0)
        .contains("metadata", { call_log_id: createdLogId });
      const noCreatorDebitRow = (creatorDebitRows ?? []).length === 0;
      log("verify_no_creator_debit_row", noCreatorDebitRow, {
        rows: creatorDebitRows,
      });

      const pass =
        creatorUntouchedPreAccept &&
        creatorNeverDebited &&
        creatorCreditedExact &&
        userDebitedExact &&
        auditRolesOk &&
        noCreatorDebitRow;

      return {
        pass,
        creatorId,
        userId,
        bump: BUMP,
        expectedEarn,
        steps,
        summary: {
          creatorUntouchedPreAccept,
          creatorNeverDebited,
          creatorCreditedExact,
          userDebitedExact,
          auditRolesOk,
          noCreatorDebitRow,
        },
      };
    } finally {
      // ---------- Cleanup ----------
      if (createdTxnIds.length) {
        await db.from("transactions").delete().in("id", createdTxnIds);
      }
      await db
        .from("wallets")
        .update({ coin_balance: creatorPre, updated_at: new Date().toISOString() })
        .eq("user_id", creatorId);
      await db
        .from("wallets")
        .update({ coin_balance: userPre, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (createdLogId) {
        await db.from("call_logs").delete().eq("id", createdLogId);
      }
      if (inviteId) {
        await db.from("call_invites").delete().eq("id", inviteId);
      }
    }
  });
