import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { runConcurrentCallE2E } from "@/lib/call-invites.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";

type StepRow = { step: string; ok: boolean; detail?: any };
type Result = {
  pass: boolean;
  reason?: string;
  calleeId?: string;
  rounds?: number;
  steps?: StepRow[];
  summary?: Record<string, boolean>;
};

export function ConcurrentCallE2E() {
  const run = useServerFn(runConcurrentCallE2E);
  const [calleeId, setCalleeId] = useState("");
  const [rounds, setRounds] = useState("5");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const onRun = async () => {
    setBusy(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {};
      if (calleeId.trim()) payload.calleeId = calleeId.trim();
      const n = parseInt(rounds, 10);
      if (Number.isFinite(n) && n > 0) payload.rounds = n;
      const r = (await run({ data: payload })) as Result;
      setResult(r);
      console.log("[concurrent-call-e2e]", r);
      if (r.pass) toast.success("Concurrent-Call E2E: PASS");
      else toast.error(`Concurrent-Call E2E: FAIL — ${r.reason ?? "see steps"}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setResult({ pass: false, reason: msg });
      console.error("[concurrent-call-e2e] error", e);
      toast.error(`E2E error: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="glass p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <Zap className="size-4" /> Concurrent-Call E2E (race two callers)
          </div>
          <div className="text-xs text-muted-foreground">
            Races two simultaneous accepts per round and asserts the DB only
            ever records one accepted invite per creator at a time (enforced
            by the partial-unique index).
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

      <div className="grid sm:grid-cols-3 gap-2">
        <Input
          placeholder="Creator uuid (optional)"
          value={calleeId}
          onChange={(e) => setCalleeId(e.target.value)}
        />
        <Input
          placeholder="Rounds"
          value={rounds}
          onChange={(e) => setRounds(e.target.value)}
          className="w-24"
        />
        <Button onClick={onRun} disabled={busy} className="flex-1">
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Run E2E"}
        </Button>
      </div>

      {result && (
        <div className="space-y-2 text-xs">
          {result.reason && (
            <div className="text-destructive">Reason: {result.reason}</div>
          )}
          {result.calleeId && (
            <div className="text-muted-foreground">
              creator: <code>{result.calleeId}</code> · rounds: {result.rounds}
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
