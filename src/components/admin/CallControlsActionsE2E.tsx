import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";

type StepRow = { step: string; ok: boolean; detail?: string };

/**
 * Drives the `/__e2e/call-controls` mock route in an iframe and asserts the
 * in-call action contract end-to-end:
 *
 *   1. Tapping "Gift" opens the Gift sheet (panel-gift visible).
 *   2. Tapping "Send" inside the sheet opens the gift box (gift-box visible,
 *      data-gift-box-open="1").
 *   3. Tapping "Mute" flips data-muted between "0" and "1".
 *   4. Tapping "Speaker" flips data-speaker between "off" and "on".
 *   5. Tapping "SOS" opens the SOS panel (panel-sos visible) and the
 *      sos-confirm button is reachable.
 *   6. Tapping "End" opens the end-call confirmation
 *      (panel-end-confirm visible) WITHOUT ending the call on the first tap.
 */
export function CallControlsActionsE2E() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [pass, setPass] = useState<boolean | null>(null);

  function push(row: StepRow) {
    setSteps((s) => [...s, row]);
  }

  async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 3000): Promise<T> {
    const t0 = Date.now();
    return new Promise<T>((resolve, reject) => {
      const tick = () => {
        try {
          const v = fn();
          if (v) return resolve(v);
        } catch { /* ignore */ }
        if (Date.now() - t0 > timeoutMs) return reject(new Error("timeout"));
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function findInDoc<T extends HTMLElement>(doc: Document, selector: string): T | null {
    // Radix portals render into document.body, which on the mock route is the
    // iframe's own body — so a single querySelector on the iframe document
    // covers both the in-tree controls and the portalled dialog content.
    return doc.querySelector<T>(selector);
  }

  async function run() {
    setBusy(true);
    setSteps([]);
    setPass(null);

    const fail = (reason: string) => {
      push({ step: "ABORT", ok: false, detail: reason });
      setPass(false);
      toast.error(`Call Controls Actions E2E: FAIL — ${reason}`);
      setBusy(false);
    };

    try {
      const iframe = iframeRef.current;
      if (!iframe) return fail("iframe not mounted");

      iframe.src = `/__e2e/call-controls`;

      const surface = await waitFor(() => {
        const doc = iframe.contentDocument;
        return doc?.querySelector<HTMLElement>('[data-testid="call-controls-surface"][data-e2e-ready="1"]') ?? null;
      }, 6000).catch(() => null);
      if (!surface) return fail("call-controls-surface never mounted");
      push({ step: "controls surface mounted", ok: true });

      const doc = iframe.contentDocument!;

      // --- Gift: sheet opens, then Send opens the gift box ---
      const giftBtn = findInDoc<HTMLElement>(doc, '[data-testid="ctrl-gift"]');
      if (!giftBtn) return fail("ctrl-gift missing");
      giftBtn.click();
      const giftPanel = await waitFor(
        () => findInDoc<HTMLElement>(doc, '[data-testid="panel-gift"]'),
        2000,
      ).catch(() => null);
      push({ step: "Gift sheet opens after tap", ok: !!giftPanel });
      if (!giftPanel) return fail("panel-gift never appeared");

      const giftSend = findInDoc<HTMLElement>(doc, '[data-testid="gift-send-btn"]');
      if (!giftSend) return fail("gift-send-btn missing");
      giftSend.click();
      const giftBox = await waitFor(
        () => findInDoc<HTMLElement>(doc, '[data-testid="gift-box"]'),
        2000,
      ).catch(() => null);
      const giftBoxFlag = surface.getAttribute("data-gift-box-open") === "1";
      push({
        step: "Send opens gift box",
        ok: !!giftBox && giftBoxFlag,
        detail: `data-gift-box-open=${surface.getAttribute("data-gift-box-open")}`,
      });

      // Close gift panel before testing other controls.
      findInDoc<HTMLElement>(doc, '[data-testid="panel-close"]')?.click();
      await waitFor(
        () => (!findInDoc(doc, '[data-testid="panel-gift"]') ? true : null),
        2000,
      ).catch(() => null);

      // --- Mute: clickable, flips data-muted ---
      const micBtn = findInDoc<HTMLElement>(doc, '[data-testid="ctrl-mic"]');
      if (!micBtn) return fail("ctrl-mic missing");
      const mutedBefore = surface.getAttribute("data-muted");
      micBtn.click();
      const muteFlipped = await waitFor(
        () => (surface.getAttribute("data-muted") !== mutedBefore ? true : null),
        1500,
      ).catch(() => null);
      push({
        step: "Mute is clickable (data-muted flips)",
        ok: !!muteFlipped,
        detail: `${mutedBefore} → ${surface.getAttribute("data-muted")}`,
      });

      // --- Speaker: clickable, flips data-speaker ---
      const spkBtn = findInDoc<HTMLElement>(doc, '[data-testid="ctrl-speaker"]');
      if (!spkBtn) return fail("ctrl-speaker missing");
      const spkBefore = surface.getAttribute("data-speaker");
      spkBtn.click();
      const spkFlipped = await waitFor(
        () => (surface.getAttribute("data-speaker") !== spkBefore ? true : null),
        1500,
      ).catch(() => null);
      push({
        step: "Speaker toggle is clickable (data-speaker flips)",
        ok: !!spkFlipped,
        detail: `${spkBefore} → ${surface.getAttribute("data-speaker")}`,
      });

      // --- SOS: opens panel-sos and the confirm button is reachable ---
      const sosBtn = findInDoc<HTMLElement>(doc, '[data-testid="ctrl-sos"]');
      if (!sosBtn) return fail("ctrl-sos missing");
      sosBtn.click();
      const sosPanel = await waitFor(
        () => findInDoc<HTMLElement>(doc, '[data-testid="panel-sos"]'),
        2000,
      ).catch(() => null);
      const sosConfirm = sosPanel
        ? findInDoc<HTMLElement>(doc, '[data-testid="sos-confirm"]')
        : null;
      push({
        step: "SOS is clickable (panel + confirm reachable)",
        ok: !!sosPanel && !!sosConfirm,
      });
      findInDoc<HTMLElement>(doc, '[data-testid="panel-close"]')?.click();
      await waitFor(
        () => (!findInDoc(doc, '[data-testid="panel-sos"]') ? true : null),
        2000,
      ).catch(() => null);

      // --- End call: confirm dialog shows on first tap, call not yet ended ---
      const endBtn = findInDoc<HTMLElement>(doc, '[data-testid="ctrl-end"]');
      if (!endBtn) return fail("ctrl-end missing");
      endBtn.click();
      const endConfirm = await waitFor(
        () => findInDoc<HTMLElement>(doc, '[data-testid="panel-end-confirm"]'),
        2000,
      ).catch(() => null);
      const endedAfterFirst = surface.getAttribute("data-ended") === "1";
      const endYes = endConfirm
        ? findInDoc<HTMLElement>(doc, '[data-testid="end-confirm-yes"]')
        : null;
      push({
        step: "End-call confirm dialog opens (not yet ended)",
        ok: !!endConfirm && !endedAfterFirst && !!endYes,
        detail: `data-ended=${surface.getAttribute("data-ended")}`,
      });

      const allOk = steps.every((s) => s.ok) &&
        !!giftPanel && !!giftBox && giftBoxFlag &&
        !!muteFlipped && !!spkFlipped &&
        !!sosPanel && !!sosConfirm &&
        !!endConfirm && !endedAfterFirst && !!endYes;

      setPass(allOk);
      if (allOk) toast.success("Call Controls Actions E2E: PASS");
      else toast.error("Call Controls Actions E2E: FAIL — see steps");
    } catch (e: any) {
      fail(e?.message ?? String(e));
      return;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="glass p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <PlayCircle className="size-4" /> Call Controls Actions E2E
          </div>
          <div className="text-xs text-muted-foreground">
            Loads <code>/__e2e/call-controls</code> in an iframe and asserts
            Gift sheet → Send opens the gift box, plus Mute, Speaker, SOS, and
            End-call confirm remain clickable mid-call.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pass != null && (
            <Badge variant={pass ? "default" : "destructive"}>
              {pass ? (
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="size-3" /> PASS
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <XCircle className="size-3" /> FAIL
                </span>
              )}
            </Badge>
          )}
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Run E2E"}
          </Button>
        </div>
      </div>

      <iframe
        ref={iframeRef}
        title="call-controls-actions-e2e"
        className="w-full h-72 rounded-md border bg-black"
      />

      {steps.length > 0 && (
        <div className="border rounded p-2 space-y-1 max-h-72 overflow-auto bg-muted/30 text-xs">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              {s.ok ? (
                <CheckCircle2 className="size-3 text-green-500 mt-0.5" />
              ) : (
                <XCircle className="size-3 text-destructive mt-0.5" />
              )}
              <div className="flex-1">
                <div className="font-mono">{s.step}</div>
                {s.detail && (
                  <div className="text-[10px] text-muted-foreground break-all">{s.detail}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
