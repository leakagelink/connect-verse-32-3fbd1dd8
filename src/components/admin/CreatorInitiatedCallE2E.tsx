import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { runCreatorInitiatedCallE2E } from "@/lib/calls.functions";
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
  creatorId?: string;
  userId?: string;
  bump?: number;
  expectedEarn?: number;
  steps?: StepRow[];
  summary?: Record<string, boolean>;
};

/**
 * Admin panel: stress-tests the INVERTED billing direction that kicks in
 * when a creator places the call (creator-as-caller, user-as-callee).
 *
 * Asserts:
 *  - Creator wallet is NEVER debited (pre-accept OR post-flush).
 *  - User (callee) is debited only AFTER accept + usage flush.
 *  - Audit rows carry payer = user, earner = creator with correct deltas.
 */
export function CreatorInitiatedCallE2E() {
  const run = useServerFn(runCreatorInitiatedCallE2E);
  const [creatorId, setCreatorId] = useState("");
  const [userId, setUserId] = useState("");
  const [bump, setBump] = useState("10");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const onRun = async () => {
    setBusy(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {};
      if (creatorId.trim()) payload.creatorId = creatorId.trim();
      if (userId.trim()) payload.userId = userId.trim();
      const n = parseInt(bump, 10);
      if (Number.isFinite(n) && n > 0) payload.bumpCoins = n;
      const r = (await run({ data: payload })) as Result;
      setResult(r);
      console.log("[creator-init-call-e2e]", r);
      if (r.pass) toast.success("Creator-Initiated Call E2E: PASS");
      else toast.error(`Creator-Initiated Call E2E: FAIL — ${r.reason ?? "see steps"}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setResult({ pass: false, reason: msg });
      console.error("[creator-init-call-e2e] error", e);
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
            <PlayCircle className="size-4" /> Creator-Initiated Call E2E (inverted billing)
          </div>
          <div className="text-xs text-muted-foreground">
            Synthesizes a creator-→-user call. Verifies the creator is NEVER
            debited, the user is debited only after acceptance, and audit rows
            record payer = user / earner = creator. All changes are rolled back.
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
          value={creatorId}
          onChange={(e) => setCreatorId(e.target.value)}
        />
        <Input
          placeholder="User uuid (optional)"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
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
          {(result.creatorId || result.userId) && (
            <div className="text-muted-foreground space-x-2">
              {result.creatorId && (
                <span>creator: <code>{result.creatorId}</code></span>
              )}
              {result.userId && (
                <span>user: <code>{result.userId}</code></span>
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
