import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withAiAvatar, withAiAvatars } from "./ai-avatar";
import { notifyUser, notifyIncomingCall, notifyCallEnded } from "./push.functions";

const KindSchema = z.enum(["voice", "video"]);
const InviteIdSchema = z.object({ inviteId: z.string().uuid() });
const INVITE_TTL_SECONDS = 45;

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
    }
  }

  // 2) Cancel "accepted" invites whose underlying call already ended
  const { data: acceptedRows } = await db
    .from("call_invites")
    .select("id, call_log_id, call_logs:call_log_id(ended_at)")
    .eq("callee_id", calleeId)
    .eq("status", "accepted");
  const staleIds = (acceptedRows ?? [])
    .filter((r: any) => r.call_logs?.ended_at)
    .map((r: any) => r.id);
  if (staleIds.length > 0) {
    await db
      .from("call_invites")
      .update({ status: "cancelled", cancelled_at: nowIso, ended_at: nowIso })
      .in("id", staleIds);
    changed = true;
  }

  // 3) Reset availability stuck on busy/in_call if nothing is actually live
  const { data: liveRows } = await db
    .from("call_invites")
    .select("id, status, expires_at, call_logs:call_log_id(ended_at)")
    .eq("callee_id", calleeId)
    .in("status", ["pending", "accepted"]);
  const hasLive = (liveRows ?? []).some((r: any) => {
    if (r.status === "accepted") return !r.call_logs?.ended_at;
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
      const changed = await refreshStaleBusy(db, calleeId);
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

function statusDto(invite: any, userId: string, log?: any) {
  return {
    id: invite.id as string,
    kind: invite.kind as "voice" | "video",
    status: invite.status as "pending" | "accepted" | "rejected" | "missed" | "cancelled" | "expired",
    callerId: invite.caller_id as string,
    calleeId: invite.callee_id as string,
    role: invite.caller_id === userId ? "caller" : "callee",
    callLogId: (invite.call_log_id ?? log?.id ?? null) as string | null,
    expiresAt: invite.expires_at as string,
    deliveredAt: (invite.delivered_at ?? null) as string | null,
    baselineDurationSeconds: Number(log?.duration_seconds ?? 0),
    baselineFreeSecondsUsed: Number(log?.free_seconds_used ?? 0),
    baselineCoinsSpent: Number(log?.coins_spent ?? 0),
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

    // Busy detection: callee already ringing with someone else or in an active accepted call.
    // We JOIN to call_logs so an "accepted" invite whose call already ended
    // (ended_at IS NOT NULL) is NOT treated as busy — otherwise stale rows
    // would brick the creator's inbox forever.
    const { data: busyRows } = await db
      .from("call_invites")
      .select("id, status, caller_id, expires_at, accepted_at, call_log_id, call_logs:call_log_id(ended_at)")
      .eq("callee_id", data.calleeId)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: false })
      .limit(5);
    const isBusy = (busyRows ?? []).some((r: any) => {
      if (r.caller_id === callerId) return false;
      if (r.status === "accepted") {
        // accepted but the underlying call has already ended → not busy
        if (r.call_logs?.ended_at) return false;
        return true;
      }
      if (r.status === "pending" && r.expires_at && new Date(r.expires_at).getTime() > Date.now()) return true;
      return false;
    });
    if (isBusy) throw new Error("BUSY: This creator is on another call right now.");

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
      throw new Error(msg || "Could not create call invite.");
    }

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
    return statusDto(invite, context.userId, log);
  });

export const acceptCallInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => InviteIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: rawInvite } = await db.from("call_invites").select("*").eq("id", data.inviteId).maybeSingle();
    if (!rawInvite || rawInvite.callee_id !== context.userId) throw new Error("Call invite not found.");
    const invite = await expireIfNeeded(db, rawInvite);
    if (invite.status !== "pending") throw new Error("This call is no longer ringing.");
    await assertCallable(db, invite.caller_id, invite.callee_id);

    const { data: log, error: logErr } = await db
      .from("call_logs")
      .insert({ caller_id: invite.caller_id, callee_id: invite.callee_id, kind: invite.kind, status: "completed" })
      .select("id, duration_seconds, coins_spent, free_seconds_used")
      .single();
    if (logErr) throw new Error(logErr.message);

    const { data: accepted, error } = await db
      .from("call_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString(), call_log_id: log.id })
      .eq("id", invite.id)
      .eq("status", "pending")
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return statusDto(accepted, context.userId, log);
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