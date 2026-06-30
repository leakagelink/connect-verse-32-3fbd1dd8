import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { runStuckSessionReconnectE2E } from "@/lib/call-invites.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";

type StepRow = { step: string; ok: boolean; detail?: any };
type Result = {
  pass: boolean;
  reason?: string;
  calleeId?: string;
  stuckCallerId?: string;
  newCallerId?: string;
  steps?: StepRow[];
  summary?: Record<string, boolean>;
};

export function StuckSessionReconnectE2E() {
  const run = useServerFn(runStuckSessionReconnectE2E);
  const [calleeId, setCalleeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const onRun = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = (await run({
        data: calleeId.trim() ? { calleeId: calleeId.trim() } : {},
      })) as Result;
      setResult(r);
      if (r.pass) toast.success("Stuck-session reconnect E2E: PASS");
      else
        toast.error(
          `Stuck-session reconnect E2E: FAIL — ${r.reason ?? "see steps"}`,
        );
      console.log("[stuck-session-reconnect-e2e]", r);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setResult({ pass: false, reason: msg });
      toast.error(`E2E error: ${msg}`);
      console.error("[stuck-session-reconnect-e2e] error", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="glass p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <PlayCircle className="size-4" /> Stuck-Session Reconnect E2E
          </div>
          <div className="text-xs text-muted-foreground">
            Seeds a fresh "stuck" call session (open call_log + accepted invite
            + in_call availability with a live heartbeat). Asserts attempt #1
            returns BUSY (amber "Clearing previous call session…" banner),
            then ages the heartbeat past the stale threshold, re-runs the
            reconciler (sky "Reconnecting delivery…" banner), and proves
            attempt #2 creates a pending invite that is accepted atomically —
            call connects without a user-triggered refresh.
          </div>
        </div>
        {result && (
          <Badge variant={result.pass ? "default" : "destructive"}>
            {result.pass ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="size-3" /> PASS
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <XCircle className="size-3" /> FAIL
              </span>
            )}
          </Badge>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Optional creator user id (uuid) — leave blank to auto-pick"
          value={calleeId}
          onChange={(e) => setCalleeId(e.target.value)}
        />
        <Button onClick={onRun} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Run E2E"}
        </Button>
      </div>

      {result && (
        <div className="space-y-2 text-xs">
          {result.reason && (
            <div className="text-destructive">Reason: {result.reason}</div>
          )}
          {(result.calleeId ||
            result.stuckCallerId ||
            result.newCallerId) && (
            <div className="text-muted-foreground space-x-2">
              {result.calleeId && (
                <span>
                  callee: <code>{result.calleeId}</code>
                </span>
              )}
              {result.stuckCallerId && (
                <span>
                  · stuck: <code>{result.stuckCallerId}</code>
                </span>
              )}
              {result.newCallerId && (
                <span>
                  · new: <code>{result.newCallerId}</code>
                </span>
              )}
            </div>
          )}
          {result.summary && (
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(result.summary).map(([k, v]) => (
                <div key={k} className="flex items-center gap-1">
                  {v ? (
                    <CheckCircle2 className="size-3 text-green-500" />
                  ) : (
                    <XCircle className="size-3 text-destructive" />
                  )}
                  <span>{k}</span>
                </div>
              ))}
            </div>
          )}
          {result.steps && result.steps.length > 0 && (
            <div className="border rounded p-2 space-y-1 max-h-72 overflow-auto bg-muted/30">
              {result.steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  {s.ok ? (
                    <CheckCircle2 className="size-3 text-green-500 mt-0.5" />
                  ) : (
                    <XCircle className="size-3 text-destructive mt-0.5" />
                  )}
                  <div className="flex-1">
                    <div className="font-mono">{s.step}</div>
                    {s.detail !== undefined && (
                      <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all">
                        {typeof s.detail === "string"
                          ? s.detail
                          : JSON.stringify(s.detail)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
