import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerFn } from "@tanstack/react-start";
import { submitReport } from "@/lib/reports.functions";
import { toast } from "sonner";
import { Flag } from "lucide-react";

const REASONS = [
  { value: "harassment", label: "Harassment" },
  { value: "nudity", label: "Nudity / sexual content" },
  { value: "fake_profile", label: "Fake profile" },
  { value: "spam", label: "Spam" },
  { value: "threat", label: "Threat / violence" },
  { value: "scam", label: "Scam" },
  { value: "underage", label: "Underage user (under 18)" },
  { value: "child_safety", label: "Child safety / child endangerment" },
  { value: "other", label: "Other" },
] as const;

export function ReportDialog({ targetUserId, conversationId, trigger }: {
  targetUserId: string;
  conversationId?: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const report = useServerFn(submitReport);

  async function send() {
    if (!reason) return toast.error("Select a reason");
    setBusy(true);
    try {
      await report({ data: { targetUserId, reason: reason as any, context: note || undefined, conversationId } });
      toast.success("Report submitted. Our team will review it.");
      setOpen(false); setReason(""); setNote("");
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="ghost" size="sm"><Flag className="size-4 mr-1" /> Report</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Report user</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger><SelectValue placeholder="Choose a reason" /></SelectTrigger>
            <SelectContent>
              {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Textarea placeholder="Add details (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          <p className="text-xs text-muted-foreground">False reports may result in action on your own account. Our team reviews every report.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={send} disabled={busy}>Submit report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
