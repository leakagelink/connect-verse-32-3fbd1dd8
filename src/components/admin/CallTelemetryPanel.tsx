import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Trash2, Activity } from "lucide-react";
import { listCallEvents, purgeCallEventsOlderThan14d } from "@/lib/call-events.functions";
import { toast } from "sonner";

const EVENT_TONE: Record<string, string> = {
  invite_created: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  invite_busy: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  invite_failed: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  invite_cancelled: "bg-muted text-muted-foreground",
  invite_expired: "bg-muted text-muted-foreground",
  invite_accepted: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  accept_conflict: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  accept_ghost_cleared: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  accept_rejected: "bg-muted text-muted-foreground",
  call_connected: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  call_ended: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  stale_invite_expired: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  stale_accepted_cancelled: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  stale_availability_reset: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  orphan_log_closed: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
};

const EVENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All events" },
  { value: "invite_created", label: "Invite created" },
  { value: "invite_busy", label: "Invite busy" },
  { value: "invite_failed", label: "Invite failed" },
  { value: "invite_accepted", label: "Invite accepted" },
  { value: "accept_conflict", label: "Accept conflict" },
  { value: "accept_ghost_cleared", label: "Accept ghost cleared" },
  { value: "call_connected", label: "Call connected" },
  { value: "call_ended", label: "Call ended" },
  { value: "stale_invite_expired", label: "Reconciler: invite expired" },
  { value: "stale_accepted_cancelled", label: "Reconciler: accepted cancelled" },
  { value: "stale_availability_reset", label: "Reconciler: availability reset" },
  { value: "orphan_log_closed", label: "Reconciler: orphan log closed" },
];

function shortId(id: string | null): string {
  if (!id) return "—";
  return id.slice(0, 8);
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function CallTelemetryPanel() {
  const [eventType, setEventType] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("");
  const [sinceMinutes, setSinceMinutes] = useState<number>(60);
  const listFn = useServerFn(listCallEvents);
  const purgeFn = useServerFn(purgeCallEventsOlderThan14d);
  const qc = useQueryClient();

  const queryKey = ["call-events", eventType, userFilter, sinceMinutes];
  const { data, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      listFn({
        data: {
          limit: 200,
          sinceMinutes,
          eventType: eventType === "all" ? undefined : eventType,
          userId: userFilter.trim().length === 36 ? userFilter.trim() : undefined,
        },
      }),
    refetchInterval: 15_000,
  });

  const purgeMut = useMutation({
    mutationFn: () => purgeFn({}),
    onSuccess: (res) => {
      toast.success(`Purged ${res.purged} old events`);
      qc.invalidateQueries({ queryKey: ["call-events"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Purge failed"),
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary ?? {};

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4" />
              Call lifecycle telemetry
            </CardTitle>
            <CardDescription>
              Server-side timeline of invite → accept → connect → end events. Use this to diagnose ghost-state or busy-block bugs.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`size-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => purgeMut.mutate()}
              disabled={purgeMut.isPending}
            >
              <Trash2 className="size-3.5 mr-1" />
              Purge &gt;14d
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Event type</label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="w-56 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Window (minutes)</label>
            <Select
              value={String(sinceMinutes)}
              onValueChange={(v) => setSinceMinutes(Number(v))}
            >
              <SelectTrigger className="w-32 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">Last 15m</SelectItem>
                <SelectItem value="60">Last 1h</SelectItem>
                <SelectItem value="360">Last 6h</SelectItem>
                <SelectItem value="1440">Last 24h</SelectItem>
                <SelectItem value="10080">Last 7d</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">User ID (caller / callee / actor)</label>
            <Input
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              placeholder="paste a user UUID to scope events"
              className="h-9"
            />
          </div>
        </div>

        {Object.keys(summary).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(summary)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <Badge
                  key={type}
                  variant="outline"
                  className={`text-[10px] ${EVENT_TONE[type] ?? ""}`}
                >
                  {type} · {count}
                </Badge>
              ))}
          </div>
        )}

        <ScrollArea className="h-[480px] rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur z-10">
              <tr className="text-left">
                <th className="p-2 font-medium">Time</th>
                <th className="p-2 font-medium">Event</th>
                <th className="p-2 font-medium">Caller</th>
                <th className="p-2 font-medium">Callee</th>
                <th className="p-2 font-medium">Invite</th>
                <th className="p-2 font-medium">Call log</th>
                <th className="p-2 font-medium">Kind</th>
                <th className="p-2 font-medium">Reason</th>
                <th className="p-2 font-medium">OK</th>
                <th className="p-2 font-medium">Meta</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-muted-foreground">
                    No events in this window.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/40">
                  <td className="p-2 whitespace-nowrap font-mono text-[10px]">{fmtTime(r.created_at)}</td>
                  <td className="p-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${EVENT_TONE[r.event_type] ?? ""}`}
                    >
                      {r.event_type}
                    </Badge>
                  </td>
                  <td className="p-2 font-mono text-[10px]">{shortId(r.caller_id)}</td>
                  <td className="p-2 font-mono text-[10px]">{shortId(r.callee_id)}</td>
                  <td className="p-2 font-mono text-[10px]">{shortId(r.invite_id)}</td>
                  <td className="p-2 font-mono text-[10px]">{shortId(r.call_log_id)}</td>
                  <td className="p-2">{r.kind ?? "—"}</td>
                  <td className="p-2 text-muted-foreground max-w-[180px] truncate" title={r.reason ?? ""}>
                    {r.reason ?? "—"}
                  </td>
                  <td className="p-2">
                    {r.ok === true ? "✅" : r.ok === false ? "⚠️" : "—"}
                  </td>
                  <td className="p-2 max-w-[220px] truncate font-mono text-[10px]" title={r.meta ?? ""}>
                    {r.meta ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
