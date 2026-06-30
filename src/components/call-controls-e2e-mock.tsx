import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Standalone dry-run mock for the in-call control bar, used exclusively by
// `tests/e2e/call-controls-clickable.spec.ts`. The contract this mock
// guarantees: after the call surface mounts, every control (End, Gift, Mic,
// Speaker, Mystery) is reachable by a real pointer click — no transparent
// overlay, error boundary, or modal scrim is allowed to intercept the click
// while the call is connected.
//
// Each control increments a counter that is mirrored into a `data-clicks`
// attribute on the surface, so the spec can assert the click reached the
// handler instead of being swallowed by an overlay.
export function CallControlsClickableE2EMock() {
  const [clicks, setClicks] = useState({
    end: 0,
    gift: 0,
    mic: 0,
    speaker: 0,
    mystery: 0,
  });
  const [openPanel, setOpenPanel] = useState<null | "gift" | "mystery">(null);
  const bump = (k: keyof typeof clicks) =>
    setClicks((c) => ({ ...c, [k]: c[k] + 1 }));

  return (
    <div
      data-testid="call-controls-surface"
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

      {/* Panels open from Gift / Mystery taps — they must be dismissible so
          the subsequent control click is not blocked by a lingering scrim. */}
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
