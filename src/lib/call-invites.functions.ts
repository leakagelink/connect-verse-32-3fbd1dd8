import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withAiAvatar, withAiAvatars } from "./ai-avatar";
import { notifyUser, notifyIncomingCall, notifyCallEnded } from "./push.functions";
import { VOICE_CALL_COINS_PER_MINUTE, VIDEO_CALL_COINS_PER_MINUTE, CALLING_ENABLED } from "./constants";
import { logCallEvent } from "./call-telemetry.server";

const KindSchema = z.enum(["voice", "video"]);
const InviteIdSchema = z.object({ inviteId: z.string().uuid() });
const INVITE_TTL_SECONDS = 45;

/**
 * Resolve which side of a call PAYS coins and which side EARNS them.
 *
 * Rule: the creator is always the earner; the consumer (non-creator) is
 * always the payer. This lets a creator initiate calls to a regular user
 * without accidentally draining the creator's wallet — coins still come
 * out of the consumer's wallet regardless of who tapped "call" first.
 *
 * Fallback: if both sides are creators or both are non-creators, the
 * caller pays (legacy behaviour).
 */
async function resolveCallParties(
  db: any,
  callerId: string,
  calleeId: string,
): Promise<{
  payerId: string;
  earnerId: string;
  payerRole: "caller" | "callee";
  earnerRole: "caller" | "callee";
  earnerIsCreator: boolean;
}> {
  const { data: profs } = await db
    .from("profiles")
    .select("id, is_creator")
    .in("id", [callerId, calleeId]);
  const map = new Map<string, boolean>((profs ?? []).map((p: any) => [p.id, !!p.is_creator]));
  const callerIsCreator = map.get(callerId) ?? false;
  const calleeIsCreator = map.get(calleeId) ?? false;

  // Default: caller pays, callee earns.
  let payerRole: "caller" | "callee" = "caller";
  if (callerIsCreator && !calleeIsCreator) {
    // Creator → user: the user (callee) is the payer.
    payerRole = "callee";
  }
  const payerId = payerRole === "caller" ? callerId : calleeId;
  const earnerId = payerRole === "caller" ? calleeId : callerId;
  const earnerIsCreator = payerRole === "caller" ? calleeIsCreator : callerIsCreator;
  return {
    payerId,
    earnerId,
    payerRole,
    earnerRole: payerRole === "caller" ? "callee" : "caller",
    earnerIsCreator,
  };
}


const SAFE_PROFILE_FIELDS =
  "id, username, gender, country, state, language, avatar_url, ai_avatar_style, is_creator, last_seen_at, availability";

async function hiddenAdminIds(db: any): Promise<Set<string>> {
  const { data } = await db.from("user_roles").select("user_id").eq("role", "admin");
  return new Set((data ?? []).map((r: any) => r.user_id));
}

/**
 * One-time stale-state reconciliation for a callee. Cleans up rows that would
 * make the creator look "busy" even though they're actually free:
 *   - pending invites past their expires_at      → mark expired
 *   - accepted invites whose call_log has ended  → mark cancelled
 *   - profile.availability stuck on "busy"/"in_call" with no live call
 *     and no live ring                           → reset to "online"
 * Returns true if anything was changed (so caller can re-read state).
 */
async function refreshStaleBusy(db: any, calleeId: string): Promise<boolean> {
  let changed = false;
  const nowIso = new Date().toISOString();

  // 1) Expire timed-out pending invites
  const { data: expired } = await db
    .from("call_invites")
    .update({ status: "expired", cancelled_at: nowIso })
    .eq("callee_id", calleeId)
    .eq("status", "pending")
    .lte("expires_at", nowIso)
    .select("id, caller_id, callee_id, kind, created_at, call_log_id");
  if (expired && expired.length > 0) {
    changed = true;
    for (const inv of expired) {
      await recordMissedCallLog(db, inv, "expired").catch(() => {});
      await sendMissedCallNotification(db, inv).catch(() => {});
      await logCallEvent(db, {
        eventType: "stale_invite_expired",
        inviteId: inv.id,
        callerId: inv.caller_id,
        calleeId: inv.callee_id,
        kind: inv.kind,
        reason: "ttl_exceeded",
        ok: true,
      });
    }
  }

  // 2) Cancel "accepted" invites whose underlying call already ended OR
  //    whose heartbeat has gone silent for >60s (app killed, OS reaped tab,
  //    network died mid-call). Without this, a ghost "accepted" row keeps
  //    the creator looking busy until something else cleans up.
  const STALE_HEARTBEAT_MS = 60_000;
  const { data: acceptedRows } = await db
    .from("call_invites")
    .select("id, accepted_at, call_log_id, call_logs:call_log_id(ended_at, last_heartbeat_at, created_at)")
    .eq("callee_id", calleeId)
    .eq("status", "accepted");
  const nowMs = Date.now();
  const staleIds = (acceptedRows ?? [])
    .filter((r: any) => {
      const log = r.call_logs;
      if (!log) {
        // accepted but no call_log attached and accepted >60s ago → orphan
        const acceptedMs = r.accepted_at ? new Date(r.accepted_at).getTime() : 0;
        return acceptedMs > 0 && nowMs - acceptedMs > STALE_HEARTBEAT_MS;
      }
      if (log.ended_at) return true;
      const lastBeat = log.last_heartbeat_at
        ? new Date(log.last_heartbeat_at).getTime()
        : log.created_at
          ? new Date(log.created_at).getTime()
          : 0;
      return lastBeat > 0 && nowMs - lastBeat > STALE_HEARTBEAT_MS;
    })
    .map((r: any) => r.id);
  if (staleIds.length > 0) {
    // NOTE: call_invites has no `ended_at` column — writing it throws and
    // silently aborts the whole reconciler, leaving ghost rows in place
    // forever. Only the columns that actually exist may be written here.
    await db
      .from("call_invites")
      .update({ status: "cancelled", cancelled_at: nowIso })
      .in("id", staleIds);
    changed = true;
    for (const id of staleIds) {
      await logCallEvent(db, {
        eventType: "stale_accepted_cancelled",
        inviteId: id,
        calleeId,
        reason: "stale_heartbeat_or_ended",
        ok: true,
      });
    }
  }

  // 2b) Finalize orphan call_logs left open by app-kill / OS reap. A
  // call_log with ended_at = NULL whose heartbeat has been silent for
  // >STALE_HEARTBEAT_MS (or that never beat and is older than the same
  // window) is closed so it stops looking "in progress" to any other
  // busy / discovery / billing query.
  const staleCutoffIso = new Date(nowMs - STALE_HEARTBEAT_MS).toISOString();
  const { data: orphanLogs } = await db
    .from("call_logs")
    .select("id, started_at, last_heartbeat_at")
    .or(`callee_id.eq.${calleeId},caller_id.eq.${calleeId}`)
    .is("ended_at", null)
    .lt("started_at", staleCutoffIso);
  const orphanIds = (orphanLogs ?? [])
    .filter((r: any) => {
      const beatMs = r.last_heartbeat_at ? new Date(r.last_heartbeat_at).getTime() : 0;
      if (beatMs === 0) return true; // no heartbeat ever, and started >60s ago
      return nowMs - beatMs > STALE_HEARTBEAT_MS;
    })
    .map((r: any) => r.id);
  if (orphanIds.length > 0) {
    await db
      .from("call_logs")
      .update({ ended_at: nowIso, end_reason: "network" })
      .in("id", orphanIds)
      .is("ended_at", null);
    changed = true;
    for (const id of orphanIds) {
      await logCallEvent(db, {
        eventType: "orphan_log_closed",
        callLogId: id,
        calleeId,
        reason: "no_heartbeat",
        ok: true,
      });
    }
  }

  // 3) Reset availability stuck on busy/in_call if nothing is actually live
  const { data: liveRows } = await db
    .from("call_invites")
    .select("id, status, expires_at, call_logs:call_log_id(ended_at, last_heartbeat_at)")
    .eq("callee_id", calleeId)
    .in("status", ["pending", "accepted"]);
  const hasLive = (liveRows ?? []).some((r: any) => {
    if (r.status === "accepted") {
      const log = r.call_logs;
      if (!log) return false;
      if (log.ended_at) return false;
      const lastBeat = log.last_heartbeat_at ? new Date(log.last_heartbeat_at).getTime() : 0;
      // No heartbeat yet → trust the row for the first STALE_HEARTBEAT_MS;
      // after that, a missing beat means the call is gone.
      if (lastBeat === 0) return true;
      return nowMs - lastBeat <= STALE_HEARTBEAT_MS;
    }
    if (r.status === "pending") return r.expires_at && new Date(r.expires_at).getTime() > Date.now();
    return false;
  });
  if (!hasLive) {
    const { data: prof } = await db
      .from("profiles")
      .select("availability")
      .eq("id", calleeId)
      .maybeSingle();
    if (prof?.availability && ["busy", "in_call"].includes(prof.availability)) {
      await db.from("profiles").update({ availability: "online" }).eq("id", calleeId);
      changed = true;
      await logCallEvent(db, {
        eventType: "stale_availability_reset",
        calleeId,
        reason: prof.availability,
        ok: true,
      });
    }
  }


  return changed;
}

async function assertCallable(db: any, callerId: string, calleeId: string) {
  const [{ data: caller }, { data: callee }, admins] = await Promise.all([
    db
      .from("profiles")
      .select("id, username, country, state, is_banned, onboarded")
      .eq("id", callerId)
      .is("deleted_at", null)
      .maybeSingle(),
    db
      .from("profiles")
      .select("id, username, availability, blocked_countries, blocked_states, is_banned, onboarded")
      .eq("id", calleeId)
      .is("deleted_at", null)
      .maybeSingle(),
    hiddenAdminIds(db),
  ]);

  if (!caller || caller.is_banned || !caller.onboarded) throw new Error("Your account is not ready for calling.");
  if (!callee || callee.is_banned || !callee.onboarded || admins.has(calleeId)) {
    throw new Error("This creator isn't available right now.");
  }
  if (callee.availability && callee.availability !== "online") {
    // Stale-busy auto-refresh: if availability is non-online but no live
    // invite/call exists, reset and re-read once before failing.
    if (["busy", "in_call"].includes(callee.availability)) {
      const changed = await refreshStaleBusy(db, calleeId!);
      if (changed) {
        const { data: refreshed } = await db
          .from("profiles")
          .select("availability")
          .eq("id", calleeId)
          .maybeSingle();
        if (refreshed?.availability && refreshed.availability !== "online") {
          throw new Error("This creator is busy right now.");
        }
      } else {
        throw new Error("This creator is busy right now.");
      }
    } else {
      throw new Error(callee.availability === "dnd" ? "This creator is on Do Not Disturb." : "This creator is busy right now.");
    }
  }

  const blockedCountries: string[] = callee.blocked_countries ?? [];
  const blockedStates: string[] = callee.blocked_states ?? [];
  if (caller.country && blockedCountries.includes(caller.country)) {
    throw new Error("This creator does not accept calls from your country.");
  }
  if (caller.state && blockedStates.includes(caller.state)) {
    throw new Error("This creator does not accept calls from your state.");
  }

  return { caller, callee };
}


function isExpired(invite: any) {
  return invite?.status === "pending" && invite?.expires_at && new Date(invite.expires_at).getTime() <= Date.now();
}

async function expireIfNeeded(db: any, invite: any) {
  if (!isExpired(invite)) return invite;
  const { data } = await db
    .from("call_invites")
    .update({ status: "expired", cancelled_at: new Date().toISOString() })
    .eq("id", invite.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (data) {
    // Real pending -> expired transition: log a missed-call history entry
    // for BOTH parties and push-notify the callee.
    await recordMissedCallLog(db, data, "expired").catch(() => {});
    await sendMissedCallNotification(db, data).catch(() => {});
  }
  return data ?? { ...invite, status: "expired" };
}

async function sendMissedCallNotification(db: any, invite: any) {
  const { data: caller } = await db
    .from("profiles")
    .select("username")
    .eq("id", invite.caller_id)
    .maybeSingle();
  const name = caller?.username ?? "Someone";
  const isVideo = invite.kind === "video";
  await notifyUser({
    userId: invite.callee_id,
    kind: "calls",
    title: `Missed ${isVideo ? "video" : "audio"} call`,
    body: `${name} tried to call you.`,
    deepLink: `/recents`,
  });
}

/**
 * Persist a `call_logs` row for a missed call so it appears in the Recents
 * (call history) screen for both the caller (outgoing-no-answer) and the
 * callee (incoming-missed). De-duplicated by `call_invites.call_log_id` so
 * repeated state transitions can't double-insert.
 */
async function recordMissedCallLog(
  db: any,
  invite: any,
  reason: "expired" | "caller_cancelled" | "callee_rejected",
) {
  if (invite?.call_log_id) return; // already logged (real call happened)
  const { data: log, error } = await db
    .from("call_logs")
    .insert({
      caller_id: invite.caller_id,
      callee_id: invite.callee_id,
      kind: invite.kind,
      status: "missed",
      missed_reason: reason,
      started_at: invite.created_at ?? new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: 0,
      coins_spent: 0,
    })
    .select("id")
    .single();
  if (!error && log?.id) {
    await db
      .from("call_invites")
      .update({ call_log_id: log.id })
      .eq("id", invite.id)
      .is("call_log_id", null);
  }
}

function statusDto(
  invite: any,
  userId: string,
  log?: any,
  parties?: { payerRole: "caller" | "callee"; earnerRole: "caller" | "callee"; payerId: string; earnerId: string },
) {
  const role = invite.caller_id === userId ? "caller" : "callee";
  return {
    id: invite.id as string,
    kind: invite.kind as "voice" | "video",
    status: invite.status as "pending" | "accepted" | "rejected" | "missed" | "cancelled" | "expired",
    callerId: invite.caller_id as string,
    calleeId: invite.callee_id as string,
    role,
    callLogId: (invite.call_log_id ?? log?.id ?? null) as string | null,
    expiresAt: invite.expires_at as string,
    deliveredAt: (invite.delivered_at ?? null) as string | null,
    baselineDurationSeconds: Number(log?.duration_seconds ?? 0),
    baselineFreeSecondsUsed: Number(log?.free_seconds_used ?? 0),
    baselineCoinsSpent: Number(log?.coins_spent ?? 0),
    // Billing direction: which side pays / earns coins for this call.
    // Null when the server hasn't resolved it yet — client falls back to
    // legacy behaviour (caller = payer).
    payerRole: (parties?.payerRole ?? null) as "caller" | "callee" | null,
    earnerRole: (parties?.earnerRole ?? null) as "caller" | "callee" | null,
    payerId: (parties?.payerId ?? null) as string | null,
    earnerId: (parties?.earnerId ?? null) as string | null,
    amPayer: parties ? userId === parties.payerId : null,
  };
}



export const createCallInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        calleeId: z.string().uuid(),
        kind: KindSchema,
        // Optional per-attempt idempotency key. Same key from the same caller
        // always returns the same invite — multiple reconnects / retries can
        // never create duplicates for the same logical attempt.
        attemptId: z.string().min(8).max(128).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!CALLING_ENABLED) {
      throw new Error("Voice and video calling is coming soon.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const callerId = context.userId;
    if (callerId === data.calleeId) throw new Error("You cannot call yourself.");

    // ---------- Idempotent short-circuit ----------
    // If the caller already created an invite for this attemptId, return it as-is.
    // This makes retries from flaky networks / double-clicks / reconnect storms safe.
    if (data.attemptId) {
      const { data: existing } = await db
        .from("call_invites")
        .select("*")
        .eq("caller_id", callerId)
        .eq("client_attempt_id", data.attemptId)
        .maybeSingle();
      if (existing) {
        // If it's still pending but expired, mark it expired so the caller sees the truthful state.
        const reconciled = await expireIfNeeded(db, existing);
        return statusDto(reconciled, callerId);
      }
    }

    const { caller } = await assertCallable(db, callerId, data.calleeId);

    // Unconditional pre-flight reconciliation. Closes orphan call_logs
    // (ended_at IS NULL, heartbeat silent) and cancels ghost "accepted"
    // invites on BOTH sides — without this, an app-kill mid-call leaves
    // state that blocks the next call from ever connecting.
    await refreshStaleBusy(db, data.calleeId).catch(() => false);
    await refreshStaleBusy(db, callerId).catch(() => false);

    // Busy detection: callee already ringing with someone else or in an active accepted call.
    // We JOIN to call_logs so an "accepted" invite whose call already ended
    // (ended_at IS NOT NULL) is NOT treated as busy — otherwise stale rows
    // would brick the creator's inbox forever.
    const computeBusy = async () => {
      const { data: busyRows } = await db
        .from("call_invites")
        .select("id, status, caller_id, expires_at, accepted_at, call_log_id, call_logs:call_log_id(ended_at)")
        .eq("callee_id", data.calleeId)
        .in("status", ["pending", "accepted"])
        .order("created_at", { ascending: false })
        .limit(5);
      return (busyRows ?? []).some((r: any) => {
        if (r.caller_id === callerId) return false;
        if (r.status === "accepted") {
          if (r.call_logs?.ended_at) return false;
          return true;
        }
        if (r.status === "pending" && r.expires_at && new Date(r.expires_at).getTime() > Date.now()) return true;
        return false;
      });
    };
    let isBusy = await computeBusy();
    if (isBusy) {
      // One-time stale-busy reconciliation + retry (in case state changed mid-flight)
      const changed = await refreshStaleBusy(db, data.calleeId);
      if (changed) isBusy = await computeBusy();
    }
    if (isBusy) {
      await logCallEvent(db, {
        eventType: "invite_busy",
        callerId,
        calleeId: data.calleeId,
        actorId: callerId,
        kind: data.kind,
        reason: "callee_in_call",
        ok: false,
        meta: { attemptId: data.attemptId ?? null },
      });
      throw new Error("BUSY: This creator is on another call right now.");
    }


    await db
      .from("call_invites")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("caller_id", callerId)
      .eq("callee_id", data.calleeId)
      .eq("status", "pending");


    const { data: invite, error } = await db
      .from("call_invites")
      .insert({
        caller_id: callerId,
        callee_id: data.calleeId,
        kind: data.kind,
        expires_at: new Date(Date.now() + INVITE_TTL_SECONDS * 1000).toISOString(),
        client_attempt_id: data.attemptId ?? null,
      })
      .select("*")
      .single();

    // Race-condition fallback: a concurrent request with the same attemptId
    // beat us to the unique index. Fetch and return the canonical row.
    if (error) {
      const msg = String(error.message ?? "");
      if (data.attemptId && (error.code === "23505" || /duplicate key/i.test(msg) || /call_invites_caller_attempt_uniq/i.test(msg))) {
        const { data: existing } = await db
          .from("call_invites")
          .select("*")
          .eq("caller_id", callerId)
          .eq("client_attempt_id", data.attemptId)
          .maybeSingle();
        if (existing) return statusDto(await expireIfNeeded(db, existing), callerId);
      }
      await logCallEvent(db, {
        eventType: "invite_failed",
        callerId,
        calleeId: data.calleeId,
        actorId: callerId,
        kind: data.kind,
        reason: msg.slice(0, 200),
        ok: false,
        meta: { code: (error as any)?.code ?? null, attemptId: data.attemptId ?? null },
      });
      throw new Error(msg || "Could not create call invite.");
    }

    await logCallEvent(db, {
      eventType: "invite_created",
      inviteId: invite.id,
      callerId,
      calleeId: data.calleeId,
      actorId: callerId,
      kind: data.kind,
      status: invite.status,
      ok: true,
      meta: { attemptId: data.attemptId ?? null, ttl: INVITE_TTL_SECONDS },
    });

    // In-app notification + standard FCM banner (in case data push is throttled).
    await notifyUser({
      userId: data.calleeId,
      kind: "calls",
      title: `Incoming ${data.kind === "video" ? "video" : "audio"} call`,
      body: `${caller.username ?? "Someone"} is calling you. Tap to answer.`,
      deepLink: `/home`,
    }).catch(() => ({ pushed: 0 }));

    // High-priority data-only push — wakes Android even from killed state
    // and triggers full-screen IncomingCallActivity on the native side.
    await notifyIncomingCall({
      calleeId: data.calleeId,
      callerId,
      callerName: caller.username ?? "Caller",
      callerAvatar: (caller as any).avatar_url ?? null,
      inviteId: invite.id,
      kind: data.kind,
    }).catch(() => ({ pushed: 0 }));

    return statusDto(invite, callerId);
  });

export const listIncomingCallInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: invites } = await db
      .from("call_invites")
      .select("id, caller_id, callee_id, kind, status, expires_at, created_at, delivered_at")
      .eq("callee_id", context.userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(3);

    const callerIds = Array.from(new Set((invites ?? []).map((i: any) => i.caller_id)));
    let profiles = new Map<string, any>();
    if (callerIds.length) {
      const { data: profs } = await db
        .from("profiles")
        .select(SAFE_PROFILE_FIELDS)
        .in("id", callerIds)
        .eq("is_banned", false)
        .eq("onboarded", true)
        .is("deleted_at", null);
      profiles = new Map(withAiAvatars(profs ?? []).map((p: any) => [p.id, p]));
    }

    return (invites ?? [])
      .map((i: any) => ({
        id: i.id as string,
        kind: i.kind as "voice" | "video",
        expiresAt: i.expires_at as string,
        createdAt: i.created_at as string,
        deliveredAt: (i.delivered_at ?? null) as string | null,
        caller: profiles.get(i.caller_id) ?? { id: i.caller_id, username: "Caller", avatar_url: null },
      }))
      .filter((i: any) => !!i.caller?.id);
  });

export const markCallInviteDelivered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => InviteIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const nowIso = new Date().toISOString();
    // Only the actual callee can ack delivery, and only once (delivered_at IS NULL).
    const { data: row } = await db
      .from("call_invites")
      .update({ delivered_at: nowIso })
      .eq("id", data.inviteId)
      .eq("callee_id", context.userId)
      .is("delivered_at", null)
      .select("id, delivered_at")
      .maybeSingle();
    return { ok: true, deliveredAt: (row?.delivered_at ?? nowIso) as string };
  });


export const getCallInviteStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => InviteIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: rawInvite, error } = await db.from("call_invites").select("*").eq("id", data.inviteId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!rawInvite || (rawInvite.caller_id !== context.userId && rawInvite.callee_id !== context.userId)) {
      throw new Error("Call invite not found.");
    }
    const invite = await expireIfNeeded(db, rawInvite);
    let log: any = null;
    if (invite.call_log_id) {
      const { data: row } = await db
        .from("call_logs")
        .select("id, duration_seconds, coins_spent, free_seconds_used")
        .eq("id", invite.call_log_id)
        .maybeSingle();
      log = row;
    }
    const parties = await resolveCallParties(db, invite.caller_id, invite.callee_id);
    return statusDto(invite, context.userId, log, parties);
  });

/**
 * Idempotent helper: load the call_log row associated with an already-accepted
 * invite so repeat requests can return the same DTO without re-inserting.
 */
async function loadInviteLog(db: any, callLogId: string | null) {
  if (!callLogId) return null;
  const { data } = await db
    .from("call_logs")
    .select("id, duration_seconds, coins_spent, free_seconds_used")
    .eq("id", callLogId)
    .maybeSingle();
  return data;
}

export const acceptCallInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => InviteIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: rawInvite } = await db.from("call_invites").select("*").eq("id", data.inviteId).maybeSingle();
    if (!rawInvite || rawInvite.callee_id !== context.userId) throw new Error("Call invite not found.");

    // Resolve billing direction up-front so every code path returns it.
    const parties = await resolveCallParties(db, rawInvite.caller_id, rawInvite.callee_id);

    // ---------- Idempotent short-circuit ----------
    // If this invite is already accepted by the same callee, return the
    // existing DTO. Repeated taps / network retries / reconnect storms can
    // never insert a duplicate call_log or transition state twice.
    if (rawInvite.status === "accepted") {
      const log = await loadInviteLog(db, rawInvite.call_log_id);
      return statusDto(rawInvite, context.userId, log, parties);
    }

    const invite = await expireIfNeeded(db, rawInvite);
    if (invite.status !== "pending") throw new Error("This call is no longer ringing.");
    await assertCallable(db, invite.caller_id, invite.callee_id);

    // Pre-flight: close any orphan call_logs / ghost "accepted" rows from a
    // prior killed-app session for either party so the partial-unique index
    // ("one accepted per callee") can't reject this accept on stale state.
    await refreshStaleBusy(db, invite.callee_id).catch(() => false);
    await refreshStaleBusy(db, invite.caller_id).catch(() => false);

    // ---------- Payer-balance gate ----------
    // If the accepting user IS the payer (i.e., a creator initiated the call
    // to them), make sure they can afford at least one minute of talk time.
    // Otherwise show a recharge prompt instead of connecting a call that
    // would instantly run dry.
    if (context.userId === parties.payerId) {
      const perMin = invite.kind === "video" ? VIDEO_CALL_COINS_PER_MINUTE : VOICE_CALL_COINS_PER_MINUTE;
      const [{ data: payerProf }, { data: payerWallet }] = await Promise.all([
        db.from("profiles").select("free_seconds_remaining").eq("id", parties.payerId).maybeSingle(),
        db.from("wallets").select("coin_balance").eq("user_id", parties.payerId).maybeSingle(),
      ]);
      const freeLeft = Number(payerProf?.free_seconds_remaining ?? 0);
      const coinLeft = Number(payerWallet?.coin_balance ?? 0);
      const hasFreeMinute = freeLeft >= 60;
      const hasCoinMinute = coinLeft >= perMin;
      if (!hasFreeMinute && !hasCoinMinute) {
        throw new Error(
          `RECHARGE_REQUIRED: Bat karne ke liye coins lijiye. Kam se kam ${perMin} coins zaroori hain ek minute ${invite.kind === "video" ? "video" : "audio"} call ke liye.`,
        );
      }
    }

    // ---------- Step 1: atomically reserve the invite ----------
    // Flip pending → accepted FIRST (without a call_log_id yet). Only one
    // request can win this conditional UPDATE; concurrent duplicates get
    // an empty result and fall through to the idempotent re-read below.
    const acceptedAt = new Date().toISOString();
    let reserved: any = null;
    let reserveErr: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await db
        .from("call_invites")
        .update({ status: "accepted", accepted_at: acceptedAt })
        .eq("id", invite.id)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();
      reserved = res.data;
      reserveErr = res.error;
      if (!reserveErr) break;
      const msg = String(reserveErr.message ?? "");
      const isUniqueConflict =
        reserveErr.code === "23505" ||
        /call_invites_one_accepted_per_callee|duplicate key/i.test(msg);
      if (!isUniqueConflict || attempt > 0) break;
      // Conflict on the per-callee partial-unique index. Most often this is
      // a stale "accepted" invite from a previous call whose call_log already
      // ended but never got flipped to cancelled (background loss, app kill,
      // missed cleanup). Run the reconciler and retry once before surfacing
      // a "busy" error to the user.
      await refreshStaleBusy(db, invite.callee_id);
    }

    if (reserveErr) {
      const msg = String(reserveErr.message ?? "");
      if (
        reserveErr.code === "23505" ||
        /call_invites_one_accepted_per_callee|duplicate key/i.test(msg)
      ) {
        // Still conflicting after cleanup — check if there is a genuinely
        // live accepted invite (call_log not yet ended). If not, it's a
        // ghost row we couldn't clean; treat as no longer ringing instead
        // of falsely accusing the creator of being on another call.
        const { data: liveAccepted } = await db
          .from("call_invites")
          .select("id, call_logs:call_log_id(ended_at)")
          .eq("callee_id", invite.callee_id)
          .eq("status", "accepted");
        const reallyBusy = (liveAccepted ?? []).some(
          (r: any) => r.call_log_id == null || !r.call_logs?.ended_at,
        );
        if (reallyBusy) {
          await logCallEvent(db, {
            eventType: "accept_conflict",
            inviteId: invite.id,
            callerId: invite.caller_id,
            calleeId: invite.callee_id,
            actorId: context.userId,
            kind: invite.kind,
            reason: "really_busy_after_cleanup",
            ok: false,
          });
          throw new Error("This creator just picked up another call.");
        }
        await logCallEvent(db, {
          eventType: "accept_ghost_cleared",
          inviteId: invite.id,
          callerId: invite.caller_id,
          calleeId: invite.callee_id,
          actorId: context.userId,
          kind: invite.kind,
          reason: "ghost_accepted_cleared",
          ok: false,
        });
        throw new Error("This call is no longer ringing.");
      }
      throw new Error(msg);
    }

    if (!reserved) {
      // Lost the race against a concurrent accept on the same invite.
      // Re-read and return whatever the winner produced — same response
      // shape, so the duplicate caller is none the wiser.
      const { data: current } = await db.from("call_invites").select("*").eq("id", invite.id).maybeSingle();
      if (current?.status === "accepted" && current.callee_id === context.userId) {
        const log = await loadInviteLog(db, current.call_log_id);
        return statusDto(current, context.userId, log, parties);
      }
      throw new Error("This call is no longer ringing.");
    }


    // ---------- Step 2: create the call_log for the winning reservation ----------
    const { data: log, error: logErr } = await db
      .from("call_logs")
      .insert({ caller_id: invite.caller_id, callee_id: invite.callee_id, kind: invite.kind, status: "completed" })
      .select("id, duration_seconds, coins_spent, free_seconds_used")
      .single();
    if (logErr) {
      // Roll the reservation back so the caller isn't stuck "accepted" with
      // no call_log to bill against.
      await db
        .from("call_invites")
        .update({ status: "pending", accepted_at: null })
        .eq("id", invite.id)
        .eq("status", "accepted")
        .is("call_log_id", null);
      throw new Error(logErr.message);
    }

    // ---------- Step 3: attach the call_log to the reserved invite ----------
    const { data: finalized } = await db
      .from("call_invites")
      .update({ call_log_id: log.id })
      .eq("id", invite.id)
      .is("call_log_id", null)
      .select("*")
      .maybeSingle();


    await logCallEvent(db, {
      eventType: "invite_accepted",
      inviteId: invite.id,
      callLogId: log.id,
      callerId: invite.caller_id,
      calleeId: invite.callee_id,
      actorId: context.userId,
      kind: invite.kind,
      ok: true,
      meta: {
        payerId: parties.payerId,
        earnerId: parties.earnerId,
        ringMs: invite.created_at
          ? Math.max(0, Date.now() - new Date(invite.created_at).getTime())
          : null,
      },
    });

    return statusDto(finalized ?? { ...reserved, call_log_id: log.id }, context.userId, log, parties);
  });

export const rejectCallInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => InviteIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: invite } = await db.from("call_invites").select("*").eq("id", data.inviteId).maybeSingle();
    if (!invite || invite.callee_id !== context.userId) throw new Error("Call invite not found.");
    const { data: rejected } = await db
      .from("call_invites")
      .update({ status: "rejected", rejected_at: new Date().toISOString() })
      .eq("id", data.inviteId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    // Dismiss the lock-screen UI on the callee's other devices.
    await notifyCallEnded({ calleeId: invite.callee_id, inviteId: invite.id }).catch(() => ({ pushed: 0 }));
    // Log a missed-call history entry tagged with the rejection reason.
    if (rejected) {
      await recordMissedCallLog(db, rejected, "callee_rejected").catch(() => {});
    }
    await logCallEvent(db, {
      eventType: "accept_rejected",
      inviteId: invite.id,
      callerId: invite.caller_id,
      calleeId: invite.callee_id,
      actorId: context.userId,
      kind: invite.kind,
      reason: "callee_rejected",
      ok: true,
    });
    return { ok: true };
  });

export const cancelCallInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => InviteIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: invite } = await db.from("call_invites").select("*").eq("id", data.inviteId).maybeSingle();
    if (!invite || invite.caller_id !== context.userId) throw new Error("Call invite not found.");
    const { data: cancelled } = await db
      .from("call_invites")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", data.inviteId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    // Caller hung up before answer — dismiss the full-screen UI on the callee.
    await notifyCallEnded({ calleeId: invite.callee_id, inviteId: invite.id }).catch(() => ({ pushed: 0 }));
    // If the ring actually reached the callee's device, surface it as a missed call.
    if (cancelled && invite.delivered_at) {
      await recordMissedCallLog(db, cancelled, "caller_cancelled").catch(() => {});
      await sendMissedCallNotification(db, cancelled).catch(() => {});
    }
    await logCallEvent(db, {
      eventType: "invite_cancelled",
      inviteId: invite.id,
      callerId: invite.caller_id,
      calleeId: invite.callee_id,
      actorId: context.userId,
      kind: invite.kind,
      reason: invite.delivered_at ? "caller_cancelled_after_ring" : "caller_cancelled_pre_ring",
      ok: true,
    });
    return { ok: true };
  });

export const getCallParticipantProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const admins = await hiddenAdminIds(db);
    if (admins.has(data.userId)) throw new Error("Profile not found.");
    const { data: p } = await db
      .from("profiles")
      .select(SAFE_PROFILE_FIELDS)
      .eq("id", data.userId)
      .eq("is_banned", false)
      .eq("onboarded", true)
      .is("deleted_at", null)
      .maybeSingle();
    return { profile: p ? withAiAvatar(p) : null };
  });

// TEMP DIAG — admin-only: create an already-expired pending invite to the logged-in user
// (faking another user as caller) and run the missed-call push pipeline. Returns FCM result.
export const diagSelfMissedCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ targetUserId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");

    // target callee = explicit arg, else self
    const calleeId = data.targetUserId ?? context.userId;

    // pick any other onboarded user as the fake caller
    const { data: other } = await db
      .from("profiles")
      .select("id, username")
      .neq("id", calleeId)
      .eq("is_banned", false)
      .eq("onboarded", true)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (!other) throw new Error("No other user available as fake caller.");

    const pastIso = new Date(Date.now() - 60_000).toISOString();
    const { data: invite, error } = await db
      .from("call_invites")
      .insert({
        caller_id: other.id,
        callee_id: calleeId,
        kind: "voice",
        status: "pending",
        expires_at: pastIso,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const before = invite;
    const reconciled = await (async () => {
      const { data } = await db
        .from("call_invites")
        .update({ status: "expired", cancelled_at: new Date().toISOString() })
        .eq("id", invite.id)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();
      return data;
    })();

    // fetch caller name and call notifyUser directly so we get FCM counters
    const { data: caller } = await db.from("profiles").select("username").eq("id", invite.caller_id).maybeSingle();
    const name = caller?.username ?? "Someone";

    // tokens snapshot
    const { data: tokens } = await db.from("device_tokens").select("token, platform").eq("user_id", calleeId);

    const { notifyUser: notify } = await import("./push.functions");
    const pushResult = await notify({
      userId: calleeId,
      kind: "calls",
      title: `Missed audio call`,
      body: `${name} tried to call you.`,
      deepLink: `/calls`,
    });

    return {
      ok: true,
      calleeId,
      fakeCallerId: invite.caller_id,
      fakeCallerName: name,
      inviteId: invite.id,
      inviteStatusBefore: before.status,
      inviteStatusAfter: reconciled?.status ?? "no-transition",
      registeredTokens: (tokens ?? []).length,
      tokenPlatforms: (tokens ?? []).map((t: any) => t.platform),
      fcmPushed: pushResult.pushed,
    };
  });
// ============================================================================
// E2E: Busy-reset flow
// Admin-only. Simulates a creator whose previous call ended but whose
// availability/invite rows are stuck on "busy". Runs refreshStaleBusy and
// assertCallable to prove that the next caller will get through, not BUSY.
// Returns a structured PASS/FAIL report. Cleans up all rows it created.
// ============================================================================
export const runBusyResetE2E = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ calleeId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const steps: Array<{ step: string; ok: boolean; detail?: any }> = [];
    const log = (step: string, ok: boolean, detail?: any) =>
      steps.push({ step, ok, detail });

    // 1) Resolve callee (creator) — explicit or first onboarded creator that isn't an admin.
    let calleeId = data.calleeId;
    if (!calleeId) {
      const admins = await hiddenAdminIds(db);
      const { data: candidates } = await db
        .from("profiles")
        .select("id, username, is_creator, onboarded, is_banned")
        .eq("is_creator", true)
        .eq("onboarded", true)
        .eq("is_banned", false)
        .is("deleted_at", null)
        .limit(20);
      const pick = (candidates ?? []).find((p: any) => !admins.has(p.id));
      if (!pick) {
        return { pass: false, reason: "No eligible creator to test against.", steps };
      }
      calleeId = pick.id;
    }
    log("resolve_callee", true, { calleeId });
    const calleeIdResolved = calleeId!;

    // 2) Pick a fake caller — any other onboarded user (not the callee, not admin).
    const admins = await hiddenAdminIds(db);
    const { data: others } = await db
      .from("profiles")
      .select("id, username")
      .neq("id", calleeId)
      .eq("onboarded", true)
      .eq("is_banned", false)
      .is("deleted_at", null)
      .limit(50);
    const fakeCaller = (others ?? []).find((p: any) => !admins.has(p.id));
    if (!fakeCaller) {
      return { pass: false, reason: "No eligible caller to simulate.", steps };
    }
    log("resolve_fake_caller", true, { fakeCallerId: fakeCaller.id });

    // Snapshot original availability so we can restore on cleanup.
    const { data: profBefore } = await db
      .from("profiles")
      .select("availability")
      .eq("id", calleeId)
      .maybeSingle();
    const originalAvailability = profBefore?.availability ?? "online";

    let createdLogId: string | null = null;
    let createdInviteId: string | null = null;

    try {
      // 3) Inject stale state:
      //    a) ended call_log
      const endedAt = new Date(Date.now() - 60_000).toISOString();
      const { data: logRow, error: logErr } = await db
        .from("call_logs")
        .insert({
          caller_id: fakeCaller.id,
          callee_id: calleeId,
          kind: "voice",
          status: "completed",
          ended_at: endedAt,
          end_reason: "user_ended",
          ended_by: fakeCaller.id,
        })
        .select("id")
        .single();
      if (logErr) throw logErr;
      createdLogId = logRow.id;
      log("inject_ended_call_log", true, { callLogId: createdLogId });

      //    b) accepted invite linked to the ended log
      const { data: invRow, error: invErr } = await db
        .from("call_invites")
        .insert({
          caller_id: fakeCaller.id,
          callee_id: calleeId,
          kind: "voice",
          status: "accepted",
          call_log_id: createdLogId,
          accepted_at: endedAt,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .select("id")
        .single();
      if (invErr) throw invErr;
      createdInviteId = invRow.id;
      log("inject_accepted_invite", true, { inviteId: createdInviteId });

      //    c) stick availability on in_call
      await db.from("profiles").update({ availability: "in_call" }).eq("id", calleeId);
      log("inject_busy_availability", true);

      // 4) Run reconciliation
      const changed = await refreshStaleBusy(db, calleeId!);
      log("refresh_stale_busy", changed === true, { changed });

      // 5) Verify availability reset
      const { data: profAfter } = await db
        .from("profiles")
        .select("availability")
        .eq("id", calleeId)
        .maybeSingle();
      const availabilityReset = profAfter?.availability === "online";
      log("availability_reset_to_online", availabilityReset, {
        availability: profAfter?.availability,
      });

      // 6) Verify the stale invite was cancelled with ended_at
      const { data: invAfter } = await db
        .from("call_invites")
        .select("status, ended_at, cancelled_at")
        .eq("id", createdInviteId)
        .maybeSingle();
      const inviteCancelled =
        invAfter?.status === "cancelled" && !!invAfter?.ended_at;
      log("stale_invite_cancelled", inviteCancelled, invAfter);

      // 7) Verify assertCallable (next user → this creator) no longer throws
      let assertOk = false;
      let assertErr: string | null = null;
      try {
        await assertCallable(db, context.userId, calleeId!);
        assertOk = true;
      } catch (e: any) {
        assertErr = e?.message ?? String(e);
      }
      log("assert_callable_passes", assertOk, { error: assertErr });

      // 8) Verify busy-detection (createCallInvite's computeBusy logic) sees creator as free
      const { data: busyRows } = await db
        .from("call_invites")
        .select("id, status, caller_id, expires_at, call_log_id, call_logs:call_log_id(ended_at)")
        .eq("callee_id", calleeId)
        .in("status", ["pending", "accepted"]);
      const stillBusy = (busyRows ?? []).some((r: any) => {
        if (r.status === "accepted") return !r.call_logs?.ended_at;
        if (r.status === "pending")
          return r.expires_at && new Date(r.expires_at).getTime() > Date.now();
        return false;
      });
      log("busy_detector_clear", !stillBusy, { liveRowCount: (busyRows ?? []).length });

      const pass =
        availabilityReset && inviteCancelled && assertOk && !stillBusy;

      return {
        pass,
        calleeId,
        fakeCallerId: fakeCaller.id,
        steps,
        summary: {
          availabilityReset,
          inviteCancelled,
          assertCallableOk: assertOk,
          busyDetectorClear: !stillBusy,
        },
      };
    } finally {
      // 9) Cleanup — remove synthetic rows, restore availability
      if (createdInviteId) {
        await db.from("call_invites").delete().eq("id", createdInviteId);
      }
      if (createdLogId) {
        await db.from("call_logs").delete().eq("id", createdLogId);
      }
      await db
        .from("profiles")
        .update({ availability: originalAvailability })
        .eq("id", calleeId);
    }
  });

// ============================================================================
// E2E: Concurrent-call stress test
// Admin-only. Two callers ring the same creator at the same instant; we
// race the accept code path in parallel and assert that the DB only ever
// records ONE 'accepted' invite per callee at a time (enforced by the
// partial-unique index `call_invites_one_accepted_per_callee`).
// Rolls back every synthetic row it creates.
// ============================================================================
export const runConcurrentCallE2E = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        calleeId: z.string().uuid().optional(),
        rounds: z.number().int().min(1).max(20).optional(),
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

    const rounds = data.rounds ?? 5;
    const steps: Array<{ step: string; ok: boolean; detail?: any }> = [];
    const log = (step: string, ok: boolean, detail?: any) =>
      steps.push({ step, ok, detail });

    // Pick creator
    const admins = await hiddenAdminIds(db);
    let calleeId = data.calleeId;
    if (!calleeId) {
      const { data: candidates } = await db
        .from("profiles")
        .select("id, is_creator, onboarded, is_banned")
        .eq("is_creator", true)
        .eq("onboarded", true)
        .eq("is_banned", false)
        .is("deleted_at", null)
        .limit(20);
      const pick = (candidates ?? []).find((p: any) => !admins.has(p.id));
      if (!pick) return { pass: false, reason: "No eligible creator.", steps };
      calleeId = pick.id;
    }
    log("resolve_callee", true, { calleeId });

    // Pick two distinct fake callers
    const { data: others } = await db
      .from("profiles")
      .select("id")
      .neq("id", calleeId)
      .eq("onboarded", true)
      .eq("is_banned", false)
      .is("deleted_at", null)
      .limit(50);
    const callers = (others ?? []).filter((p: any) => !admins.has(p.id)).slice(0, 2);
    if (callers.length < 2) {
      return { pass: false, reason: "Need 2 eligible callers.", steps };
    }
    log("resolve_callers", true, { a: callers[0].id, b: callers[1].id });

    // Snapshot availability for restoration
    const { data: profBefore } = await db
      .from("profiles")
      .select("availability")
      .eq("id", calleeId)
      .maybeSingle();
    const originalAvailability = profBefore?.availability ?? "online";

    const createdInviteIds: string[] = [];
    const createdLogIds: string[] = [];

    // Simulate concurrent accept: insert call_log + UPDATE invite to accepted
    // exactly the way acceptCallInvite does, but in parallel for both invites.
    const tryAccept = async (inviteId: string, callerId: string) => {
      try {
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
        createdLogIds.push(logRow.id);

        const { data: accepted, error: updErr } = await db
          .from("call_invites")
          .update({
            status: "accepted",
            accepted_at: new Date().toISOString(),
            call_log_id: logRow.id,
          })
          .eq("id", inviteId)
          .eq("status", "pending")
          .select("id, status")
          .maybeSingle();
        if (updErr) {
          return { inviteId, ok: false, reason: updErr.message };
        }
        return { inviteId, ok: !!accepted, accepted };
      } catch (e: any) {
        return { inviteId, ok: false, reason: e?.message ?? String(e) };
      }
    };

    let totalAcceptedAcrossRounds = 0;
    let roundsWithSingleWinner = 0;
    let roundsWithUniqueViolation = 0;

    try {
      for (let r = 0; r < rounds; r++) {
        // Ensure creator is online so the next round mirrors a real race
        await db.from("profiles").update({ availability: "online" }).eq("id", calleeId);

        // Insert two pending invites bypassing the createCallInvite busy check
        // so we simulate the worst-case race window where both rings landed.
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        const { data: rowA, error: errA } = await db
          .from("call_invites")
          .insert({
            caller_id: callers[0].id,
            callee_id: calleeId,
            kind: "voice",
            status: "pending",
            expires_at: expiresAt,
          })
          .select("id").single();
        if (errA) throw errA;
        const { data: rowB, error: errB } = await db
          .from("call_invites")
          .insert({
            caller_id: callers[1].id,
            callee_id: calleeId,
            kind: "voice",
            status: "pending",
            expires_at: expiresAt,
          })
          .select("id").single();
        if (errB) throw errB;
        createdInviteIds.push(rowA.id, rowB.id);

        const [resA, resB] = await Promise.all([
          tryAccept(rowA.id, callers[0].id),
          tryAccept(rowB.id, callers[1].id),
        ]);
        const acceptedThisRound = [resA, resB].filter((r) => r.ok).length;
        totalAcceptedAcrossRounds += acceptedThisRound;
        if (acceptedThisRound === 1) roundsWithSingleWinner++;

        const violation =
          /duplicate key|call_invites_one_accepted_per_callee|23505/i.test(
            String(resA.reason ?? "") + " " + String(resB.reason ?? ""),
          );
        if (violation) roundsWithUniqueViolation++;

        // Authoritative DB check
        const { data: acceptedRows } = await db
          .from("call_invites")
          .select("id, caller_id")
          .eq("callee_id", calleeId)
          .eq("status", "accepted");
        const distinctAccepted = (acceptedRows ?? []).length;

        log(`round_${r + 1}`, acceptedThisRound === 1 && distinctAccepted === 1, {
          handlerWinners: acceptedThisRound,
          dbAcceptedRows: distinctAccepted,
          uniqueViolation: violation,
          resA, resB,
        });

        if (distinctAccepted > 1) {
          // Critical invariant breach — bail early.
          break;
        }

        // Tear down accepted invite so next round starts clean
        await db
          .from("call_invites")
          .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
          .eq("callee_id", calleeId)
          .in("id", [rowA.id, rowB.id]);
      }

      // Final aggregate check
      const { data: finalAccepted } = await db
        .from("call_invites")
        .select("id")
        .eq("callee_id", calleeId)
        .eq("status", "accepted");
      const finalAcceptedCount = (finalAccepted ?? []).length;
      log("no_lingering_accepted", finalAcceptedCount === 0, {
        finalAcceptedCount,
      });

      const pass =
        roundsWithSingleWinner === rounds &&
        totalAcceptedAcrossRounds === rounds &&
        finalAcceptedCount === 0;

      return {
        pass,
        calleeId,
        rounds,
        steps,
        summary: {
          allRoundsExactlyOneWinner: roundsWithSingleWinner === rounds,
          totalAcceptedEqualsRounds: totalAcceptedAcrossRounds === rounds,
          noLingeringAccepted: finalAcceptedCount === 0,
          uniqueIndexFiredAtLeastOnce: roundsWithUniqueViolation > 0,
        },
      };
    } finally {
      if (createdInviteIds.length) {
        await db.from("call_invites").delete().in("id", createdInviteIds);
      }
      if (createdLogIds.length) {
        await db.from("call_logs").delete().in("id", createdLogIds);
      }
      await db
        .from("profiles")
        .update({ availability: originalAvailability })
        .eq("id", calleeId);
    }
  });

// ============================================================================
// E2E: Reconciler cleanup of stale invites + orphan call_logs
// Admin-only. Seeds the exact failure modes a force-killed app leaves behind:
//   • a pending invite past its expires_at
//   • an orphan call_log (no ended_at, last heartbeat >60s ago)
//   • an "accepted" invite linked to that orphan log
//   • a standalone "accepted" invite with no call_log and an old accepted_at
// Then runs refreshStaleBusy for both callee and caller and asserts every
// row was fully cleared. Finally simulates the next accept by reserving a
// fresh pending invite via the same atomic UPDATE acceptCallInvite uses —
// if any stale row survived, the partial-unique index would reject this and
// the test FAILs. All synthetic rows are deleted in finally.
// ============================================================================
export const runReconcilerCleanupE2E = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ calleeId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const steps: Array<{ step: string; ok: boolean; detail?: any }> = [];
    const log = (step: string, ok: boolean, detail?: any) =>
      steps.push({ step, ok, detail });

    // 1) Resolve callee (creator)
    let calleeId = data.calleeId;
    const admins = await hiddenAdminIds(db);
    if (!calleeId) {
      const { data: candidates } = await db
        .from("profiles")
        .select("id")
        .eq("is_creator", true)
        .eq("onboarded", true)
        .eq("is_banned", false)
        .is("deleted_at", null)
        .limit(20);
      const pick = (candidates ?? []).find((p: any) => !admins.has(p.id));
      if (!pick) return { pass: false, reason: "No eligible creator.", steps };
      calleeId = pick.id;
    }
    log("resolve_callee", true, { calleeId });

    // 2) Pick two distinct fake callers
    const { data: others } = await db
      .from("profiles")
      .select("id")
      .neq("id", calleeId)
      .eq("onboarded", true)
      .eq("is_banned", false)
      .is("deleted_at", null)
      .limit(50);
    const pool = (others ?? []).filter((p: any) => !admins.has(p.id));
    if (pool.length < 2)
      return { pass: false, reason: "Need 2 eligible callers.", steps };
    const staleCaller = pool[0];
    const newCaller = pool[1];
    log("resolve_callers", true, {
      staleCallerId: staleCaller.id,
      newCallerId: newCaller.id,
    });

    const { data: profBefore } = await db
      .from("profiles")
      .select("availability")
      .eq("id", calleeId)
      .maybeSingle();
    const originalAvailability = profBefore?.availability ?? "online";

    const createdInviteIds: string[] = [];
    const createdLogIds: string[] = [];

    try {
      const oldIso = new Date(Date.now() - 5 * 60_000).toISOString();
      const pastIso = new Date(Date.now() - 60_000).toISOString();

      // 3a) Stale pending invite (expired)
      const { data: pendingInv, error: pErr } = await db
        .from("call_invites")
        .insert({
          caller_id: staleCaller.id,
          callee_id: calleeId,
          kind: "voice",
          status: "pending",
          expires_at: pastIso,
        })
        .select("id")
        .single();
      if (pErr) throw pErr;
      createdInviteIds.push(pendingInv.id);
      log("seed_stale_pending_invite", true, { id: pendingInv.id });

      // 3b) Orphan call_log (no ended_at, no heartbeat, started long ago)
      const { data: orphanLog, error: oErr } = await db
        .from("call_logs")
        .insert({
          caller_id: staleCaller.id,
          callee_id: calleeId,
          kind: "voice",
          status: "in_progress",
          started_at: oldIso,
        })
        .select("id")
        .single();
      if (oErr) throw oErr;
      createdLogIds.push(orphanLog.id);
      log("seed_orphan_call_log", true, { id: orphanLog.id });

      // 3c) Accepted invite tied to that orphan log
      const { data: acceptedInv, error: aErr } = await db
        .from("call_invites")
        .insert({
          caller_id: staleCaller.id,
          callee_id: calleeId,
          kind: "voice",
          status: "accepted",
          accepted_at: oldIso,
          call_log_id: orphanLog.id,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .select("id")
        .single();
      if (aErr) throw aErr;
      createdInviteIds.push(acceptedInv.id);
      log("seed_accepted_with_orphan_log", true, { id: acceptedInv.id });

      // 3d) Stick availability on in_call
      await db
        .from("profiles")
        .update({ availability: "in_call" })
        .eq("id", calleeId);
      log("seed_busy_availability", true);

      // 4) Run reconciler for both parties
      const changedCallee = await refreshStaleBusy(db, calleeId!);
      const changedCaller = await refreshStaleBusy(db, staleCaller.id);
      log("refresh_stale_busy", changedCallee === true, {
        changedCallee,
        changedCaller,
      });

      // 5) Assertions on cleared rows
      const { data: pendingAfter } = await db
        .from("call_invites")
        .select("status, cancelled_at")
        .eq("id", pendingInv.id)
        .maybeSingle();
      const pendingExpired = pendingAfter?.status === "expired";
      log("pending_invite_expired", pendingExpired, pendingAfter);

      const { data: acceptedAfter } = await db
        .from("call_invites")
        .select("status, cancelled_at")
        .eq("id", acceptedInv.id)
        .maybeSingle();
      const acceptedCancelled =
        acceptedAfter?.status === "cancelled" && !!acceptedAfter?.cancelled_at;
      log("accepted_invite_cancelled", acceptedCancelled, acceptedAfter);

      const { data: logAfter } = await db
        .from("call_logs")
        .select("ended_at, end_reason")
        .eq("id", orphanLog.id)
        .maybeSingle();
      const orphanClosed = !!logAfter?.ended_at;
      log("orphan_call_log_closed", orphanClosed, logAfter);

      const { data: profAfter } = await db
        .from("profiles")
        .select("availability")
        .eq("id", calleeId)
        .maybeSingle();
      const availabilityReset = profAfter?.availability === "online";
      log("availability_reset", availabilityReset, profAfter);

      // 6) Verify busy detector clear
      const { data: liveRows } = await db
        .from("call_invites")
        .select(
          "id, status, expires_at, call_log_id, call_logs:call_log_id(ended_at)",
        )
        .eq("callee_id", calleeId)
        .in("status", ["pending", "accepted"]);
      const stillBusy = (liveRows ?? []).some((r: any) => {
        if (r.status === "accepted")
          return r.call_log_id == null || !r.call_logs?.ended_at;
        if (r.status === "pending")
          return (
            r.expires_at && new Date(r.expires_at).getTime() > Date.now()
          );
        return false;
      });
      log("busy_detector_clear", !stillBusy, {
        liveRowCount: (liveRows ?? []).length,
      });

      // 7) Simulate the next accept: insert a fresh pending invite from a
      // different caller and run the same atomic reserve UPDATE that
      // acceptCallInvite uses. If any stale "accepted" row survived, the
      // partial-unique index would reject this reserve.
      const { data: freshInv, error: fErr } = await db
        .from("call_invites")
        .insert({
          caller_id: newCaller.id,
          callee_id: calleeId,
          kind: "voice",
          status: "pending",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .select("id")
        .single();
      if (fErr) throw fErr;
      createdInviteIds.push(freshInv.id);

      const { data: reserved, error: rErr } = await db
        .from("call_invites")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
        })
        .eq("id", freshInv.id)
        .eq("status", "pending")
        .select("id, status")
        .maybeSingle();
      const reserveOk =
        !rErr && !!reserved && reserved.status === "accepted";
      log("new_accept_reserved", reserveOk, {
        error: rErr?.message ?? null,
        reserved,
      });

      const pass =
        pendingExpired &&
        acceptedCancelled &&
        orphanClosed &&
        availabilityReset &&
        !stillBusy &&
        reserveOk;

      return {
        pass,
        calleeId,
        staleCallerId: staleCaller.id,
        newCallerId: newCaller.id,
        steps,
        summary: {
          pendingExpired,
          acceptedCancelled,
          orphanClosed,
          availabilityReset,
          busyDetectorClear: !stillBusy,
          newAcceptReserved: reserveOk,
        },
      };
    } finally {
      if (createdInviteIds.length) {
        await db
          .from("call_invites")
          .delete()
          .in("id", createdInviteIds);
      }
      if (createdLogIds.length) {
        await db.from("call_logs").delete().in("id", createdLogIds);
      }
      await db
        .from("profiles")
        .update({ availability: originalAvailability })
        .eq("id", calleeId);
    }
  });


// ============================================================================
// E2E: Stuck-prior-session → reconnect-banner → auto-connect without refresh.
//
// Simulates the exact UI flow the call-invite dialog shows when a previous
// call session left ghost state:
//
//   attempt #1 → BUSY (heartbeat still fresh)
//                 ↳ UI shows "Clearing previous call session…" amber banner
//   wait 2.5s   → reconciler-driven retry
//                 ↳ UI shows "Reconnecting delivery… (attempt N/3)" sky banner
//   attempt #2 → invite created (pending)
//   accept     → call_log open, status = accepted
//                 ↳ dialog auto-dismisses, call screen connects, NO refresh
//
// We mirror createCallInvite's busy check + acceptCallInvite's atomic reserve
// inline (impersonating users from a server fn would require service-role
// auth bypass we don't expose). The asserts prove every banner transition
// the UI relies on actually moves the underlying state forward.
// ============================================================================
export const runStuckSessionReconnectE2E = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ calleeId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const steps: Array<{ step: string; ok: boolean; detail?: any }> = [];
    const log = (step: string, ok: boolean, detail?: any) =>
      steps.push({ step, ok, detail });

    const admins = await hiddenAdminIds(db);

    // 1) Resolve callee
    let calleeId = data.calleeId;
    if (!calleeId) {
      const { data: candidates } = await db
        .from("profiles")
        .select("id")
        .eq("is_creator", true)
        .eq("onboarded", true)
        .eq("is_banned", false)
        .is("deleted_at", null)
        .limit(20);
      const pick = (candidates ?? []).find((p: any) => !admins.has(p.id));
      if (!pick) return { pass: false, reason: "No eligible creator.", steps };
      calleeId = pick.id;
    }
    log("resolve_callee", true, { calleeId });

    // 2) Pick two callers: the stuck prior caller, and the new caller
    const { data: others } = await db
      .from("profiles")
      .select("id")
      .neq("id", calleeId)
      .eq("onboarded", true)
      .eq("is_banned", false)
      .is("deleted_at", null)
      .limit(50);
    const pool = (others ?? []).filter((p: any) => !admins.has(p.id));
    if (pool.length < 2)
      return { pass: false, reason: "Need 2 eligible callers.", steps };
    const stuckCaller = pool[0];
    const newCaller = pool[1];
    log("resolve_callers", true, {
      stuckCallerId: stuckCaller.id,
      newCallerId: newCaller.id,
    });

    const { data: profBefore } = await db
      .from("profiles")
      .select("availability")
      .eq("id", calleeId)
      .maybeSingle();
    const originalAvailability = profBefore?.availability ?? "online";

    const createdInviteIds: string[] = [];
    const createdLogIds: string[] = [];

    // Mirror createCallInvite's busy check (without the reconciler pre-pass).
    const computeBusy = async (callerId: string) => {
      const { data: busyRows } = await db
        .from("call_invites")
        .select(
          "id, status, caller_id, expires_at, accepted_at, call_log_id, call_logs:call_log_id(ended_at, last_heartbeat_at)",
        )
        .eq("callee_id", calleeId)
        .in("status", ["pending", "accepted"])
        .order("created_at", { ascending: false })
        .limit(5);
      return (busyRows ?? []).some((r: any) => {
        if (r.caller_id === callerId) return false;
        if (r.status === "accepted") {
          if (r.call_logs?.ended_at) return false;
          return true;
        }
        if (
          r.status === "pending" &&
          r.expires_at &&
          new Date(r.expires_at).getTime() > Date.now()
        )
          return true;
        return false;
      });
    };

    try {
      const nowIso = new Date().toISOString();

      // 3) Seed a FRESH stuck session: open call_log with heartbeat = now,
      //    accepted invite tied to it, availability = in_call. With a fresh
      //    heartbeat refreshStaleBusy CANNOT clear it on attempt #1.
      const { data: stuckLog, error: lErr } = await db
        .from("call_logs")
        .insert({
          caller_id: stuckCaller.id,
          callee_id: calleeId,
          kind: "voice",
          status: "in_progress",
          started_at: nowIso,
          last_heartbeat_at: nowIso,
        })
        .select("id")
        .single();
      if (lErr) throw lErr;
      createdLogIds.push(stuckLog.id);

      const { data: stuckInv, error: iErr } = await db
        .from("call_invites")
        .insert({
          caller_id: stuckCaller.id,
          callee_id: calleeId,
          kind: "voice",
          status: "accepted",
          accepted_at: nowIso,
          call_log_id: stuckLog.id,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .select("id")
        .single();
      if (iErr) throw iErr;
      createdInviteIds.push(stuckInv.id);

      await db
        .from("profiles")
        .update({ availability: "in_call" })
        .eq("id", calleeId);
      log("seed_fresh_stuck_session", true, {
        callLogId: stuckLog.id,
        inviteId: stuckInv.id,
      });

      // 4) Attempt #1 — should be BUSY (this is what surfaces the
      //    "Clearing previous call session…" amber banner in the dialog).
      await refreshStaleBusy(db, calleeId!).catch(() => false);
      const attempt1Busy = await computeBusy(newCaller.id);
      log("attempt_1_returns_busy", attempt1Busy, { busy: attempt1Busy });
      const busyBannerTriggered = attempt1Busy;

      // 5) Simulate the dialog's 2.5s wait — during which the real session
      //    finally times out (heartbeat goes stale). We age the heartbeat
      //    past STALE_HEARTBEAT_MS (60s) so reconciler can now clear it.
      const stalePastIso = new Date(Date.now() - 90_000).toISOString();
      await db
        .from("call_logs")
        .update({ last_heartbeat_at: stalePastIso, started_at: stalePastIso })
        .eq("id", stuckLog.id);
      log("age_heartbeat_past_threshold", true);

      // 6) Attempt #2 — reconciler clears ghost state, busy check passes,
      //    invite is created. (UI banner switches to "Reconnecting
      //    delivery… (attempt 2/3)" sky banner during this phase.)
      const reconcilerChanged = await refreshStaleBusy(db, calleeId!);
      const attempt2Busy = await computeBusy(newCaller.id);
      log("attempt_2_busy_cleared", !attempt2Busy, {
        reconcilerChanged,
        busy: attempt2Busy,
      });

      const { data: stuckLogAfter } = await db
        .from("call_logs")
        .select("ended_at, end_reason")
        .eq("id", stuckLog.id)
        .maybeSingle();
      log("stuck_log_closed_by_reconciler", !!stuckLogAfter?.ended_at, stuckLogAfter);

      const { data: stuckInvAfter } = await db
        .from("call_invites")
        .select("status, cancelled_at")
        .eq("id", stuckInv.id)
        .maybeSingle();
      log(
        "stuck_invite_cancelled_by_reconciler",
        stuckInvAfter?.status === "cancelled",
        stuckInvAfter,
      );

      // 7) New invite created (mirrors createCallInvite insert).
      const { data: freshInv, error: fErr } = await db
        .from("call_invites")
        .insert({
          caller_id: newCaller.id,
          callee_id: calleeId,
          kind: "voice",
          status: "pending",
          expires_at: new Date(
            Date.now() + INVITE_TTL_SECONDS * 1000,
          ).toISOString(),
        })
        .select("id, status")
        .single();
      if (fErr) throw fErr;
      createdInviteIds.push(freshInv.id);
      log("new_invite_created_pending", freshInv.status === "pending", freshInv);

      const reconnectBannerTriggered = busyBannerTriggered && !attempt2Busy;

      // 8) Accept atomically (mirrors acceptCallInvite reserve UPDATE).
      const acceptStartedAt = new Date().toISOString();
      const { data: connectLog, error: clErr } = await db
        .from("call_logs")
        .insert({
          caller_id: newCaller.id,
          callee_id: calleeId,
          kind: "voice",
          status: "in_progress",
          started_at: acceptStartedAt,
          last_heartbeat_at: acceptStartedAt,
        })
        .select("id")
        .single();
      if (clErr) throw clErr;
      createdLogIds.push(connectLog.id);

      const { data: reserved, error: rErr } = await db
        .from("call_invites")
        .update({
          status: "accepted",
          accepted_at: acceptStartedAt,
          call_log_id: connectLog.id,
        })
        .eq("id", freshInv.id)
        .eq("status", "pending")
        .select("id, status, call_log_id")
        .maybeSingle();
      const acceptedOk =
        !rErr &&
        !!reserved &&
        reserved.status === "accepted" &&
        reserved.call_log_id === connectLog.id;
      log("new_invite_accepted_atomically", acceptedOk, {
        error: rErr?.message ?? null,
        reserved,
      });

      // 9) Prove the connection is live without any "refresh" step: the
      //    new call_log has an open ended_at and a fresh heartbeat.
      const { data: liveLog } = await db
        .from("call_logs")
        .select("id, ended_at, last_heartbeat_at")
        .eq("id", connectLog.id)
        .maybeSingle();
      const connectedWithoutRefresh =
        !!liveLog && !liveLog.ended_at && !!liveLog.last_heartbeat_at;
      log("call_connected_without_refresh", connectedWithoutRefresh, liveLog);

      const pass =
        busyBannerTriggered &&
        !attempt2Busy &&
        reconnectBannerTriggered &&
        freshInv.status === "pending" &&
        acceptedOk &&
        connectedWithoutRefresh;

      return {
        pass,
        calleeId,
        stuckCallerId: stuckCaller.id,
        newCallerId: newCaller.id,
        steps,
        summary: {
          busyBannerTriggered,
          reconcilerClearedStuckSession: !attempt2Busy,
          reconnectBannerTriggered,
          newInvitePending: freshInv.status === "pending",
          atomicAcceptSucceeded: acceptedOk,
          connectedWithoutRefresh,
        },
      };
    } finally {
      if (createdInviteIds.length) {
        await db.from("call_invites").delete().in("id", createdInviteIds);
      }
      if (createdLogIds.length) {
        await db.from("call_logs").delete().in("id", createdLogIds);
      }
      await db
        .from("profiles")
        .update({ availability: originalAvailability })
        .eq("id", calleeId);
    }
  });
