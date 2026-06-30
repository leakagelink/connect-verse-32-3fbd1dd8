import { useRouterState } from "@tanstack/react-router";
import { shouldShowInCallChrome } from "@/lib/call-banner-visibility";

/**
 * Headless mock that mirrors the InCallPeerProfileSheet visibility rule:
 * the "Apka call abhi bhi chal raha hai" banner + "Back to call" CTA must
 * appear ONLY when both conditions hold:
 *
 *   1. The caller opts in via `inCall=true` (driven by `?inCall=true|false`).
 *   2. The current pathname starts with `/call/`.
 *
 * Mounted at two paths to exercise both sides of the rule:
 *   - /__e2e/peer-sheet-banner    — non-call surface (Recents/profile preview)
 *   - /call/__e2e/peer-sheet-banner — live call surface
 *
 * Renders stable test IDs the Playwright spec asserts against. Do NOT link
 * to these routes from product UI.
 */
export function PeerSheetBannerE2EMock() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search }) as Record<
    string,
    unknown
  >;
  const inCall = String(search?.inCall ?? "false") === "true";
  const show = shouldShowInCallChrome(inCall, path);

  return (
    <div
      data-testid="peer-sheet-banner-mock"
      data-path={path}
      data-in-call={inCall ? "1" : "0"}
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
    </div>
  );
}
