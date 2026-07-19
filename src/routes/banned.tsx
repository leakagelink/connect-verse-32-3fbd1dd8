import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { submitBanAppeal, listMyAppeals } from "@/lib/appeals.functions";
import { Ban, Send, Clock, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/banned")({
  component: Banned,
});

const statusMeta: Record<string, { label: string; icon: any; className: string }> = {
  pending:  { label: "Under review", icon: Clock,        className: "bg-muted text-muted-foreground" },
  approved: { label: "Approved",     icon: CheckCircle2, className: "bg-success/15 text-success border-success/30" },
  rejected: { label: "Declined",     icon: XCircle,      className: "bg-destructive/15 text-destructive border-destructive/30" },
};

function Banned() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const submit = useServerFn(submitBanAppeal);
  const listFn = useServerFn(listMyAppeals);

  const { data: appeals = [], isLoading } = useQuery({
    queryKey: ["my-appeals"],
    queryFn: () => listFn(),
  });

  const pending = appeals.find((a: any) => a.status === "pending");

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await submit({ data: { message: msg.trim() } });
      toast.success("Appeal submitted. We'll review within 24–72 hours.");
      setMsg("");
      qc.invalidateQueries({ queryKey: ["my-appeals"] });
    } catch (err: any) {
      toast.error(err?.message || "Could not submit appeal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen px-4 py-8 flex justify-center">
      <div className="w-full max-w-lg space-y-4">
        <Card className="glass p-6 sm:p-8 text-center">
          <Ban className="mx-auto size-10 text-destructive" />
          <h1 className="mt-3 text-xl sm:text-2xl font-semibold">Account suspended</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account has been suspended for violating our community guidelines.
            If you believe this is a mistake, you can file an appeal below.
          </p>
        </Card>

        <Card className="glass p-4 sm:p-5">
          <div className="text-sm font-medium">File an appeal</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Explain clearly what happened. Our safety team reviews every appeal within 24–72 hours.
          </p>
          {pending ? (
            <div className="mt-3 rounded-md border border-border p-3 text-xs">
              You already have a pending appeal. We'll notify you once it's reviewed.
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-3 space-y-2">
              <Textarea
                required
                minLength={20}
                maxLength={2000}
                rows={5}
                placeholder="Describe what happened, context, and why you think the suspension should be lifted (min. 20 characters)."
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                className="text-[16px]"
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{msg.trim().length}/2000</span>
                <span>Only one appeal every 24h.</span>
              </div>
              <Button type="submit" disabled={busy || msg.trim().length < 20} className="w-full gap-1.5">
                <Send className="size-4" /> {busy ? "Submitting…" : "Submit appeal"}
              </Button>
            </form>
          )}
        </Card>

        <Card className="glass p-4 sm:p-5">
          <div className="text-sm font-medium">My appeals</div>
          {isLoading ? (
            <div className="mt-2 text-xs text-muted-foreground">Loading…</div>
          ) : appeals.length === 0 ? (
            <div className="mt-2 text-xs text-muted-foreground">No appeals yet.</div>
          ) : (
            <div className="mt-3 space-y-2">
              {appeals.map((a: any) => {
                const meta = statusMeta[a.status] || statusMeta.pending;
                const Icon = meta.icon;
                return (
                  <div key={a.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className={meta.className}>
                        <Icon className="size-3 mr-1" /> {meta.label}
                      </Badge>
                      <span className="ml-auto text-muted-foreground">
                        {format(new Date(a.created_at), "dd MMM yyyy, HH:mm")}
                      </span>
                    </div>
                    <div className="mt-2 text-xs whitespace-pre-wrap break-words">{a.message}</div>
                    {a.admin_notes && (
                      <div className="mt-2 rounded bg-muted/40 p-2 text-xs">
                        <span className="font-medium">Team response: </span>{a.admin_notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="flex gap-2 justify-center">
          <Button onClick={signOut} variant="outline" size="sm">Sign out</Button>
          <Link to="/"><Button variant="ghost" size="sm">Home</Button></Link>
        </div>
      </div>
    </div>
  );
}
