/**
 * Single source of truth for "should the InCallPeerProfileSheet render
 * in-call chrome (the 'call abhi bhi chal raha hai' banner + 'Back to call'
 * CTA + call-related confirmation copy)?".
 *
 * Bug history: the banner used to appear on Recents and profile-preview
 * surfaces even when no call was active, because it was gated solely on a
 * caller-supplied `inCall` prop. Now it requires BOTH:
 *
 *   1. The caller explicitly opts in via `inCall = true`, AND
 *   2. The current route is the live call surface (`/call/...`).
 *
 * Keep this rule centralised so the sheet and its regression tests cannot
 * drift apart. See `tests/e2e/peer-sheet-banner.spec.ts`.
 */
export function isCallRoutePath(pathname: string): boolean {
  return /^\/call\//.test(pathname);
}

export function shouldShowInCallChrome(
  inCall: boolean,
  pathname: string,
): boolean {
  return inCall && isCallRoutePath(pathname);
}
