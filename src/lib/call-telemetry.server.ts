/**
 * Server-only telemetry for call lifecycle events.
 *
 * Writes one row per significant transition into `public.call_events` so we
 * can replay any call's timeline and quickly diagnose ghost-state, stuck
 * "busy", or accept-conflict bugs. Never throws — telemetry failures must
 * not break the actual call flow.
 */

export type CallEventType =
  // Outbound invite
  | "invite_created"
  | "invite_busy"
  | "invite_failed"
  | "invite_cancelled"
  | "invite_expired"
  // Inbound accept
  | "invite_accepted"
  | "accept_conflict"
  | "accept_ghost_cleared"
  | "accept_rejected"
  // Live call
  | "call_connected"
  | "call_heartbeat_stale"
  | "call_ended"
  // Reconciliation
  | "stale_invite_expired"
  | "stale_accepted_cancelled"
  | "stale_availability_reset"
  | "orphan_log_closed"
  // In-call UI actions (recorded from the client via logCallUiEvent)
  | "ui_gift_open"
  | "ui_gift_send_confirmed"
  | "ui_gift_send_blocked"
  | "ui_mute_toggled"
  | "ui_mute_blocked"
  | "ui_speaker_toggled"
  | "ui_speaker_blocked"
  | "ui_end_call_clicked"
  | "ui_end_call_blocked"
  | "ui_sos_opened"
  | "ui_sos_confirmed"
  | "ui_sos_blocked";

export interface CallEventInput {
  eventType: CallEventType;
  inviteId?: string | null;
  callLogId?: string | null;
  callerId?: string | null;
  calleeId?: string | null;
  actorId?: string | null;
  kind?: string | null;
  status?: string | null;
  reason?: string | null;
  durationMs?: number | null;
  ok?: boolean | null;
  meta?: Record<string, unknown> | null;
}

export async function logCallEvent(db: any, evt: CallEventInput): Promise<void> {
  try {
    await db.from("call_events").insert({
      event_type: evt.eventType,
      invite_id: evt.inviteId ?? null,
      call_log_id: evt.callLogId ?? null,
      caller_id: evt.callerId ?? null,
      callee_id: evt.calleeId ?? null,
      actor_id: evt.actorId ?? null,
      kind: evt.kind ?? null,
      status: evt.status ?? null,
      reason: evt.reason ?? null,
      duration_ms: evt.durationMs ?? null,
      ok: evt.ok ?? null,
      meta: evt.meta ?? null,
    });
  } catch (e) {
    // Best-effort; mirror to server log so we still see something in worker logs.
    try {
      // eslint-disable-next-line no-console
      console.warn("[call-telemetry] insert failed", evt.eventType, (e as any)?.message ?? e);
    } catch {}
  }
}

/**
 * Mark a call as connected exactly once. Called from `heartbeatCall` —
 * the first heartbeat from either side implies both sides have media up,
 * since the client only starts heartbeating after the WebRTC join event.
 */
export async function maybeLogConnected(
  db: any,
  callLogId: string,
  actorId: string,
): Promise<void> {
  try {
    const { data: existing } = await db
      .from("call_events")
      .select("id")
      .eq("call_log_id", callLogId)
      .eq("event_type", "call_connected")
      .limit(1)
      .maybeSingle();
    if (existing) return;
    const { data: log } = await db
      .from("call_logs")
      .select("id, caller_id, callee_id, kind, created_at")
      .eq("id", callLogId)
      .maybeSingle();
    if (!log) return;
    const ringMs = log.created_at
      ? Math.max(0, Date.now() - new Date(log.created_at).getTime())
      : null;
    await logCallEvent(db, {
      eventType: "call_connected",
      callLogId,
      callerId: log.caller_id,
      calleeId: log.callee_id,
      actorId,
      kind: log.kind,
      durationMs: ringMs,
      ok: true,
      meta: { source: "heartbeat" },
    });
  } catch (e) {
    try {
      // eslint-disable-next-line no-console
      console.warn("[call-telemetry] maybeLogConnected failed", (e as any)?.message ?? e);
    } catch {}
  }
}
