import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logCallEvent, type CallEventType } from "./call-telemetry.server";

const UI_EVENT_TYPES: ReadonlySet<string> = new Set<CallEventType>([
  "ui_gift_open",
  "ui_gift_send_confirmed",
  "ui_gift_send_blocked",
  "ui_mute_toggled",
  "ui_mute_blocked",
  "ui_speaker_toggled",
  "ui_speaker_blocked",
  "ui_end_call_clicked",
  "ui_end_call_blocked",
  "ui_sos_opened",
  "ui_sos_confirmed",
  "ui_sos_blocked",
]);

export interface LogCallUiEventInput {
  eventType: CallEventType;
  callLogId?: string | null;
  inviteId?: string | null;
  partnerUserId?: string | null;
  kind?: string | null;
  reason?: string | null;
  ok?: boolean | null;
  durationMs?: number | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Record an in-call UI action (gift sheet open, gift send result, mute /
 * speaker toggle, end-call tap, SOS) against the active call_log. The actor
 * is taken from the authenticated session so clients cannot spoof user ids.
 *
 * Best-effort: never throws — telemetry failures must not break the call UI.
 */
export const logCallUiEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: LogCallUiEventInput) => input)
  .handler(async ({ data, context }) => {
    try {
      if (!UI_EVENT_TYPES.has(data.eventType)) {
        return { ok: false, reason: "unsupported_event_type" as const };
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Best-effort: resolve caller/callee + kind from the call_log when
      // present so the row is queryable by either side of the call.
      let callerId: string | null = null;
      let calleeId: string | null = null;
      let kind: string | null = data.kind ?? null;
      if (data.callLogId) {
        const { data: log } = await supabaseAdmin
          .from("call_logs")
          .select("caller_id, callee_id, kind")
          .eq("id", data.callLogId)
          .maybeSingle();
        if (log) {
          callerId = log.caller_id ?? null;
          calleeId = log.callee_id ?? null;
          kind = kind ?? log.kind ?? null;
        }
      }

      await logCallEvent(supabaseAdmin as any, {
        eventType: data.eventType,
        inviteId: data.inviteId ?? null,
        callLogId: data.callLogId ?? null,
        callerId,
        calleeId,
        actorId: context.userId,
        kind,
        reason: data.reason ?? null,
        durationMs: data.durationMs ?? null,
        ok: data.ok ?? null,
        meta: {
          ...(data.meta ?? {}),
          ...(data.partnerUserId ? { partnerUserId: data.partnerUserId } : {}),
        },
      });

      return { ok: true as const };
    } catch (e: any) {
      try {
        // eslint-disable-next-line no-console
        console.warn("[call-ui-telemetry] insert failed", data?.eventType, e?.message ?? e);
      } catch {}
      return { ok: false as const, reason: "exception" };
    }
  });
