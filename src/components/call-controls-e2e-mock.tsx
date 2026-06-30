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
//   * tests/e2e/call-controls-actions.spec.ts
//
// Each control mirrors the real call-screen contract:
//   * Mic     → toggles `data-muted` between "0" and "1"
//   * Speaker → toggles `data-speaker` between "off" and "on"
//   * Gift    → opens the Gift modal (Dialog with data-testid="panel-gift")
//   * Mystery → opens the Mystery modal (Dialog with data-testid="panel-mystery")
//   * End     → ends the call: sets `data-ended="1"` and hides the controls
//
// The mock also exposes per-button click counters (`data-clicks-*`) so the
// clickability spec can assert clicks reach the handler. Real-action state
// is observable via the `data-muted`, `data-speaker`, and `data-ended`
// attributes.
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
    sos: 0,
    giftSend: 0,
  });
  const [openPanel, setOpenPanel] = useState<null | "gift" | "mystery" | "sos">(null);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [ended, setEnded] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [giftBoxOpen, setGiftBoxOpen] = useState(false);

  // Activate the same runtime safeguard the real call surface uses.
  useCallPointerSafeguard(!ended);

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

  if (ended) {
    return (
      <div
        data-testid="call-ended-screen"
        data-call-ended="1"
        className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-center text-white"
      >
        Call ended
      </div>
    );
  }

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
      data-clicks-sos={clicks.sos}
      data-clicks-gift-send={clicks.giftSend}
      data-muted={muted ? "1" : "0"}
      data-speaker={speakerOn ? "on" : "off"}
      data-ended={ended ? "1" : "0"}
      data-end-confirm-open={endConfirmOpen ? "1" : "0"}
      data-gift-box-open={giftBoxOpen ? "1" : "0"}
      className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-end gap-4 p-6 safe-top safe-bottom"
    >
      <div className="flex-1 w-full flex items-center justify-center text-white/70 text-sm">
        Call connected — controls dry-run
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button
          data-testid="ctrl-mic"
          aria-pressed={muted}
          variant="secondary"
          onClick={() => {
            bump("mic");
            setMuted((v) => !v);
          }}
        >
          {muted ? "Unmute" : "Mute"}
        </Button>
        <Button
          data-testid="ctrl-speaker"
          aria-pressed={speakerOn}
          variant="secondary"
          onClick={() => {
            bump("speaker");
            setSpeakerOn((v) => !v);
          }}
        >
          {speakerOn ? "Speaker on" : "Speaker off"}
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
          onClick={() => {
            bump("end");
            setEnded(true);
          }}
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
