import { expect, test, type Page } from "@playwright/test";

// CI guard for the runtime pointer safeguard.
//
// Contract: while the call surface is mounted, NO blocking overlay or
// call-route error screen may ever capture pointer events above the call
// controls. The dry-run route `/__e2e/call-controls?overlays=1` mounts the
// real safeguard hook *and* injects representative fakes of every overlay
// we have seen swallow taps in the wild (Vite error overlay, vite dev id
// scrim, route error screen, unknown full-viewport scrim). The spec then
// asserts each of the five call controls — End, Gift, Mic, Speaker,
// Mystery — still receives clicks through those overlays.
const ROUTE = "/__e2e/call-controls?overlays=1";

const CONTROLS = [
  { testId: "ctrl-end", attr: "data-clicks-end", label: "End" },
  { testId: "ctrl-gift", attr: "data-clicks-gift", label: "Gift" },
  { testId: "ctrl-mic", attr: "data-clicks-mic", label: "Mic" },
  { testId: "ctrl-speaker", attr: "data-clicks-speaker", label: "Speaker" },
  { testId: "ctrl-mystery", attr: "data-clicks-mystery", label: "Mystery" },
] as const;

const INJECTED_OVERLAYS = [
  "vite-error-overlay",
  "[data-vite-dev-id]",
  "[data-testid='fake-route-error-screen']",
  "[data-testid='fake-generic-scrim']",
] as const;

async function assertOverlayNeutralised(page: Page, sel: string, label: string) {
  const handle = await page.locator(sel).first().elementHandle();
  expect(handle, `${label} (${sel}) was never injected`).not.toBeNull();
  const pointerEvents = await page.evaluate(
    (el) => window.getComputedStyle(el as Element).pointerEvents,
    handle,
  );
  expect(
    pointerEvents,
    `${label} (${sel}) is still capturing pointer events — safeguard failed`,
  ).toBe("none");
}

async function assertControlHitsItself(page: Page, testId: string, label: string) {
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

test.describe("Call controls overlay guard", () => {
  test("no injected overlay captures pointer events above the five call controls", async ({ page }) => {
    await page.goto(ROUTE);

    const surface = page.getByTestId("call-controls-surface");
    await expect(surface, "call-controls surface never mounted").toBeVisible();
    await expect(surface).toHaveAttribute("data-e2e-ready", "1");

    // The safeguard runs a MutationObserver — give it a microtask to run.
    await page.waitForFunction(() => {
      const el = document.querySelector("vite-error-overlay") as HTMLElement | null;
      if (!el) return false;
      return getComputedStyle(el).pointerEvents === "none";
    });

    // Every injected overlay must be present (visible for debugging) AND
    // neutralised (cannot capture clicks).
    for (const sel of INJECTED_OVERLAYS) {
      await assertOverlayNeutralised(page, sel, `injected overlay ${sel}`);
    }

    // With the overlays in the DOM, every control's centre must still hit
    // itself, and a real click must reach the handler.
    for (const ctrl of CONTROLS) {
      await assertControlHitsItself(page, ctrl.testId, `before ${ctrl.label}`);

      await expect(surface).toHaveAttribute(ctrl.attr, "0");
      await page.getByTestId(ctrl.testId).click();
      await expect(
        surface,
        `${ctrl.label} click swallowed by an overlay — safeguard failed`,
      ).toHaveAttribute(ctrl.attr, "1");

      const closer = page.getByTestId("panel-close");
      if (await closer.count()) {
        await closer.click();
        await expect(closer).toHaveCount(0);
      }
    }

    // Re-assert overlays are still present after the click pass — the
    // safeguard must neutralise, not remove, so debuggers still see them.
    for (const sel of INJECTED_OVERLAYS) {
      await assertOverlayNeutralised(page, sel, `post-click overlay ${sel}`);
    }
  });
});
