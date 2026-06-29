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
    throw new Error(callee.availability === "dnd" ? "This creator is on Do Not Disturb." : "This creator is busy right now.");
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
  return data ?? { ...invite, status: "expired" };
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
    const nowIso = new Date().toISOString();
    const { data: busyRows } = await db
      .from("call_invites")
      .select("id, status, caller_id, expires_at, accepted_at")
      .eq("callee_id", data.calleeId)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: false })
      .limit(5);
    const isBusy = (busyRows ?? []).some((r: any) => {
      if (r.caller_id === callerId) return false;
      if (r.status === "accepted") return true;
      if (r.status === "pending" && r.expires_at && new Date(r.expires_at).getTime() > Date.now()) return true;
      return false;
    });
    if (isBusy) throw new Error("BUSY: This creator is on another call right now.");

    await db
      .from("call_invites")
      .update({ status: "cancelled", cancelled_at: nowIso })
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

    await notifyUser({
      userId: data.calleeId,
      kind: "calls",
      title: `Incoming ${data.kind === "video" ? "video" : "audio"} call`,
      body: `${caller.username ?? "Someone"} is calling you. Tap to answer.`,
      // Open a normal authenticated screen so the global IncomingCallDialog can
      // show the ringing UI. Do not deep-link directly into /call; the call
      // route is now reserved for already-accepted invites only.
      deepLink: `/home`,
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
    await db
      .from("call_invites")
      .update({ status: "rejected", rejected_at: new Date().toISOString() })
      .eq("id", data.inviteId)
      .eq("status", "pending");
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
    await db
      .from("call_invites")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", data.inviteId)
      .eq("status", "pending");
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