import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminListSosEvents } from "@/lib/sos.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Siren, RefreshCw } from "lucide-react";
import { format } from "date-fns";

const OUTCOMES = ["all", "report_filed", "report_failed", "opened", "cancelled"] as const;
type OutcomeFilter = (typeof OUTCOMES)[number];

const outcomeColor: Record<string, string> = {
  report_filed: "bg-success/15 text-success border-success/30",
  report_failed: "bg-destructive/15 text-destructive border-destructive/30",
  opened: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

export function SosAuditTab() {
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [hours, setHours] = useState<string>("168");
  const listFn = useServerFn(adminListSosEvents);

  const q = useQuery({
    queryKey: ["admin-sos-events", outcome, hours],
    queryFn: () =>
      listFn({
        data: {
          limit: 200,
          outcome: outcome === "all" ? undefined : outcome,
          sinceHours: hours === "all" ? undefined : Number(hours),
        },
      }),
  });

  const events = q.data?.events ?? [];

  return (
    <div className="space-y-3">
      <Card className="glass p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Siren className="size-4 text-destructive" />
          <div className="text-sm font-medium">In-call SOS audit</div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={outcome} onValueChange={(v) => setOutcome(v as OutcomeFilter)}>
              <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OUTCOMES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24">Last 24h</SelectItem>
                <SelectItem value="168">Last 7d</SelectItem>
                <SelectItem value="720">Last 30d</SelectItem>
                <SelectItem value="all">All time</SelectItem>
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
      ) : q.isError ? (
        <Card className="glass p-4 text-sm text-destructive">
          {(q.error as any)?.message || "Failed to load SOS events"}
        </Card>
      ) : events.length === 0 ? (
        <Card className="glass p-4 text-sm text-muted-foreground">No SOS events in this window.</Card>
      ) : (
        <div className="space-y-2">
          {events.map((e: any) => (
            <Card key={e.id} className="glass p-3">
              <div className="flex flex-wrap items-start gap-2 text-sm">
                <Badge variant="outline" className={outcomeColor[e.outcome] || ""}>{e.outcome}</Badge>
                <Badge variant="outline">{e.reason}</Badge>
                <div className="ml-auto text-xs text-muted-foreground">
                  {format(new Date(e.created_at), "dd MMM yyyy, HH:mm:ss")}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <span className="text-muted-foreground">Reporter: </span>
                  <span className="font-mono">{e.user_username ?? e.user_id.slice(0, 8)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Partner: </span>
                  <span className="font-mono">
                    {e.partner_username ?? (e.partner_user_id ? e.partner_user_id.slice(0, 8) : "—")}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Call: </span>
                  <span className="font-mono">{e.call_log_id ? e.call_log_id.slice(0, 8) : "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Latency: </span>
                  {e.duration_ms != null ? `${e.duration_ms} ms` : "—"}
                </div>
              </div>
              {e.note && (
                <div className="mt-2 text-xs">
                  <span className="text-muted-foreground">Note: </span>{e.note}
                </div>
              )}
              {e.error && (
                <div className="mt-1 text-xs text-destructive">Error: {e.error}</div>
              )}
              <div className="mt-2 text-[10px] text-muted-foreground font-mono">id: {e.id}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
