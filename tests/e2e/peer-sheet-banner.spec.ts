import { expect, test, type Page } from "@playwright/test";

// Regression guard for the "in-call banner leaked into Recents / profile
// preview" bug.
//
// Contract enforced by `shouldShowInCallChrome(inCall, pathname)` in
// `src/lib/call-banner-visibility.ts` and consumed by
// `InCallPeerProfileSheet`:
//
//   show banner  ⇔  inCall === true  AND  pathname starts with "/call/"
//
// This spec drives two unauthenticated mock routes that render the SAME
// rule via `PeerSheetBannerE2EMock`:
//
//   - /__e2e/peer-sheet-banner       (simulates Recents / profile preview)
//   - /call/__e2e/peer-sheet-banner  (simulates live call surface)
//
// Any future change that re-introduces the bug (e.g. dropping the route
// check or gating on `inCall` alone) will flip one of these assertions.
const NON_CALL_ROUTE = "/__e2e/peer-sheet-banner";
const CALL_ROUTE = "/call/__e2e/peer-sheet-banner";

async function assertBannerHidden(page: Page, label: string) {
  await expect(
    page.getByTestId("peer-sheet-banner-mock"),
    `mock failed to mount at "${label}"`,
  ).toBeVisible();
  await expect(
    page.getByTestId("in-call-banner"),
    `in-call banner leaked at "${label}"`,
  ).toHaveCount(0);
  await expect(
    page.getByTestId("back-to-call-cta"),
    `"Back to call" CTA leaked at "${label}"`,
  ).toHaveCount(0);
  await expect(
    page.getByTestId("no-in-call-banner"),
    `expected "no call in progress" copy at "${label}"`,
  ).toBeVisible();
  await expect(
    page.getByTestId("close-cta"),
    `expected "Close" CTA at "${label}"`,
  ).toBeVisible();
}

async function assertBannerVisible(page: Page, label: string) {
  await expect(
    page.getByTestId("peer-sheet-banner-mock"),
    `mock failed to mount at "${label}"`,
  ).toBeVisible();
  await expect(
    page.getByTestId("in-call-banner"),
    `in-call banner missing at "${label}"`,
  ).toBeVisible();
  await expect(
    page.getByTestId("back-to-call-cta"),
    `"Back to call" CTA missing at "${label}"`,
  ).toBeVisible();
  await expect(
    page.getByTestId("no-in-call-banner"),
    `out-of-call copy leaked at "${label}"`,
  ).toHaveCount(0);
}

test.describe("InCallPeerProfileSheet banner visibility regression", () => {
  test("recents / profile preview never show the in-call banner", async ({
    page,
  }) => {
    // inCall=false on a non-call route → out-of-call UI.
    await page.goto(`${NON_CALL_ROUTE}?inCall=false`);
    await assertBannerHidden(page, "non-call route, inCall=false");

    // inCall=true on a non-call route → STILL out-of-call UI. This is the
    // exact regression we're guarding against: callers that forget to
    // reset `inCall` (Recents, profile preview, deep links) must not be
    // able to surface the banner outside `/call/*`.
    await page.goto(`${NON_CALL_ROUTE}?inCall=true`);
    await assertBannerHidden(page, "non-call route, inCall=true (regression)");
  });

  test("live call surface shows the in-call banner only when inCall=true", async ({
    page,
  }) => {
    // On the call route but the caller did not opt in → no banner. Prevents
    // the banner from rendering during the brief mount window before a
    // parent sets `inCall`.
    await page.goto(`${CALL_ROUTE}?inCall=false`);
    await assertBannerHidden(page, "call route, inCall=false");

    // The only state in which the banner is allowed to appear.
    await page.goto(`${CALL_ROUTE}?inCall=true`);
    await assertBannerVisible(page, "call route, inCall=true");
  });
});

// ---------------------------------------------------------------------------
// Last-call alert visibility regression
// ---------------------------------------------------------------------------
//
// Contract enforced by InCallPeerProfileSheet:
//
//   show last-call notice  ⇔  in-call chrome is hidden  AND  a `lastCall`
//                              context is passed in.
//
// This guards two failure modes:
//   1. Notice leaks onto the live call surface (alongside the in-call
//      banner) — confusing during an active call.
//   2. Notice silently disappears from profile-preview surfaces opened
//      from Recents — losing the "call ab live nahi hai" affordance the
//      user relies on to retry.
//
// The mock at `/__e2e/peer-sheet-banner` accepts `?lastCallStatus=` plus
// optional `?missedReason=` and `?kind=` query params and renders the
// notice via the same rule as the real component.

async function assertLastCallNoticeHidden(page: Page, label: string) {
  await expect(
    page.getByTestId("last-call-unavailable-notice"),
    `last-call notice leaked at "${label}"`,
  ).toHaveCount(0);
}

async function assertLastCallNoticeVisible(
  page: Page,
  expectedTitle: string,
  label: string,
) {
  await expect(
    page.getByTestId("last-call-unavailable-notice"),
    `last-call notice missing at "${label}"`,
  ).toBeVisible();
  await expect(
    page.getByTestId("last-call-title"),
    `last-call title wrong at "${label}"`,
  ).toHaveText(expectedTitle);
}

test.describe("last-call alert visibility regression", () => {
  test("profile preview (non-call) renders the correct last-call copy per status", async ({
    page,
  }) => {
    // Missed + expired invite → "naya call shuru karein" affordance.
    await page.goto(
      `${NON_CALL_ROUTE}?lastCallStatus=missed&missedReason=expired&kind=video`,
    );
    await assertLastCallNoticeVisible(
      page,
      "Missed call — naya call shuru karein",
      "non-call route, missed/expired",
    );
    await expect(page.getByTestId("last-call-desc")).toContainText(
      "Video call",
    );

    // Missed + callee_rejected → "Call decline ho gayi thi".
    await page.goto(
      `${NON_CALL_ROUTE}?lastCallStatus=missed&missedReason=callee_rejected`,
    );
    await assertLastCallNoticeVisible(
      page,
      "Call decline ho gayi thi",
      "non-call route, missed/callee_rejected",
    );

    // Missed + caller_cancelled → "Call cancel ho gayi thi".
    await page.goto(
      `${NON_CALL_ROUTE}?lastCallStatus=missed&missedReason=caller_cancelled`,
    );
    await assertLastCallNoticeVisible(
      page,
      "Call cancel ho gayi thi",
      "non-call route, missed/caller_cancelled",
    );

    // Cancelled (top-level status) → same cancel copy.
    await page.goto(`${NON_CALL_ROUTE}?lastCallStatus=cancelled`);
    await assertLastCallNoticeVisible(
      page,
      "Call cancel ho gayi thi",
      "non-call route, cancelled",
    );

    // Completed → "Pichla call end ho chuka hai".
    await page.goto(`${NON_CALL_ROUTE}?lastCallStatus=completed`);
    await assertLastCallNoticeVisible(
      page,
      "Pichla call end ho chuka hai",
      "non-call route, completed",
    );
  });

  test("notice is hidden when no last-call context is provided", async ({
    page,
  }) => {
    // Recents row / profile preview with no prior call → no notice.
    await page.goto(`${NON_CALL_ROUTE}?inCall=false`);
    await assertLastCallNoticeHidden(page, "non-call route, no lastCall");

    // Even with a stuck `inCall=true` flag on a non-call route, the
    // absence of lastCall must keep the notice hidden (banner is also
    // suppressed by the existing rule above).
    await page.goto(`${NON_CALL_ROUTE}?inCall=true`);
    await assertLastCallNoticeHidden(
      page,
      "non-call route, inCall=true, no lastCall",
    );
  });

  test("live call surface never renders the last-call notice", async ({
    page,
  }) => {
    // Call route + inCall=true → in-call banner shows, notice must NOT
    // leak in alongside it even if a lastCall context is passed.
    await page.goto(
      `${CALL_ROUTE}?inCall=true&lastCallStatus=missed&missedReason=expired`,
    );
    await expect(page.getByTestId("in-call-banner")).toBeVisible();
    await assertLastCallNoticeHidden(
      page,
      "call route, inCall=true, lastCall=missed",
    );

    // Call route + inCall=false: the in-call banner is suppressed
    // (matches the existing chrome rule), so the post-call notice is
    // free to render — same gate the real component uses
    // (`!showInCallChrome && lastCall`). This documents that the notice
    // is suppressed by the in-call banner, not by the route itself.
    await page.goto(
      `${CALL_ROUTE}?inCall=false&lastCallStatus=completed`,
    );
    await expect(page.getByTestId("in-call-banner")).toHaveCount(0);
    await assertLastCallNoticeVisible(
      page,
      "Pichla call end ho chuka hai",
      "call route, inCall=false, lastCall=completed",
    );
  });
});
