import { useRouterState } from "@tanstack/react-router";
import { shouldShowInCallChrome } from "@/lib/call-banner-visibility";

/**
 * Headless mock that mirrors the InCallPeerProfileSheet visibility rules
 * for BOTH the in-call chrome and the post-call "last call" notice.
 *
 * In-call chrome (banner + "Back to call" CTA) shows only when:
 *   1. `?inCall=true`, AND
 *   2. Current pathname starts with `/call/`.
 *
 * Last-call notice (`data-testid="last-call-unavailable-notice"`) shows
 * only when in-call chrome is hidden AND a `?lastCallStatus=` param is
 * provided. This mirrors the real component's
 * `!showInCallChrome && lastCall` gate so the regression suite catches
 * any future leak of the notice onto live-call surfaces or its
 * disappearance from profile-preview surfaces.
 *
 * Optional params:
 *   ?lastCallStatus=completed|missed|cancelled
 *   ?missedReason=expired|callee_rejected|caller_cancelled
 *   ?kind=voice|video   (default voice)
 *
 * Mounted at two paths to exercise both sides of the rule:
 *   - /__e2e/peer-sheet-banner    — non-call surface (Recents/profile preview)
 *   - /call/__e2e/peer-sheet-banner — live call surface
 *
 * Do NOT link to these routes from product UI.
 */
type LastCallStatus = "completed" | "missed" | "cancelled";
type MissedReason = "expired" | "callee_rejected" | "caller_cancelled";

function lastCallTitle(status: LastCallStatus, reason: MissedReason | null): string {
  if (status === "missed") {
    if (reason === "expired") return "Missed call — naya call shuru karein";
    if (reason === "callee_rejected") return "Call decline ho gayi thi";
    if (reason === "caller_cancelled") return "Call cancel ho gayi thi";
    return "Missed call";
  }
  if (status === "cancelled") return "Call cancel ho gayi thi";
  return "Pichla call end ho chuka hai";
}

export function PeerSheetBannerE2EMock() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({
    select: (s) => s.location.search as Record<string, unknown>,
  });
  const inCall = String(search?.inCall ?? "false") === "true";
  const show = shouldShowInCallChrome(inCall, path);

  const rawStatus = String(search?.lastCallStatus ?? "");
  const lastCallStatus: LastCallStatus | null =
    rawStatus === "completed" || rawStatus === "missed" || rawStatus === "cancelled"
      ? rawStatus
      : null;
  const rawReason = String(search?.missedReason ?? "");
  const missedReason: MissedReason | null =
    rawReason === "expired" ||
    rawReason === "callee_rejected" ||
    rawReason === "caller_cancelled"
      ? rawReason
      : null;
  const kind = String(search?.kind ?? "voice") === "video" ? "video" : "voice";

  const showLastCall = !show && lastCallStatus !== null;

  return (
    <div
      data-testid="peer-sheet-banner-mock"
      data-path={path}
      data-in-call={inCall ? "1" : "0"}
      data-last-call-status={lastCallStatus ?? ""}
    >
      {show ? (
        <>
          <div data-testid="in-call-banner">
            Apka call abhi bhi chal raha hai.
          </div>
          <button data-testid="back-to-call-cta">Back to call</button>
        </>
      ) : (
        <>
          <div data-testid="no-in-call-banner">No call in progress</div>
          <button data-testid="close-cta">Close</button>
        </>
      )}

      {showLastCall ? (
        <div data-testid="last-call-unavailable-notice">
          <div data-testid="last-call-title">
            {lastCallTitle(lastCallStatus, missedReason)}
          </div>
          <div data-testid="last-call-desc">
            Yeh call ab live nahi hai — dobara baat karne ke liye{" "}
            {kind === "video" ? "Video call" : "Voice call"} button dabaayein.
          </div>
        </div>
      ) : null}
    </div>
  );
}
