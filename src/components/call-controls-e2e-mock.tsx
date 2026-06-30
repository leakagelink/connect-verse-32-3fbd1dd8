import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCallPointerSafeguard } from "@/hooks/use-call-pointer-safeguard";

// Standalone dry-run mock for the in-call control bar, used by the CI
// Playwright specs:
//   * tests/e2e/call-controls-clickable.spec.ts
//   * tests/e2e/call-controls-overlay-guard.spec.ts
//
// Contract:
//   1. After the call surface mounts, every control (End / Gift / Mic /
//      Speaker / Mystery) is reachable by a real pointer click.
//   2. If any blocking overlay (Vite error overlay, route error screen,
//      generic full-viewport scrim) mounts above the surface, the runtime
//      safeguard MUST neutralise its pointer events so the controls stay
//      tappable. The overlay itself stays visible for debugging — only its
//      pointer-events are killed.
//
// `injectOverlays` enables the second contract: it mounts representative
// fake versions of the overlays we have actually seen swallow taps in
// production / dev, so the spec can prove the safeguard handles them.
export function CallControlsClickableE2EMock({
  injectOverlays = false,
}: {
  injectOverlays?: boolean;
} = {}) {
  const [clicks, setClicks] = useState({
    end: 0,
    gift: 0,
    mic: 0,
    speaker: 0,
    mystery: 0,
  });
  const [openPanel, setOpenPanel] = useState<null | "gift" | "mystery">(null);

  // Activate the same runtime safeguard the real call surface uses.
  useCallPointerSafeguard(true);

  // For the overlay-guard spec, mount the fakes after first paint so the
  // MutationObserver inside the safeguard sees them and neutralises them.
  useEffect(() => {
    if (!injectOverlays || typeof document === "undefined") return;
    const made: HTMLElement[] = [];

    const fakes: Array<{ tag: string; attrs: Record<string, string>; label: string }> = [
      { tag: "vite-error-overlay", attrs: {}, label: "vite error overlay" },
      { tag: "div", attrs: { "data-vite-dev-id": "test" }, label: "vite dev id scrim" },
      {
        tag: "div",
        attrs: { "data-testid": "fake-route-error-screen" },
        label: "route error screen",
      },
      {
        tag: "div",
        attrs: { "data-testid": "fake-generic-scrim" },
        label: "unknown full-viewport scrim",
      },
    ];

    for (const f of fakes) {
      const el = document.createElement(f.tag);
      Object.entries(f.attrs).forEach(([k, v]) => el.setAttribute(k, v));
      // Match the real overlays' geometry: fixed, full viewport, above z-60.
      el.style.position = "fixed";
      el.style.inset = "0";
      el.style.zIndex = "9999";
      el.style.background = "rgba(255,0,0,0.15)";
      el.style.color = "white";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.textContent = `Fake ${f.label} (should be neutralised)`;
      document.body.appendChild(el);
      made.push(el);
    }

    return () => {
      made.forEach((el) => el.remove());
    };
  }, [injectOverlays]);

  const bump = (k: keyof typeof clicks) =>
    setClicks((c) => ({ ...c, [k]: c[k] + 1 }));

  return (
    <div
      data-testid="call-controls-surface"
      data-call-surface="1"
      data-e2e-ready="1"
      data-clicks-end={clicks.end}
      data-clicks-gift={clicks.gift}
      data-clicks-mic={clicks.mic}
      data-clicks-speaker={clicks.speaker}
      data-clicks-mystery={clicks.mystery}
      className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-end gap-4 p-6 safe-top safe-bottom"
    >
      <div className="flex-1 w-full flex items-center justify-center text-white/70 text-sm">
        Call connected — controls dry-run
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button
          data-testid="ctrl-mic"
          variant="secondary"
          onClick={() => bump("mic")}
        >
          Mic
        </Button>
        <Button
          data-testid="ctrl-speaker"
          variant="secondary"
          onClick={() => bump("speaker")}
        >
          Speaker
        </Button>
        <Button
          data-testid="ctrl-gift"
          variant="secondary"
          onClick={() => {
            bump("gift");
            setOpenPanel("gift");
          }}
        >
          Gift
        </Button>
        <Button
          data-testid="ctrl-mystery"
          variant="secondary"
          onClick={() => {
            bump("mystery");
            setOpenPanel("mystery");
          }}
        >
          Mystery
        </Button>
        <Button
          data-testid="ctrl-end"
          variant="destructive"
          onClick={() => bump("end")}
        >
          End
        </Button>
      </div>

      <Dialog
        open={openPanel !== null}
        onOpenChange={(v) => { if (!v) setOpenPanel(null); }}
      >
        <DialogContent data-testid={`panel-${openPanel ?? "none"}`}>
          <DialogHeader>
            <DialogTitle>
              {openPanel === "gift" ? "Send a gift" : "Mystery case"}
            </DialogTitle>
          </DialogHeader>
          <Button
            data-testid="panel-close"
            onClick={() => setOpenPanel(null)}
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
