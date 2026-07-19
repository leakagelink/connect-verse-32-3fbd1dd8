import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitReport } from "@/lib/reports.functions";
import { logSosEvent } from "@/lib/sos.functions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Siren } from "lucide-react";
import { toast } from "sonner";

type SosReason = "harassment" | "nudity" | "threat" | "scam" | "underage" | "other";

const REASONS: { value: SosReason; label: string }[] = [
  { value: "harassment", label: "Harassment / abusive language" },
  { value: "nudity", label: "Nudity / sexual content" },
  { value: "threat", label: "Threat or violence" },
  { value: "scam", label: "Scam / asking for money / OTP" },
  { value: "underage", label: "Person appears underage" },
  { value: "other", label: "Other — I feel unsafe" },
];

/**
 * In-call SOS panic button.
 * Tap → confirm with a reason → auto-report partner → end call.
 * The parent owns the actual call-end side effect (it has stream refs,
 * billing flushes, navigation), passed in via onEndCall.
 */
export function SosButton({
  partnerUserId,
  callLogId,
  onEndCall,
  onTelemetry,
}: {
  partnerUserId: string;
  callLogId: string | null;
  onEndCall: () => void;
  onTelemetry?: (
    event:
      | { type: "opened" }
      | { type: "confirmed"; reason: SosReason; durationMs: number }
      | { type: "blocked"; reason: SosReason; error: string; durationMs: number },
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<SosReason>("harassment");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const reportFn = useServerFn(submitReport);
  const logSos = useServerFn(logSosEvent);

  async function logAudit(payload: Parameters<typeof logSos>[0]["data"]) {
    try { await logSos({ data: payload }); } catch { /* audit best-effort */ }
  }

  async function trigger() {
    setBusy(true);
    const startedAt = Date.now();
    try {
      await reportFn({
        data: {
          targetUserId: partnerUserId,
          reason,
          context: `[SOS triggered during call${callLogId ? ` ${callLogId.slice(0, 8)}` : ""}] ${note || ""}`.slice(0, 500),
        },
      });
      const durationMs = Date.now() - startedAt;
      toast.success("Report filed. Call ended. Our safety team will review within 24h.", { duration: 6000 });
      try { onTelemetry?.({ type: "confirmed", reason, durationMs }); } catch {}
      await logAudit({
        partnerUserId, callLogId, reason, note: note || null,
        outcome: "report_filed", durationMs,
      });
    } catch (e: any) {
      // even if report fails, still end the call — user safety first
      const errMsg = e?.message || String(e);
      const durationMs = Date.now() - startedAt;
      toast.error(errMsg || "Could not file report — call still ended.");
      try { onTelemetry?.({ type: "blocked", reason, error: errMsg, durationMs }); } catch {}
      await logAudit({
        partnerUserId, callLogId, reason, note: note || null,
        outcome: "report_failed", error: errMsg.slice(0, 500), durationMs,
      });
    } finally {
      setBusy(false);
      setOpen(false);
      onEndCall();
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => {
          setOpen(true);
          try { onTelemetry?.({ type: "opened" }); } catch {}
        }}
        aria-label="SOS — emergency end call"
        className="gap-1.5 font-bold animate-pulse"
      >
        <Siren className="size-4" /> SOS
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Siren className="size-5" /> Emergency — end call & report?
            </AlertDialogTitle>
            <AlertDialogDescription>
              We will immediately end this call and file a priority safety report against the other person. Our team reviews SOS reports within 24 hours.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">What happened?</label>
              <Select value={reason} onValueChange={(v) => setReason(v as SosReason)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="Optional — add a short detail (max 300 chars)"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2.5 text-[11px]">
              <strong>In immediate danger?</strong> Call <a className="underline font-bold" href="tel:112">112</a> (India emergency) or{" "}
              <a className="underline font-bold" href="tel:1091">1091</a> (Women helpline).
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={trigger}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Filing report…" : "End call & report"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
