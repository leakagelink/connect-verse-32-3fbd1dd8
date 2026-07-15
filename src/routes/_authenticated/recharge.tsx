import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPlans, getWallet, mockRecharge } from "@/lib/wallet.functions";
import { createRazorpayOrder, verifyRazorpayPayment } from "@/lib/razorpay.functions";
import { getPaymentConfig } from "@/lib/payments.functions";
import { getMyProfile } from "@/lib/onboarding.functions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Coins, Sparkles, Gift, ShieldCheck, FlaskConical, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { bonusForDeposit, APP_NAME } from "@/lib/constants";
import { openRazorpay } from "@/lib/razorpay-client";
import { isNative, openExternalUrl } from "@/lib/native";

export const Route = createFileRoute("/_authenticated/recharge")({
  component: Recharge,
});

function Recharge() {
  const qc = useQueryClient();
  const plansFn = useServerFn(listPlans);
  const walletFn = useServerFn(getWallet);
  const profileFn = useServerFn(getMyProfile);
  const createOrderFn = useServerFn(createRazorpayOrder);
  const verifyFn = useServerFn(verifyRazorpayPayment);
  const mockFn = useServerFn(mockRecharge);
  const cfgFn = useServerFn(getPaymentConfig);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });
  const { data: plans } = useQuery({ queryKey: ["plans"], queryFn: () => plansFn() });
  const { data: wallet } = useQuery({ queryKey: ["wallet"], queryFn: () => walletFn() });
  const { data: cfg } = useQuery({ queryKey: ["payment-config"], queryFn: () => cfgFn() });
  const [busy, setBusy] = useState<string | null>(null);

  const bonusPct = bonusForDeposit(wallet?.depositCount ?? 0);
  const isTest = cfg?.mode !== "live";
  const native = isNative();
  // Play Store policy: on the Android build, live purchases must NOT go through
  // in-app alternative billing. Route to the website instead. Test mode stays
  // in-app so QA can still credit coins without real money.
  const useExternalCheckout = native && !isTest;

  // When the user returns from the external browser after paying, refresh the
  // wallet + payment config so newly-credited coins appear without a manual
  // reload. Capacitor's App plugin surfaces resume events on Android.
  useEffect(() => {
    if (!native) return;
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const sub = await App.addListener("appStateChange", (state) => {
          if (state.isActive) {
            qc.invalidateQueries({ queryKey: ["wallet"] });
            qc.invalidateQueries({ queryKey: ["payment-config"] });
          }
        });
        cleanup = () => sub.remove();
      } catch { /* ignore */ }
    })();
    return () => cleanup?.();
  }, [native, qc]);

  async function buy(planId: string, planLabel: string) {
    setBusy(planId);
    try {
      if (isTest) {
        const r = await mockFn({ data: { planId } });
        toast.success(
          `[TEST] +${r.added.toLocaleString("en-IN")} coins${r.bonus > 0 ? ` (+${r.bonus} bonus)` : ""}`,
        );
        qc.invalidateQueries({ queryKey: ["wallet"] });
        setBusy(null);
        return;
      }

      if (useExternalCheckout) {
        // Open the same /recharge page in the system browser. The user signs in
        // there (Supabase session on the web is separate from the app WebView)
        // and completes Razorpay checkout outside the app. Coins auto-sync
        // via the appStateChange listener above when they return.
        const url = `https://talkoraapp.com/recharge?plan=${encodeURIComponent(planId)}&src=android`;
        await openExternalUrl(url);
        toast.info("Opening secure browser for payment", {
          description: "Complete your recharge in the browser. Coins will appear here automatically when you return.",
          duration: 8000,
        });
        setBusy(null);
        return;
      }

      const order = await createOrderFn({ data: { planId } });
      await openRazorpay({
        keyId: order.keyId,
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: APP_NAME,
        description: `${planLabel} coin pack`,
        prefillName: order.username || undefined,
        onSuccess: async (resp) => {
          try {
            const v = await verifyFn({ data: resp });
            const credit: any = v?.credit ?? {};
            const coins = Number(credit.coins ?? 0);
            const bonus = Number(credit.bonus ?? 0);
            toast.success(
              `+${coins.toLocaleString("en-IN")} coins${bonus > 0 ? ` (+${bonus} bonus)` : ""}`,
            );
            qc.invalidateQueries({ queryKey: ["wallet"] });
          } catch (e: any) {
            toast.error(e.message ?? "Verification failed");
          } finally {
            setBusy(null);
          }
        },
        onDismiss: () => {
          setBusy(null);
          toast.info("Payment cancelled");
        },
      });
    } catch (e: any) {
      toast.error(e.message ?? "Could not start payment");
      setBusy(null);
    }
  }

  return (
    <AppShell isAdmin={me?.isAdmin}>
      <h1 className="text-2xl font-bold">Recharge coins</h1>
      <p className="text-sm text-muted-foreground flex items-center gap-1">
        <ShieldCheck className="size-3.5 text-primary" /> Secure payments via Razorpay — UPI, Cards, NetBanking, Wallets.
      </p>

      {isTest && (
        <Card className="glass mt-4 p-3 flex items-center gap-2 border-warning/40 bg-warning/5">
          <FlaskConical className="size-4 text-warning" />
          <div className="flex-1 text-xs">
            <p className="font-semibold">Test mode active</p>
            <p className="text-muted-foreground">No real money is charged. Coins credit instantly for testing. Admin can enable live payments from Admin → Payments.</p>
          </div>
        </Card>
      )}

      {bonusPct > 0 && (
        <Card className="glass mt-4 p-4 flex items-center gap-3 border-accent/40">
          <Gift className="size-5 text-accent" />
          <div className="flex-1">
            <p className="text-sm font-medium">{Math.round(bonusPct * 100)}% BONUS on this deposit!</p>
            <p className="text-xs text-muted-foreground">Limited bonus on your first 3 deposits.</p>
          </div>
          <Badge className="bg-accent text-accent-foreground">Deposit #{(wallet?.depositCount ?? 0) + 1}</Badge>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {(plans ?? []).map((p) => {
          const bonus = Math.floor(Number(p.coins) * bonusPct);
          return (
            <Card key={p.id} className="glass p-4 text-center hover:border-primary/50 transition-colors">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{p.label}</div>
              <div className="mt-1 flex items-baseline justify-center gap-1">
                <span className="text-2xl font-bold">₹{Number(p.price_inr).toLocaleString("en-IN")}</span>
              </div>
              <div className="mt-2 flex items-center justify-center gap-1 text-coin font-semibold">
                <Coins className="size-4" /> {Number(p.coins).toLocaleString("en-IN")}
              </div>
              {bonus > 0 && <p className="mt-1 text-xs text-accent">+ {bonus.toLocaleString("en-IN")} bonus</p>}
              <Button
                size="sm"
                disabled={busy === p.id}
                onClick={() => buy(p.id, p.label ?? "Coin pack")}
                className="mt-3 w-full brand-gradient text-primary-foreground"
              >
                {busy === p.id ? "…" : "Buy"}
              </Button>
            </Card>
          );
        })}
      </div>

      <Card className="glass mt-6 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" /> Bonus tiers
        </div>
        <ul className="mt-2 text-xs text-muted-foreground space-y-1">
          <li>1st deposit — 50% bonus coins</li>
          <li>2nd deposit — 40% bonus coins</li>
          <li>3rd deposit — 30% bonus coins</li>
          <li>After that — no bonus</li>
        </ul>
      </Card>

      <p className="mt-4 text-[10px] text-muted-foreground text-center">
        Coins are virtual credits with no monetary value. All purchases are final unless required by law.
        Read our <a className="underline" href="/refund-policy">refund policy</a>.
      </p>
    </AppShell>
  );
}
