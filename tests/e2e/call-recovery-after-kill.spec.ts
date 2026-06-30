import { test, expect } from "@playwright/test";

// Regression: when both caller and creator force-close their apps
// mid-connect, the next call between the same pair must reach the
// `connected` state and all five call controls must work.
//
// Pre-fix behaviour: stale "accepted" invite + orphan call_log
// (ended_at = NULL) blocked round-2 with a permanent BUSY error and
// the controls never mounted. The fix in src/lib/call-invites.functions.ts
// (refreshStaleBusy + unconditional pre-flight reconciliation) is
// modelled by the mock at /__e2e/call-recovery.

test.describe("call recovery after force-kill mid-connect", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/__e2e/call-recovery");
    await expect(page.getByTestId("call-recovery-root")).toBeVisible();
  });

  test("round 2 reaches connected after both apps force-close", async ({ page }) => {
    const root = page.getByTestId("call-recovery-root");

    // Round 1: connect.
    await page.getByTestId("btn-round1").click();
    await expect(root).toHaveAttribute("data-phase", "round1-connected");
    await expect(root).toHaveAttribute("data-invites-accepted", "1");
    await expect(root).toHaveAttribute("data-logs-open", "1");

    // Both apps die mid-call: no end RPC, no heartbeat, no cancel.
    // Server retains an orphan accepted invite + open call_log.
    await page.getByTestId("btn-force-close").click();
    await expect(root).toHaveAttribute("data-phase", "killed");
    await expect(root).toHaveAttribute("data-invites-accepted", "1");
    await expect(root).toHaveAttribute("data-logs-open", "1");

    // Round 2: same caller calls same creator. Pre-flight reconciler
    // must close the orphan rows so the new invite goes through.
    await page.getByTestId("btn-round2").click();
    await expect(root).toHaveAttribute("data-round2-error", "");
    await expect(root).toHaveAttribute("data-phase", "round2-connected");

    // After reconciliation, exactly one accepted invite (the new one)
    // and one open call_log (the new one) — the orphans are closed.
    await expect(root).toHaveAttribute("data-invites-accepted", "1");
    await expect(root).toHaveAttribute("data-logs-open", "1");
  });

  test("all five call controls work in the recovered round-2 session", async ({ page }) => {
    await page.getByTestId("btn-round1").click();
    await page.getByTestId("btn-force-close").click();
    await page.getByTestId("btn-round2").click();
    await expect(page.getByTestId("call-recovery-root")).toHaveAttribute(
      "data-phase",
      "round2-connected",
    );

    const surface = page.getByTestId("call-controls-surface");
    await expect(surface).toHaveAttribute("data-e2e-ready", "1");

    // 1. Mic
    await page.getByTestId("ctrl-mic").click();
    await expect(surface).toHaveAttribute("data-muted", "1");

    // 2. Speaker
    await page.getByTestId("ctrl-speaker").click();
    await expect(surface).toHaveAttribute("data-speaker", "on");

    // 3. Gift
    await page.getByTestId("ctrl-gift").click();
    await expect(page.getByTestId("panel-gift")).toBeVisible();
    await page.getByTestId("panel-close").click();
    await expect(page.getByTestId("panel-gift")).toHaveCount(0);

    // 4. Mystery
    await page.getByTestId("ctrl-mystery").click();
    await expect(page.getByTestId("panel-mystery")).toBeVisible();
    await page.getByTestId("panel-close").click();
    await expect(page.getByTestId("panel-mystery")).toHaveCount(0);

    // 5. End
    await page.getByTestId("ctrl-end").click();
    await expect(page.getByTestId("call-ended-screen")).toBeVisible();
    await expect(surface).toHaveCount(0);
  });
});
