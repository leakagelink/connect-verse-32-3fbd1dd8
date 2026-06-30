import { logCallUiEvent, type LogCallUiEventInput } from "./call-ui-telemetry.functions";

/**
 * Client-side fire-and-forget wrapper around `logCallUiEvent`. Telemetry
 * MUST NOT block UI interactions or surface errors to the user, so we
 * intentionally swallow rejections and log them only to the console.
 *
 *   recordCallUiEvent({ eventType: "ui_gift_open", callLogId });
 *   recordCallUiEvent({
 *     eventType: "ui_speaker_blocked",
 *     callLogId,
 *     reason: "sdk-error",
 *     meta: { error: String(err) },
 *   });
 */
export function recordCallUiEvent(input: LogCallUiEventInput): void {
  try {
    void logCallUiEvent({ data: input }).catch((e) => {
      try {
        // eslint-disable-next-line no-console
        console.debug("[call-ui-telemetry] send failed", input.eventType, e?.message ?? e);
      } catch {}
    });
  } catch (e) {
    try {
      // eslint-disable-next-line no-console
      console.debug("[call-ui-telemetry] sync error", input.eventType, (e as any)?.message ?? e);
    } catch {}
  }
}
