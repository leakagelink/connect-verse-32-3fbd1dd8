import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getWallet } from "@/lib/wallet.functions";
import { getMyProfile } from "@/lib/onboarding.functions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CoinBadge } from "@/components/coin-badge";
import { Coins, Sparkles, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { format } from "date-fns";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/wallet")({
  component: Wallet,
});

function Wallet() {
  const walletFn = useServerFn(getWallet);
  const profileFn = useServerFn(getMyProfile);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });
  const { data, isLoading } = useQuery({ queryKey: ["wallet"], queryFn: () => walletFn() });

  return (
    <AppShell isAdmin={me?.isAdmin}>
      <h1 className="text-2xl font-bold mb-4">Wallet</h1>
      <Card className="glass p-6 border-primary/30">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Coins className="size-4 text-coin" /> Balance</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-4xl font-bold text-coin">{(data?.balance ?? 0).toLocaleString("en-IN")}</span>
          <span className="text-sm text-muted-foreground">coins</span>
        </div>
        {data && data.freeSeconds > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm text-primary">
            <Sparkles className="size-4" /> {Math.floor(data.freeSeconds/60)} free minutes remaining
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Link to="/recharge"><Button className="brand-gradient text-primary-foreground">Recharge coins</Button></Link>
          <Link to="/withdraw"><Button variant="outline">Withdraw</Button></Link>
        </div>
      </Card>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-muted-foreground">Recent transactions</h2>
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : !data?.transactions?.length ? (
        <Card className="glass p-6 text-center text-muted-foreground text-sm">No transactions yet.</Card>
      ) : (
        <div className="space-y-2">
          {data.transactions.map((t: any) => (
            <Card key={t.id} className="glass p-3 flex items-center gap-3">
              <div className={`size-9 grid place-items-center rounded-full ${t.coins_delta > 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                {t.coins_delta > 0 ? <ArrowDownRight className="size-4" /> : <ArrowUpRight className="size-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium capitalize">{t.type.replace("_"," ")}</p>
                <p className="text-xs text-muted-foreground">{format(new Date(t.created_at), "dd MMM, HH:mm")}</p>
              </div>
              <CoinBadge value={`${t.coins_delta > 0 ? "+" : ""}${t.coins_delta}`} />
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
