import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { runCallEndE2E } from "@/lib/calls.functions";
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
  callerId?: string;
  calleeId?: string;
  bump?: number;
  expectedEarn?: number;
  steps?: StepRow[];
  summary?: Record<string, boolean>;
};

export function CallEndE2E() {
  const run = useServerFn(runCallEndE2E);
  const [callerId, setCallerId] = useState("");
  const [calleeId, setCalleeId] = useState("");
  const [bump, setBump] = useState("10");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const onRun = async () => {
    setBusy(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {};
      if (callerId.trim()) payload.callerId = callerId.trim();
      if (calleeId.trim()) payload.calleeId = calleeId.trim();
      const n = parseInt(bump, 10);
      if (Number.isFinite(n) && n > 0) payload.bumpCoins = n;
      const r = (await run({ data: payload })) as Result;
      setResult(r);
      console.log("[call-end-e2e]", r);
      if (r.pass) toast.success("Call-End E2E: PASS");
      else toast.error(`Call-End E2E: FAIL — ${r.reason ?? "see steps"}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setResult({ pass: false, reason: msg });
      console.error("[call-end-e2e] error", e);
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
            <PlayCircle className="size-4" /> Call-End E2E (debit + credit + audit)
          </div>
          <div className="text-xs text-muted-foreground">
            Synthesizes a full call lifecycle, verifies caller is debited,
            creator credited 50%, audit transactions written, and call_log
            ended — then rolls back all changes.
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
          placeholder="Caller uuid (optional)"
          value={callerId}
          onChange={(e) => setCallerId(e.target.value)}
        />
        <Input
          placeholder="Creator uuid (optional)"
          value={calleeId}
          onChange={(e) => setCalleeId(e.target.value)}
        />
        <div className="flex gap-2">
          <Input
            placeholder="Coins"
            value={bump}
            onChange={(e) => setBump(e.target.value)}
            className="w-24"
          />
          <Button onClick={onRun} disabled={busy} className="flex-1">
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Run E2E"}
          </Button>
        </div>
      </div>

      {result && (
        <div className="space-y-2 text-xs">
          {result.reason && (
            <div className="text-destructive">Reason: {result.reason}</div>
          )}
          {(result.callerId || result.calleeId) && (
            <div className="text-muted-foreground space-x-2">
              {result.callerId && (
                <span>caller: <code>{result.callerId}</code></span>
              )}
              {result.calleeId && (
                <span>creator: <code>{result.calleeId}</code></span>
              )}
              {result.bump != null && (
                <span>· bump: {result.bump} → earn {result.expectedEarn}</span>
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
