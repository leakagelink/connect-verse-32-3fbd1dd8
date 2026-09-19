import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyReferralStats, applyReferralCode } from "@/lib/engagement.functions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Gift, Copy, Share2, Users, Coins, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/refer")({
  component: ReferPage,
});

function ReferPage() {
  const qc = useQueryClient();
  const statsFn = useServerFn(getMyReferralStats);
  const applyFn = useServerFn(applyReferralCode);

  const { data, isLoading } = useQuery({
    queryKey: ["referral-stats"],
    queryFn: () => statsFn(),
  });

  const [code, setCode] = useState("");
  const apply = useMutation({
    mutationFn: (c: string) => applyFn({ data: { code: c } }),
    onSuccess: (r: any) => {
      toast.success(`+${r.bonus} coins credited! Welcome bonus applied 🎉`);
      setCode("");
      qc.invalidateQueries({ queryKey: ["referral-stats"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Could not apply code"),
  });

  const myCode = data?.code ?? "";
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/auth?ref=${myCode}` : "";
  const shareText = `Join me on Talkora! Use my code ${myCode} when you sign up and get 50 free coins. ${shareUrl}`;

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch { toast.error("Could not copy"); }
  }

  async function share() {
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try {
        await (navigator as any).share({ title: "Talkora invite", text: shareText, url: shareUrl });
      } catch { /* user cancelled */ }
    } else {
      copy(shareText, "Invite message");
    }
  }

  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Refer & Earn</h1>
        <p className="text-sm text-muted-foreground">
          Invite friends — they get 50 coins, you earn 10% of their first recharge (up to 1,000 coins).
        </p>
      </div>

      {/* Your code */}
      <Card className="glass p-5 mb-4 border-primary/30">
        <div className="flex items-center gap-2 mb-2 text-primary">
          <Gift className="size-5" />
          <p className="font-semibold">Your referral code</p>
        </div>
        {isLoading || !myCode ? (
          <div className="h-12 bg-muted/40 animate-pulse rounded-md" />
        ) : (
          <>
            <div className="flex items-stretch gap-2">
              <div className="flex-1 rounded-md border border-dashed border-primary/40 bg-primary/5 text-2xl font-mono font-bold tracking-widest text-center py-3">
                {myCode}
              </div>
              <Button variant="outline" onClick={() => copy(myCode, "Code")} aria-label="Copy code">
                <Copy className="size-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Button variant="secondary" onClick={() => copy(shareUrl, "Invite link")}>
                <Copy className="size-4 mr-1.5" /> Copy link
              </Button>
              <Button className="brand-gradient" onClick={share}>
                <Share2 className="size-4 mr-1.5" /> Share
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <StatCard icon={Users} label="Invited" value={data?.totalReferrals ?? 0} />
        <StatCard icon={CheckCircle2} label="Recharged" value={data?.converted ?? 0} />
        <StatCard icon={Coins} label="Coins earned" value={data?.totalCoinsEarned ?? 0} />
      </div>

      {/* Apply code (if not already referred) */}
      {data && !data.referredBy && (
        <Card className="glass p-4 mb-4">
          <p className="font-semibold mb-1">Got a code from a friend?</p>
          <p className="text-xs text-muted-foreground mb-3">
            Apply within 7 days of signup to receive 50 bonus coins instantly.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="ENTER CODE"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="font-mono tracking-widest uppercase"
              maxLength={16}
            />
            <Button
              disabled={apply.isPending || code.length < 4}
              onClick={() => apply.mutate(code)}
            >
              {apply.isPending ? "Applying…" : "Apply"}
            </Button>
          </div>
        </Card>
      )}
      {data?.referredBy && (
        <Card className="glass p-4 mb-4 text-xs text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="size-4 text-success" />
          You were referred by a friend. Bonus already applied.
        </Card>
      )}

      {/* Recent invites */}
      <Card className="glass p-4">
        <p className="font-semibold mb-3">Your invites</p>
        {!data?.referrals?.length ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No invites yet. Share your code to start earning!
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {data.referrals.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{r.referee_id.slice(0, 8)}…</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(r.created_at as string).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant={r.first_recharge_at ? "default" : "secondary"} className="text-[10px]">
                  {r.first_recharge_at ? `+${r.recharge_bonus_coins} coins` : "Pending recharge"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card className="glass p-3 text-center">
      <Icon className="size-4 mx-auto text-primary mb-1" />
      <p className="text-lg font-bold">{value.toLocaleString("en-IN")}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
    </Card>
  );
}
