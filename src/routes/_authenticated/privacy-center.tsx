import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileJson,
  ShieldCheck,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import {
  listMyPrivacyRequests,
  requestDataExport,
  getExportDownloadUrl,
  scheduleAccountDeletion,
  cancelDeletionRequest,
  type PrivacyRequest,
} from "@/lib/privacy.functions";
import { getMyProfile } from "@/lib/onboarding.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/privacy-center")({
  component: PrivacyCenter,
});

function statusBadge(status: PrivacyRequest["status"]) {
  const map: Record<PrivacyRequest["status"], { label: string; className: string; icon: any }> = {
    pending: { label: "Pending", className: "bg-amber-500/15 text-amber-600 border-amber-500/30", icon: Clock },
    processing: { label: "Processing", className: "bg-blue-500/15 text-blue-600 border-blue-500/30", icon: Loader2 },
    ready: { label: "Ready", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", icon: CheckCircle2 },
    completed: { label: "Completed", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", icon: CheckCircle2 },
    cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground border-border", icon: XCircle },
    failed: { label: "Failed", className: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  };
  const cfg = map[status];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`${cfg.className} gap-1`}>
      <Icon className={`size-3 ${status === "processing" ? "animate-spin" : ""}`} />
      {cfg.label}
    </Badge>
  );
}

function formatBytes(n: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function daysUntil(iso: string | null) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
  return days;
}

function PrivacyCenter() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profileFn = useServerFn(getMyProfile);
  const listFn = useServerFn(listMyPrivacyRequests);
  const exportFn = useServerFn(requestDataExport);
  const urlFn = useServerFn(getExportDownloadUrl);
  const scheduleFn = useServerFn(scheduleAccountDeletion);
  const cancelFn = useServerFn(cancelDeletionRequest);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });
  const { data: requests = [] } = useQuery({
    queryKey: ["privacy", "requests"],
    queryFn: () => listFn(),
    refetchInterval: 15_000,
  });

  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");

  const activeDeletion = requests.find(
    (r) => r.kind === "deletion" && (r.status === "pending" || r.status === "processing"),
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["privacy", "requests"] });

  const exportMut = useMutation({
    mutationFn: () => exportFn(),
    onSuccess: async () => {
      toast.success("Your data export is ready to download.");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not prepare your data"),
  });

  const scheduleMut = useMutation({
    mutationFn: () => scheduleFn({ data: { confirm: "DELETE" as const, reason: reason || undefined } }),
    onSuccess: () => {
      toast.success("Deletion scheduled. You can cancel any time before the grace period ends.");
      setConfirm("");
      setReason("");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not schedule deletion"),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { requestId: id } }),
    onSuccess: () => {
      toast.success("Deletion request cancelled.");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not cancel"),
  });

  async function downloadReady(req: PrivacyRequest) {
    try {
      const { url } = await urlFn({ data: { requestId: req.id } });
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.download = `talkora-data-${req.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not fetch download link");
    }
  }

  return (
    <AppShell isAdmin={me?.isAdmin}>
      <button
        onClick={() => navigate({ to: "/settings" })}
        className="text-sm text-muted-foreground mb-3 inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-4" /> Back to Settings
      </button>

      <h1 className="text-2xl font-bold mb-1">Privacy Center</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Manage your personal data. Export a copy or request account deletion — and track the status of every request.
      </p>

      {/* Data export */}
      <Card className="glass p-5 mb-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="font-semibold text-base">Export my data</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Get a portable JSON copy of your profile, wallet, chats you sent, calls, follows, gifts, reports and KYC
              status. Prepared on demand and available for 7 days.
            </p>
          </div>
        </div>
        <Button onClick={() => exportMut.mutate()} disabled={exportMut.isPending} className="mt-4 w-full">
          {exportMut.isPending ? (
            <><FileJson className="size-4 mr-2 animate-pulse" /> Preparing your data…</>
          ) : (
            <><Download className="size-4 mr-2" /> Request data export</>
          )}
        </Button>
      </Card>

      {/* Deletion */}
      <Card className="glass p-5 mb-4 border-destructive/40">
        <div className="flex items-start gap-3">
          <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="font-semibold text-base text-destructive">Delete my account</h2>
            <p className="text-sm text-muted-foreground mt-1">
              We hold your request for <b>14 days</b> so you can change your mind. After that, your profile, chats,
              call history, wallet balance and follow connections are permanently removed.
              Reports filed against your account are retained anonymously for safety.
            </p>
          </div>
        </div>

        {activeDeletion ? (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Clock className="size-4" />
              Deletion scheduled
            </div>
            <p className="text-muted-foreground mt-1">
              Your account will be deleted in about <b>{daysUntil(activeDeletion.scheduledFor)} day(s)</b>
              {" "}({new Date(activeDeletion.scheduledFor!).toLocaleString()}). You can cancel until then.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => cancelMut.mutate(activeDeletion.id)}
              disabled={cancelMut.isPending}
            >
              Cancel deletion
            </Button>
          </div>
        ) : (
          <>
            <div className="mt-4 space-y-2">
              <Label className="text-xs">Reason (optional, helps us improve)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Tell us why you're leaving…"
                rows={2}
              />
            </div>
            <div className="mt-3 space-y-2">
              <Label>Type <span className="font-mono font-bold">DELETE</span> to confirm</Label>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" autoComplete="off" />
            </div>
            <Button
              variant="destructive"
              className="mt-4 w-full"
              disabled={confirm !== "DELETE" || scheduleMut.isPending}
              onClick={() => scheduleMut.mutate()}
            >
              <Trash2 className="size-4 mr-2" />
              {scheduleMut.isPending ? "Scheduling…" : "Schedule deletion in 14 days"}
            </Button>
          </>
        )}
      </Card>

      {/* History */}
      <Card className="glass p-5">
        <h2 className="font-semibold text-base mb-3">Request history</h2>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No privacy requests yet.</p>
        ) : (
          <ul className="space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {r.kind === "export" ? <FileJson className="size-4" /> : <Trash2 className="size-4" />}
                    {r.kind === "export" ? "Data export" : "Account deletion"}
                  </div>
                  {statusBadge(r.status)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Requested {new Date(r.createdAt).toLocaleString()}
                  {r.kind === "deletion" && r.scheduledFor && (r.status === "pending" || r.status === "processing") && (
                    <> · scheduled for {new Date(r.scheduledFor).toLocaleString()}</>
                  )}
                  {r.kind === "export" && r.sizeBytes && <> · {formatBytes(r.sizeBytes)}</>}
                  {r.completedAt && <> · completed {new Date(r.completedAt).toLocaleString()}</>}
                </div>
                {r.error && <p className="mt-1 text-xs text-destructive">{r.error}</p>}
                {r.kind === "export" && r.status === "ready" && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => downloadReady(r)}>
                    <Download className="size-3.5 mr-1.5" /> Download JSON
                  </Button>
                )}
                {r.kind === "deletion" && (r.status === "pending" || r.status === "processing") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => cancelMut.mutate(r.id)}
                    disabled={cancelMut.isPending}
                  >
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted-foreground text-center">
        Need help with a privacy request?{" "}
        <a className="underline" href="mailto:support@talkora.app">support@talkora.app</a> ·{" "}
        <Link to="/privacy" className="underline">Privacy Policy</Link>
      </p>
    </AppShell>
  );
}
