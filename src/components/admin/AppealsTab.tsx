import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminListAppeals, adminReviewAppeal } from "@/lib/appeals.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Gavel, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const statusColor: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  approved: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
};

export function AppealsTab() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [active, setActive] = useState<any | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [notes, setNotes] = useState("");
  const [unban, setUnban] = useState(true);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const listFn = useServerFn(adminListAppeals);
  const reviewFn = useServerFn(adminReviewAppeal);

  const q = useQuery({
    queryKey: ["admin-appeals", status],
    queryFn: () => listFn({ data: { status, limit: 100 } }),
  });

  function openReview(a: any) {
    setActive(a);
    setDecision("approved");
    setNotes("");
    setUnban(a.is_banned);
  }

  async function submit() {
    if (!active) return;
    setBusy(true);
    try {
      const res = await reviewFn({
        data: {
          appealId: active.id,
          decision,
          notes: notes.trim() || null,
          unban: decision === "approved" && unban,
        },
      });
      toast.success(res.unbanned ? "Appeal approved & user unbanned" : "Appeal recorded");
      setActive(null);
      qc.invalidateQueries({ queryKey: ["admin-appeals"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  const rows = q.data ?? [];

  return (
    <div className="space-y-3">
      <Card className="glass p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Gavel className="size-4 text-primary" />
          <div className="text-sm font-medium">Ban / report appeals</div>
          <div className="ml-auto flex items-center gap-2">
            <Select value={status} onValueChange={(v) => setStatus(v as any)}>
              <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`size-3.5 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {q.isLoading ? (
        <Card className="glass p-4 text-sm text-muted-foreground">Loading…</Card>
      ) : rows.length === 0 ? (
        <Card className="glass p-4 text-sm text-muted-foreground">No appeals in this view.</Card>
      ) : (
        <div className="space-y-2">
          {rows.map((a: any) => (
            <Card key={a.id} className="glass p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className={statusColor[a.status]}>{a.status}</Badge>
                <span className="font-medium">{a.username ?? a.user_id.slice(0, 8)}</span>
                {a.is_banned && <Badge variant="outline" className="bg-destructive/10 text-destructive">Currently banned</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {format(new Date(a.created_at), "dd MMM, HH:mm")}
                </span>
              </div>
              {a.ban_reason && (
                <div className="mt-1 text-xs text-muted-foreground">Ban reason: {a.ban_reason}</div>
              )}
              <div className="mt-2 text-xs whitespace-pre-wrap break-words">{a.message}</div>
              {a.admin_notes && (
                <div className="mt-2 rounded bg-muted/40 p-2 text-xs">
                  <span className="font-medium">Reviewer notes: </span>{a.admin_notes}
                </div>
              )}
              {a.status === "pending" ? (
                <div className="mt-3 flex justify-end">
                  <Button size="sm" onClick={() => openReview(a)}>Review</Button>
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  Reviewed {a.reviewed_at ? format(new Date(a.reviewed_at), "dd MMM, HH:mm") : "—"}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review appeal</DialogTitle>
          </DialogHeader>
          {active && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                From <span className="font-medium">{active.username ?? active.user_id.slice(0, 8)}</span>
                {active.ban_reason && <> · Ban reason: {active.ban_reason}</>}
              </div>
              <div className="rounded-md border border-border p-2 text-xs whitespace-pre-wrap max-h-40 overflow-auto">
                {active.message}
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={decision === "approved" ? "default" : "outline"}
                  onClick={() => setDecision("approved")}
                  className="flex-1 gap-1"
                >
                  <CheckCircle2 className="size-4" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant={decision === "rejected" ? "destructive" : "outline"}
                  onClick={() => setDecision("rejected")}
                  className="flex-1 gap-1"
                >
                  <XCircle className="size-4" /> Reject
                </Button>
              </div>

              {decision === "approved" && active.is_banned && (
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={unban} onCheckedChange={(v) => setUnban(!!v)} />
                  Lift the ban and restore this account
                </label>
              )}

              <Textarea
                placeholder="Notes for the user (shown to them, optional, max 1000 chars)"
                maxLength={1000}
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Saving…" : `Confirm ${decision}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
