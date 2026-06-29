import { expect, test, type Page } from "@playwright/test";

// CI guard for the Call Fullscreen + 3-Click End contract.
//
// This spec MUST fail the build if any of the following regress:
//   * The call surface fails to mount fullscreen.
//   * AppShell chrome (top header, bottom nav, generic app-shell wrapper)
//     leaks into the call surface at any point before the call ends.
//   * The user navigates away from the call route mid-call.
//   * Disconnect happens in fewer than three deliberate taps.
//
// It drives `/__e2e/call-fullscreen`, an unauthenticated route that renders
// the same `CallFullscreenE2EMock` the Admin panel iframes. That keeps the
// assertions identical to the in-app E2E panel while staying runnable in CI
// without any backend session.
const ROUTE = "/__e2e/call-fullscreen";

const CHROME_SELECTORS = [
  "[data-app-shell]",
  "[data-bottom-nav]",
  "header[role='banner']",
  "nav[aria-label='Bottom navigation']",
];

async function assertNoChromeLeak(page: Page, label: string) {
  for (const sel of CHROME_SELECTORS) {
    const count = await page.locator(sel).count();
    expect(count, `AppShell chrome leak (${sel}) detected at "${label}"`).toBe(0);
  }
}

async function assertOnCallRoute(page: Page, label: string) {
  const path = new URL(page.url()).pathname;
  expect(path, `expected to stay on ${ROUTE} at "${label}", got ${path}`).toBe(ROUTE);
}

async function assertNotEnded(page: Page, label: string) {
  const ended = await page.getByTestId("call-fullscreen").getAttribute("data-e2e-ended");
  expect(ended, `call ended too early at "${label}"`).toBe("0");
}

test.describe("Call fullscreen + 3-click end contract", () => {
  test("stays fullscreen and requires three taps to disconnect", async ({ page }) => {
    await page.goto(ROUTE);

    const surface = page.getByTestId("call-fullscreen");
    await expect(surface, "call-fullscreen never mounted").toBeVisible();

    await assertNoChromeLeak(page, "initial mount");
    await assertOnCallRoute(page, "initial mount");
    await assertNotEnded(page, "initial mount");

    // --- Click 1: opens step-1 confirm. Must NOT disconnect. ---
    await page.getByTestId("end-call-btn").click();
    await expect(page.getByTestId("end-confirm-step1")).toBeVisible();
    await assertNoChromeLeak(page, "after click 1");
    await assertOnCallRoute(page, "after click 1");
    await assertNotEnded(page, "after click 1");

    // "Stay on call" must cancel without disconnect or chrome leak.
    await page.getByTestId("end-stay").click();
    await expect(page.getByTestId("end-confirm-step1")).toBeHidden();
    await assertNoChromeLeak(page, "after Stay");
    await assertOnCallRoute(page, "after Stay");
    await assertNotEnded(page, "after Stay");

    // --- Click 1 (re-open) -> Click 2 -> step-2 confirm. Still no disconnect. ---
    await page.getByTestId("end-call-btn").click();
    await page.getByTestId("end-confirm-step1").click();
    await expect(page.getByTestId("end-confirm-step2")).toBeVisible();
    await assertNoChromeLeak(page, "after click 2");
    await assertOnCallRoute(page, "after click 2");
    await assertNotEnded(page, "after click 2");

    // --- Click 3: the only click allowed to disconnect. ---
    await page.getByTestId("end-confirm-step2").click();
    await expect(surface).toHaveAttribute("data-e2e-ended", "1");
    await assertOnCallRoute(page, "after click 3");
  });

  test("back-navigation cannot escape the call surface", async ({ page }) => {
    await page.goto(ROUTE);
    await expect(page.getByTestId("call-fullscreen")).toBeVisible();

    await page.goBack().catch(() => {});
    await assertOnCallRoute(page, "after goBack");
    await expect(page.getByTestId("call-fullscreen")).toBeVisible();
    await assertNoChromeLeak(page, "after goBack");
  });
});
