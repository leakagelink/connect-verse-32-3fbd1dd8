import { expect, test, type Page } from "@playwright/test";

// CI guard: after the call surface mounts ("connects"), every in-call
// control — End, Gift, Mic, Speaker, Mystery — MUST remain clickable. The
// historical bug this protects against: a Vite error overlay (or any other
// fixed-position scrim with a high z-index) silently swallowed every tap on
// the call screen, leaving the user trapped in a connected call with no
// working controls.
//
// The spec asserts two things per control:
//   1. The control's bounding-box centre actually hits the control itself
//      (no overlay element is on top intercepting the click).
//   2. A real `.click()` reaches the handler, observable via the per-button
//      click counter mirrored into `data-clicks-*` on the surface.
const ROUTE = "/__e2e/call-controls";

const CONTROLS = [
  { testId: "ctrl-end", attr: "data-clicks-end", label: "End" },
  { testId: "ctrl-gift", attr: "data-clicks-gift", label: "Gift" },
  { testId: "ctrl-mic", attr: "data-clicks-mic", label: "Mic" },
  { testId: "ctrl-speaker", attr: "data-clicks-speaker", label: "Speaker" },
  { testId: "ctrl-mystery", attr: "data-clicks-mystery", label: "Mystery" },
] as const;

const BLOCKING_OVERLAYS = [
  "vite-error-overlay",
  "[data-vite-dev-id]",
  "#vite-plugin-checker-error-overlay",
  "[data-testid='global-loading-overlay']",
];

async function assertNoBlockingOverlay(page: Page, label: string) {
  for (const sel of BLOCKING_OVERLAYS) {
    const count = await page.locator(sel).count();
    expect(count, `blocking overlay (${sel}) present at "${label}"`).toBe(0);
  }
}

async function assertHitsItself(page: Page, testId: string, label: string) {
  const handle = await page.getByTestId(testId).elementHandle();
  expect(handle, `${testId} not in DOM at "${label}"`).not.toBeNull();
  const result = await page.evaluate((el) => {
    const node = el as HTMLElement;
    const r = node.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      hit: !!top && (top === node || node.contains(top)),
      topTag: top?.tagName ?? null,
      topId: top?.id ?? null,
      topClass: (top as HTMLElement | null)?.className ?? null,
    };
  }, handle);
  expect(
    result.hit,
    `${testId} blocked by overlay at "${label}" (top=${result.topTag}#${result.topId}.${result.topClass})`,
  ).toBe(true);
}

test.describe("Call controls remain clickable after connect", () => {
  test("End/Gift/Mic/Speaker/Mystery are all reachable with no overlay interception", async ({ page }) => {
    await page.goto(ROUTE);

    const surface = page.getByTestId("call-controls-surface");
    await expect(surface, "call-controls surface never mounted").toBeVisible();
    await expect(surface).toHaveAttribute("data-e2e-ready", "1");

    await assertNoBlockingOverlay(page, "initial mount");

    for (const ctrl of CONTROLS) {
      // The Mic / Speaker / End buttons live on the bare control bar. Gift
      // and Mystery open a panel — we close it after each click so the next
      // button is not blocked by a lingering modal scrim.
      await assertNoBlockingOverlay(page, `before ${ctrl.label}`);
      await assertHitsItself(page, ctrl.testId, `before ${ctrl.label}`);

      await expect(surface).toHaveAttribute(ctrl.attr, "0");
      await page.getByTestId(ctrl.testId).click();
      await expect(
        surface,
        `${ctrl.label} click never reached the handler — overlay likely swallowed it`,
      ).toHaveAttribute(ctrl.attr, "1");

      // Dismiss the Gift / Mystery panel before moving on.
      const closer = page.getByTestId("panel-close");
      if (await closer.count()) {
        await closer.click();
        await expect(closer).toHaveCount(0);
      }
    }

    // Final pass: click every control a second time to prove the surface
    // is still interactive end-to-end, not just on the first tap.
    for (const ctrl of CONTROLS) {
      await page.getByTestId(ctrl.testId).click();
      await expect(surface).toHaveAttribute(ctrl.attr, "2");
      const closer = page.getByTestId("panel-close");
      if (await closer.count()) await closer.click();
    }

    await assertNoBlockingOverlay(page, "after full pass");
  });
});
