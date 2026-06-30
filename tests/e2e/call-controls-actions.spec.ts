import { test, expect } from "@playwright/test";

// Verifies each control performs its real action after connect:
//   * Mic toggles muted state
//   * Speaker toggles speaker output
//   * Gift opens the gift modal
//   * Mystery opens the mystery game modal
//   * End ends the call (controls unmount, ended screen shows)

test.describe("call controls — real actions after connect", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/__e2e/call-controls");
    await expect(page.getByTestId("call-controls-surface")).toHaveAttribute(
      "data-e2e-ready",
      "1",
    );
  });

  test("mic toggles muted state", async ({ page }) => {
    const surface = page.getByTestId("call-controls-surface");
    await expect(surface).toHaveAttribute("data-muted", "0");
    await page.getByTestId("ctrl-mic").click();
    await expect(surface).toHaveAttribute("data-muted", "1");
    await expect(page.getByTestId("ctrl-mic")).toHaveText("Unmute");
    await page.getByTestId("ctrl-mic").click();
    await expect(surface).toHaveAttribute("data-muted", "0");
  });

  test("speaker toggles output state", async ({ page }) => {
    const surface = page.getByTestId("call-controls-surface");
    await expect(surface).toHaveAttribute("data-speaker", "off");
    await page.getByTestId("ctrl-speaker").click();
    await expect(surface).toHaveAttribute("data-speaker", "on");
    await expect(page.getByTestId("ctrl-speaker")).toHaveText("Speaker on");
    await page.getByTestId("ctrl-speaker").click();
    await expect(surface).toHaveAttribute("data-speaker", "off");
  });

  test("gift opens the gift modal", async ({ page }) => {
    await page.getByTestId("ctrl-gift").click();
    await expect(page.getByTestId("panel-gift")).toBeVisible();
    await expect(page.getByText("Send a gift")).toBeVisible();
    await page.getByTestId("panel-close").click();
    await expect(page.getByTestId("panel-gift")).toHaveCount(0);
  });

  test("mystery launches the mystery game modal", async ({ page }) => {
    await page.getByTestId("ctrl-mystery").click();
    await expect(page.getByTestId("panel-mystery")).toBeVisible();
    await expect(page.getByText("Mystery case")).toBeVisible();
    await page.getByTestId("panel-close").click();
    await expect(page.getByTestId("panel-mystery")).toHaveCount(0);
  });

  test("end ends the call and hides controls", async ({ page }) => {
    await page.getByTestId("ctrl-end").click();
    await expect(page.getByTestId("call-controls-surface")).toHaveCount(0);
    const ended = page.getByTestId("call-ended-screen");
    await expect(ended).toBeVisible();
    await expect(ended).toHaveAttribute("data-call-ended", "1");
  });

  test("all five actions execute in a single connected session", async ({ page }) => {
    const surface = page.getByTestId("call-controls-surface");

    await page.getByTestId("ctrl-mic").click();
    await expect(surface).toHaveAttribute("data-muted", "1");

    await page.getByTestId("ctrl-speaker").click();
    await expect(surface).toHaveAttribute("data-speaker", "on");

    await page.getByTestId("ctrl-gift").click();
    await expect(page.getByTestId("panel-gift")).toBeVisible();
    await page.getByTestId("panel-close").click();

    await page.getByTestId("ctrl-mystery").click();
    await expect(page.getByTestId("panel-mystery")).toBeVisible();
    await page.getByTestId("panel-close").click();

    await page.getByTestId("ctrl-end").click();
    await expect(page.getByTestId("call-ended-screen")).toBeVisible();
  });
});
