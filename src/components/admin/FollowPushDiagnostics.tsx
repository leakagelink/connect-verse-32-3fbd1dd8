import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminDiagnoseFollowPush } from "@/lib/push.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BellRing, CheckCircle2, AlertTriangle, Send } from "lucide-react";

type DiagResult = Awaited<ReturnType<typeof adminDiagnoseFollowPush>>;

export function FollowPushDiagnostics() {
  const diagFn = useServerFn(adminDiagnoseFollowPush);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DiagResult | null>(null);

  async function run(send: boolean) {
    if (!target.trim()) {
      toast.error("Enter recipient username or user ID");
      return;
    }
    setBusy(true);
    try {
      const r = await diagFn({ data: { target: target.trim(), send } });
      setResult(r);
      if (send) {
        if (r.liveSend.pushed > 0) toast.success(`Push delivered to ${r.liveSend.pushed} device(s)`);
        else toast.warning(r.liveSend.reason ?? "Push not delivered — see diagnostics below");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Diagnostics failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="glass p-4 space-y-3">
      <h3 className="font-semibold flex items-center gap-2">
        <BellRing className="size-4" /> Follow-request push diagnostics
      </h3>
      <p className="text-[12px] text-muted-foreground">
        Verify whether <code>sendFollowRequest</code> would actually reach a recipient.
        Inspects notification prefs, registered device tokens, FCM config, recent bell
        rows, and (optionally) fires a real test push through the same code path.
      </p>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="@username or user UUID"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="flex-1 min-w-[200px]"
        />
        <Button variant="outline" onClick={() => run(false)} disabled={busy}>
          Inspect only
        </Button>
        <Button onClick={() => run(true)} disabled={busy}>
          <Send className="size-3.5 mr-1" /> Inspect + live test
        </Button>
      </div>

      {result && (
        <div className="space-y-3 text-[12px]">
          <div className="flex flex-wrap items-center gap-2">
            {result.verdict === "ok" ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                <CheckCircle2 className="size-3 mr-1" /> Push path healthy
              </Badge>
            ) : (
              <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">
                <AlertTriangle className="size-3 mr-1" /> {result.issues.length} issue(s)
              </Badge>
            )}
            <span className="text-muted-foreground">
              {result.recipient.username ? `@${result.recipient.username}` : result.recipient.id}
              {result.recipient.isBanned && <span className="ml-1 text-red-400">(banned)</span>}
            </span>
          </div>

          {result.issues.length > 0 && (
            <ul className="list-disc pl-5 space-y-1 text-amber-300/90">
              {result.issues.map((i, k) => <li key={k}>{i}</li>)}
            </ul>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-md border border-border/40 p-2">
              <div className="text-muted-foreground mb-1">Notification prefs</div>
              <div>follows allowed: <b>{String(result.prefs.followsAllowed)}</b></div>
              <div>row exists: {String(result.prefs.hasRow)}</div>
            </div>
            <div className="rounded-md border border-border/40 p-2">
              <div className="text-muted-foreground mb-1">FCM config</div>
              <div>configured: <b>{String(result.fcm.configured)}</b></div>
              {result.fcm.projectId && <div className="font-mono break-all">{result.fcm.projectId}</div>}
            </div>
          </div>

          <div className="rounded-md border border-border/40 p-2">
            <div className="text-muted-foreground mb-1">
              Device tokens ({result.tokens.count})
            </div>
            {result.tokens.count === 0 ? (
              <div className="text-red-400">No tokens registered — recipient never opened the mobile app, or denied notification permission.</div>
            ) : (
              <ul className="space-y-1">
                {result.tokens.rows.map((t, i) => (
                  <li key={i} className="flex flex-wrap gap-2 items-center">
                    <Badge variant="secondary" className="text-[10px]">{t.platform}</Badge>
                    <span className="font-mono">{t.tokenMasked}</span>
                    <span className="text-muted-foreground">
                      last seen {t.lastSeenAt ? new Date(t.lastSeenAt).toLocaleString() : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {result.liveSend.attempted && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
              <div className="font-medium mb-1">Live test send</div>
              <div>pushed: <b>{result.liveSend.pushed}</b> device(s)</div>
              <div>bell row inserted: {String(result.liveSend.bellInserted)}</div>
              {result.liveSend.reason && (
                <div className="text-amber-400 mt-1">{result.liveSend.reason}</div>
              )}
            </div>
          )}

          <div className="rounded-md border border-border/40 p-2">
            <div className="text-muted-foreground mb-1">
              Recent follow-kind bell rows (24h) — {result.recentFollowNotifications.length}
            </div>
            {result.recentFollowNotifications.length === 0 ? (
              <div className="text-muted-foreground">No rows. If senders report "sent", either prefs are off or notifyUser was never called.</div>
            ) : (
              <ul className="space-y-1">
                {result.recentFollowNotifications.map((n) => (
                  <li key={n.id} className="flex flex-wrap gap-2">
                    <span className="text-muted-foreground">{new Date(n.created_at).toLocaleTimeString()}</span>
                    <span className="font-medium">{n.title}</span>
                    {n.deep_link && <span className="font-mono text-muted-foreground">{n.deep_link}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
