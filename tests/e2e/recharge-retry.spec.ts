import { expect, test } from "@playwright/test";

// Regression guard for the "browser closed early / return-sync failed"
// recovery UX on the recharge screen.
//
// Contract enforced by `src/lib/recharge-pending.ts` and consumed by
// `src/routes/_authenticated/recharge.tsx`:
//
//   * Starting an external checkout persists a PendingRecharge in
//     localStorage BEFORE the browser is opened, so a full app restart
//     still surfaces a "Resume payment" prompt with the right plan.
//   * "Resume payment" reuses the SAME purchaseId — the client-side
//     idempotency key that dedupes against the server-side order — so a
//     retry cannot mint a duplicate order.
//   * A deep link with `?plan=<id>&pp=<id>` (magic-link handoff from the
//     Android app) seeds the pending record with the caller's purchaseId
//     BEFORE the auto-buy runs, so any subsequent retry reuses that key.
//   * Dismiss clears the pending record.
//   * Stale pending records (> 30 min) are swept on read.
//
// Driven via the unauthenticated `/__e2e/recharge-retry` mock so this
// spec runs in CI with no backend session.
const ROUTE = "/__e2e/recharge-retry";
const PENDING_KEY = "talkora.recharge.pending";

test.describe("Recharge retry + deep-link contract", () => {
  test("persists pending after buy so retry banner survives reload", async ({ page }) => {
    await page.goto(ROUTE);
    await expect(page.getByTestId("recharge-retry-mock")).toBeVisible();
    await expect(page.getByTestId("retry-banner")).toHaveCount(0);

    await page.getByTestId("buy-pro").click();
    const banner = page.getByTestId("retry-banner");
    await expect(banner, "retry banner should appear after starting checkout").toBeVisible();
    await expect(banner).toHaveAttribute("data-plan-id", "pro");
    await expect(page.getByTestId("retry-banner-label")).toContainText("Pro pack");
    const firstPurchaseId = await banner.getAttribute("data-purchase-id");
    expect(firstPurchaseId, "purchaseId must be minted on buy").toBeTruthy();

    // Simulate the browser being closed early and the app relaunching:
    // full reload with no return-sync signal. The banner MUST re-hydrate
    // from localStorage with the same plan and purchaseId.
    await page.reload();
    await expect(page.getByTestId("retry-banner")).toBeVisible();
    await expect(page.getByTestId("retry-banner")).toHaveAttribute("data-plan-id", "pro");
    await expect(page.getByTestId("retry-banner")).toHaveAttribute(
      "data-purchase-id",
      firstPurchaseId!,
    );
  });

  test("resume reuses the same purchaseId (idempotency key)", async ({ page }) => {
    await page.goto(ROUTE);
    await page.getByTestId("buy-starter").click();
    const original = await page
      .getByTestId("retry-banner")
      .getAttribute("data-purchase-id");
    expect(original).toBeTruthy();

    await page.getByTestId("retry-resume").click();
    // A retry for the SAME plan must NOT mint a new key — the server
    // relies on this to dedupe against the existing Razorpay order.
    await expect(page.getByTestId("last-buy")).toHaveAttribute(
      "data-purchase-id",
      original!,
    );
    await expect(page.getByTestId("retry-banner")).toHaveAttribute(
      "data-purchase-id",
      original!,
    );
  });

  test("dismiss clears the pending record", async ({ page }) => {
    await page.goto(ROUTE);
    await page.getByTestId("buy-mega").click();
    await expect(page.getByTestId("retry-banner")).toBeVisible();

    await page.getByTestId("retry-dismiss").click();
    await expect(page.getByTestId("retry-banner")).toHaveCount(0);

    const stored = await page.evaluate((k) => window.localStorage.getItem(k), PENDING_KEY);
    expect(stored, "dismiss must wipe the pending record").toBeNull();

    await page.reload();
    await expect(page.getByTestId("retry-banner")).toHaveCount(0);
  });

  test("deep link seeds pending with caller's purchaseId before auto-buy", async ({ page }) => {
    const pp = "pp_deeplink_abcdef1234";
    await page.goto(`${ROUTE}?plan=pro&pp=${pp}`);
    await expect(page.getByTestId("auto-buy-ran")).toHaveText("yes");

    // The auto-buy MUST reuse the caller-supplied purchaseId — otherwise
    // the website side of the magic-link handoff would create a second
    // order and break server-side idempotency.
    await expect(page.getByTestId("last-buy")).toHaveAttribute("data-purchase-id", pp);
    await expect(page.getByTestId("retry-banner")).toHaveAttribute("data-purchase-id", pp);
    await expect(page.getByTestId("retry-banner")).toHaveAttribute("data-plan-id", "pro");
  });

  test("stale pending records (> 30 min) are swept on read", async ({ page }) => {
    await page.goto(ROUTE);
    // Seed an expired record directly; reload to force a fresh read.
    await page.evaluate((k) => {
      const stale = {
        planId: "starter",
        planLabel: "Starter pack",
        startedAt: Date.now() - 31 * 60_000,
        purchaseId: "pp_stale",
      };
      window.localStorage.setItem(k, JSON.stringify(stale));
    }, PENDING_KEY);

    await page.reload();
    await expect(page.getByTestId("retry-banner")).toHaveCount(0);
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), PENDING_KEY);
    expect(stored, "stale record must be swept on read").toBeNull();
  });
});
