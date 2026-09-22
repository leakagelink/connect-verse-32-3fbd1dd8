import { AppShell } from "@/components/app-shell";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { COINS_ENABLED } from "@/lib/feature-flags";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRechargeOrderStatus } from "@/lib/recharge-status.functions";
import { getWallet } from "@/lib/wallet.functions";
import { getMyProfile } from "@/lib/onboarding.functions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Coins, CheckCircle2, XCircle, Loader2, Clock, RefreshCw, ArrowRight } from "lucide-react";

const SearchSchema = z.object({
  orderId: z.string().min(1),
});

export const Route = createFileRoute("/_authenticated/recharge/status")({
  validateSearch: (s) => SearchSchema.parse(s),
  component: RechargeStatus,
});

type Phase = "pending" | "success" | "failed";

function phaseFrom(status: string): Phase {
  if (status === "credited") return "success";
  if (status === "failed" || status === "expired") return "failed";
  return "pending"; // created | paid | anything else
}

function RechargeStatus() {
  if (!COINS_ENABLED) {
    return (
      <AppShell>
        <FeatureUnavailable
          title="Payments are not available"
          description="Talkora is free right now — there are no coins, plans or payments to check the status of."
        />
      </AppShell>
    );
  }

  const { orderId } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const statusFn = useServerFn(getRechargeOrderStatus);
  const walletFn = useServerFn(getWallet);
  const profileFn = useServerFn(getMyProfile);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });

  // Poll fast while pending, stop when settled.
  const { data, refetch, isFetching, error } = useQuery({
    queryKey: ["recharge-order", orderId],
    queryFn: () => statusFn({ data: { orderId } }),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (!s) return 2000;
      return phaseFrom(s) === "pending" ? 2000 : false;
    },
    refetchOnWindowFocus: true,
  });

  const phase: Phase = data ? phaseFrom(data.status) : "pending";

  // Track elapsed time so we can show "still waiting" copy after ~30s.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase !== "pending") return;
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // On success, refresh wallet so the balance in the app is current.
  useEffect(() => {
    if (phase === "success") {
      qc.invalidateQueries({ queryKey: ["wallet"] });
      walletFn().catch(() => {});
    }
  }, [phase, qc, walletFn]);

  const total = (data?.coins ?? 0) + (data?.bonus ?? 0);
  const amountInr = useMemo(
    () => (data ? (data.amountPaise / 100).toLocaleString("en-IN") : "—"),
    [data],
  );

  return (
    <AppShell isAdmin={me?.isAdmin}>
      <h1 className="text-2xl font-bold">Recharge status</h1>
      <p className="text-sm text-muted-foreground">Order #{orderId.slice(-10)}</p>

      <Card className="glass mt-4 p-6 text-center">
        {phase === "pending" && (
          <>
            <div className="mx-auto grid place-items-center size-14 rounded-full bg-primary/10">
              <Loader2 className="size-7 text-primary animate-spin" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Confirming your payment…</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We're waiting for the payment gateway to confirm your transaction. This usually takes a few seconds.
            </p>
            {elapsed > 30 && (
              <p className="mt-3 text-xs text-warning inline-flex items-center gap-1">
                <Clock className="size-3.5" /> Taking longer than usual — you can safely leave this page. Coins will appear as soon as we get the confirmation.
              </p>
            )}
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
                <span className="ml-1.5">Check again</span>
              </Button>
            </div>
          </>
        )}

        {phase === "success" && (
          <>
            <div className="mx-auto grid place-items-center size-14 rounded-full bg-success/10">
              <CheckCircle2 className="size-8 text-success" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Payment successful</h2>
            {data?.planLabel && (
              <p className="mt-1 text-sm text-muted-foreground">{data.planLabel} · ₹{amountInr}</p>
            )}
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-coin/10 px-4 py-2 text-coin font-semibold">
              <Coins className="size-4" />
              +{total.toLocaleString("en-IN")} coins
            </div>
            {data && data.bonus > 0 && (
              <p className="mt-2 text-xs text-accent">
                Includes +{data.bonus.toLocaleString("en-IN")} bonus coins
              </p>
            )}
            <div className="mt-5 flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" onClick={() => navigate({ to: "/recharge" })}>
                Recharge again
              </Button>
              <Button size="sm" className="brand-gradient text-primary-foreground" onClick={() => navigate({ to: "/home" })}>
                Continue <ArrowRight className="size-4 ml-1" />
              </Button>
            </div>
          </>
        )}

        {phase === "failed" && (
          <>
            <div className="mx-auto grid place-items-center size-14 rounded-full bg-destructive/10">
              <XCircle className="size-8 text-destructive" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">
              {data?.status === "expired" ? "Payment expired" : "Payment failed"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              No coins were added and you have not been charged. If money was deducted, it will be refunded by your bank within 5–7 business days.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <Button size="sm" className="brand-gradient text-primary-foreground" onClick={() => navigate({ to: "/recharge" })}>
                Try again
              </Button>
              <Link to="/settings" className="text-xs text-muted-foreground underline">Need help?</Link>
            </div>
          </>
        )}

        {error && !data && (
          <p className="mt-4 text-xs text-destructive">
            Couldn't load order status. <button onClick={() => refetch()} className="underline">Retry</button>
          </p>
        )}
      </Card>

      <p className="mt-4 text-[10px] text-muted-foreground text-center">
        You can close this page anytime — we'll credit your coins as soon as the payment confirms.
      </p>
    </AppShell>
  );
}
