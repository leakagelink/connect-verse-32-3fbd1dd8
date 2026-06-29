import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";

type StepRow = { step: string; ok: boolean; detail?: string };

/**
 * Drives an iframe into the call route in `?e2e=ui` dry-run mode and asserts
 * the fullscreen contract end-to-end:
 *
 *  1. The fullscreen container mounts and no AppShell chrome (bottom nav /
 *     top header / data-app-shell) bleeds through.
 *  2. Tapping End does NOT disconnect on the first click — a confirmation
 *     dialog (step 1) is shown.
 *  3. Tapping "End call" advances to a second confirmation (step 2) — still
 *     no disconnect, still no navigation away from /call/*.
 *  4. Tapping "Yes, disconnect now" (the third deliberate click) flips the
 *     surface into the ended state.
 *  5. "Stay on call" at any step closes the dialog without disconnecting.
 *  6. Throughout, the iframe's location stays on /call/voice/* — no other
 *     app screen can open while the call is mounted.
 */
export function CallFullscreenE2E() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [pass, setPass] = useState<boolean | null>(null);

  function push(row: StepRow) {
    setSteps((s) => [...s, row]);
  }

  async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 3000): Promise<T> {
    const t0 = Date.now();
    // Poll on rAF cadence so we yield to the iframe's render commits.
    return new Promise<T>((resolve, reject) => {
      const tick = () => {
        try {
          const v = fn();
          if (v) return resolve(v);
        } catch { /* ignore until timeout */ }
        if (Date.now() - t0 > timeoutMs) return reject(new Error("timeout"));
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function urlOf(doc: Document | undefined | null): string {
    try { return doc?.defaultView?.location?.pathname ?? "?"; } catch { return "?"; }
  }

  async function run() {
    setBusy(true);
    setSteps([]);
    setPass(null);

    const fail = (reason: string) => {
      push({ step: "ABORT", ok: false, detail: reason });
      setPass(false);
      toast.error(`Call Fullscreen E2E: FAIL — ${reason}`);
      setBusy(false);
    };

    try {
      const iframe = iframeRef.current;
      if (!iframe) return fail("iframe not mounted");

      // Use a real-looking userId placeholder; the dry-run branch ignores it.
      iframe.src = `/call/voice/00000000-0000-0000-0000-000000000001?e2e=ui`;

      // 1. Wait for fullscreen mount.
      const fs = await waitFor(() => {
        const doc = iframe.contentDocument;
        return doc?.querySelector<HTMLElement>('[data-testid="call-fullscreen"]') ?? null;
      }, 5000).catch(() => null);
      if (!fs) return fail("call-fullscreen never mounted");
      push({ step: "fullscreen mounted", ok: true, detail: urlOf(iframe.contentDocument) });

      const doc = iframe.contentDocument!;

      // 2. Assert no AppShell chrome.
      const chromeSelectors = [
        "[data-app-shell]",
        "[data-bottom-nav]",
        "header[role='banner']",
        "nav[aria-label='Bottom navigation']",
      ];
      const leaked = chromeSelectors.filter((sel) => doc.querySelector(sel));
      const noChrome = leaked.length === 0;
      push({
        step: "no AppShell chrome leaks",
        ok: noChrome,
        detail: noChrome ? "clean" : `leaked: ${leaked.join(", ")}`,
      });

      // 3. URL anchored to /call/*.
      const startPath = urlOf(doc);
      const onCall = startPath.startsWith("/call/");
      push({ step: "url on /call/*", ok: onCall, detail: startPath });

      // 4. Click End — dialog opens with step 1; not yet disconnected.
      const endBtn = doc.querySelector<HTMLElement>('[data-testid="end-call-btn"]');
      if (!endBtn) return fail("end-call-btn missing");
      endBtn.click();
      const step1 = await waitFor(
        () => doc.querySelector<HTMLElement>('[data-testid="end-confirm-step1"]'),
        2000,
      ).catch(() => null);
      push({ step: "click 1 → step-1 dialog shown", ok: !!step1 });
      const stillAlive1 = fs.getAttribute("data-e2e-ended") !== "1";
      push({ step: "no disconnect after click 1", ok: stillAlive1 });

      // 5. "Stay on call" cancels and resets.
      const stay = doc.querySelector<HTMLElement>('[data-testid="end-stay"]');
      stay?.click();
      await waitFor(
        () => (!doc.querySelector('[data-testid="end-confirm-step1"]') ? true : null),
        2000,
      ).catch(() => null);
      push({ step: "Stay on call closes dialog", ok: !doc.querySelector('[data-testid="end-confirm-step1"]') });
      push({ step: "no disconnect after Stay", ok: fs.getAttribute("data-e2e-ended") !== "1" });

      // 6. Click End again → step1 → step2 → still alive.
      doc.querySelector<HTMLElement>('[data-testid="end-call-btn"]')?.click();
      const s1 = await waitFor(
        () => doc.querySelector<HTMLElement>('[data-testid="end-confirm-step1"]'),
        2000,
      ).catch(() => null);
      if (!s1) return fail("step-1 dialog did not re-open");
      s1.click();
      const s2 = await waitFor(
        () => doc.querySelector<HTMLElement>('[data-testid="end-confirm-step2"]'),
        2000,
      ).catch(() => null);
      push({ step: "click 2 → step-2 dialog shown", ok: !!s2 });
      push({ step: "no disconnect after click 2", ok: fs.getAttribute("data-e2e-ended") !== "1" });
      if (!s2) return fail("step-2 button never appeared");

      // 7. URL must still be on /call/* (no navigation leak mid-confirmation).
      const midPath = urlOf(doc);
      push({ step: "url still /call/* mid-flow", ok: midPath.startsWith("/call/"), detail: midPath });

      // 8. Third click finally disconnects.
      s2.click();
      const ended = await waitFor(
        () => (fs.getAttribute("data-e2e-ended") === "1" ? true : null),
        2000,
      ).catch(() => null);
      push({ step: "click 3 → disconnected", ok: !!ended });

      const allOk = noChrome && onCall && !!step1 && stillAlive1 && !!s1 && !!s2 && !!ended &&
        midPath.startsWith("/call/");
      setPass(allOk);
      if (allOk) toast.success("Call Fullscreen E2E: PASS");
      else toast.error("Call Fullscreen E2E: FAIL — see steps");
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
            <PlayCircle className="size-4" /> Call Fullscreen + 3-Click End E2E
          </div>
          <div className="text-xs text-muted-foreground">
            Loads <code>/call/voice/&lt;id&gt;?e2e=ui</code> in an iframe and
            asserts no app chrome leaks, no navigation escapes the call, and
            disconnect requires three deliberate taps.
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
        title="call-fullscreen-e2e"
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
