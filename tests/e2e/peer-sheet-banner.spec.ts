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
