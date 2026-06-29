import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminListCallEndAudit } from "@/lib/admin.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, Video, RefreshCw } from "lucide-react";
import { format } from "date-fns";

type ReasonFilter =
  | "all" | "user_ended" | "peer_left" | "coins_exhausted"
  | "media_error" | "network" | "background_lost" | "admin" | "unknown";

const REASON_LABEL: Record<string, { label: string; tone: string }> = {
  user_ended: { label: "User ended", tone: "bg-muted text-foreground" },
  peer_left: { label: "Peer left", tone: "bg-amber-500/15 text-amber-600 dark:text-amber-300" },
  coins_exhausted: { label: "Coins exhausted", tone: "bg-destructive/15 text-destructive" },
  media_error: { label: "Media error", tone: "bg-red-500/15 text-red-600 dark:text-red-300" },
  network: { label: "Network", tone: "bg-blue-500/15 text-blue-600 dark:text-blue-300" },
  background_lost: { label: "Background lost", tone: "bg-orange-500/15 text-orange-600 dark:text-orange-300" },
  admin: { label: "Admin", tone: "bg-purple-500/15 text-purple-600 dark:text-purple-300" },
  unknown: { label: "Unknown", tone: "bg-muted text-muted-foreground" },
};

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CallAuditTab() {
  const [reason, setReason] = useState<ReasonFilter>("all");
  const listFn = useServerFn(adminListCallEndAudit);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin", "call-audit", reason],
    queryFn: () => listFn({ data: { reason, limit: 100 } }),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={reason} onValueChange={(v) => setReason(v as ReasonFilter)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All end reasons</SelectItem>
            <SelectItem value="user_ended">User ended</SelectItem>
            <SelectItem value="peer_left">Peer left</SelectItem>
            <SelectItem value="coins_exhausted">Coins exhausted</SelectItem>
            <SelectItem value="media_error">Media error</SelectItem>
            <SelectItem value="network">Network</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`size-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {data?.length ?? 0} call{(data?.length ?? 0) === 1 ? "" : "s"}
        </span>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      <div className="space-y-2">
        {(data ?? []).map((c) => {
          const reasonKey = c.endReason ?? (c.missedReason ? "unknown" : "user_ended");
          const r = REASON_LABEL[reasonKey] ?? REASON_LABEL.unknown;
          const KindIcon = c.kind === "video" ? Video : Phone;
          return (
            <Card key={c.id} className="glass p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <KindIcon className="size-4 text-muted-foreground" />
                <span className="font-medium">{c.callerUsername}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium">{c.calleeUsername}</span>
                <Badge className={r.tone}>{r.label}</Badge>
                {c.missedReason && (
                  <Badge variant="outline" className="text-xs">missed: {c.missedReason}</Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {format(new Date(c.startedAt), "dd MMM, HH:mm:ss")}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Duration: <span className="text-foreground">{fmtDuration(c.durationSeconds)}</span></span>
                <span>Coins: <span className="text-foreground">{c.coinsSpent}</span></span>
                <span>Status: <span className="text-foreground">{c.status}</span></span>
                {c.endedByUsername && (
                  <span>Ended by: <span className="text-foreground">{c.endedByUsername}</span></span>
                )}
              </div>
            </Card>
          );
        })}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <div className="text-sm text-muted-foreground py-6 text-center">No calls match this filter.</div>
        )}
      </div>
    </div>
  );
}
