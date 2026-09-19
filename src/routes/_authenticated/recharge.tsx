import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getWallet } from "@/lib/wallet.functions";
import { listPlayPlans, verifyPlayPurchase, getBillingStatus } from "@/lib/billing.functions";
import { getMyProfile } from "@/lib/onboarding.functions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Coins,
  Sparkles,
  Gift,
  ShieldCheck,
  RefreshCw,
  Smartphone,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { bonusForDeposit } from "@/lib/constants";
import { PLAY_BILLING_READY } from "@/lib/billing-config";
import {
  playBillingSupported,
  playBillingAvailable,
  queryPlayProducts,
  startPlayPurchase,
  getOwnedPlayPurchases,
  consumePlayPurchase,
  type PlayProduct,
} from "@/lib/play-billing";

export const Route = createFileRoute("/_authenticated/recharge")({
  component: Recharge,
});

function Recharge() {
  const qc = useQueryClient();
  const profileFn = useServerFn(getMyProfile);
  const walletFn = useServerFn(getWallet);
  const plansFn = useServerFn(listPlayPlans);
  const statusFn = useServerFn(getBillingStatus);
  const verifyFn = useServerFn(verifyPlayPurchase);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });
  const { data: wallet } = useQuery({ queryKey: ["wallet"], queryFn: () => walletFn() });
  const { data: plans } = useQuery({ queryKey: ["play-plans"], queryFn: () => plansFn() });
  const { data: billing } = useQuery({ queryKey: ["billing-status"], queryFn: () => statusFn() });

  const [storePrices, setStorePrices] = useState<Record<string, PlayProduct>>({});
  const [storeReady, setStoreReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const onAndroidApp = playBillingSupported();
  const bonusPct = bonusForDeposit(wallet?.depositCount ?? 0);
  const serverReady = !!billing?.verificationConfigured && (billing?.mappedProducts ?? 0) > 0;
  const purchasesEnabled = PLAY_BILLING_READY && onAndroidApp && serverReady && storeReady === true;

  /** Send a Play purchase token to the server, then consume it once credited. */
  const redeem = useCallback(
    async (productId: string, purchaseToken: string, quiet = false) => {
      const res = await verifyFn({ data: { productId, purchaseToken } });
      if (res.status === "credited" || res.status === "already_credited") {
        await consumePlayPurchase(purchaseToken);
        qc.invalidateQueries({ queryKey: ["wallet"] });
        if (res.status === "credited") {
          toast.success(
            `+${res.coins.toLocaleString("en-IN")} coins${res.bonus > 0 ? ` (+${res.bonus.toLocaleString("en-IN")} bonus)` : ""}`,
          );
        } else if (!quiet) {
          toast.info("This purchase was already credited.");
        }
        return true;
      }
      if (res.status === "pending") {
        toast.info("Payment pending with Google Play", {
          description: "Coins will be added automatically once Google confirms the payment.",
        });
        return false;
      }
      if (!quiet) toast.error("Google Play could not confirm this purchase.");
      return false;
    },
    [qc, verifyFn],
  );

  // Ask Google for localised prices, and finish any purchase that was
  // interrupted before the server could credit it.
  useEffect(() => {
    if (!onAndroidApp) {
      setStoreReady(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const avail = await playBillingAvailable();
      if (cancelled) return;
      setStoreReady(avail.available);
      if (!avail.available) return;

      const ids = (plans ?? []).map((p) => p.play_product_id).filter(Boolean) as string[];
      if (ids.length > 0) {
        const products = await queryPlayProducts(ids);
        if (cancelled) return;
        const map: Record<string, PlayProduct> = {};
        for (const p of products) map[p.productId] = p;
        setStorePrices(map);
      }

      // Restore: any owned purchase means Google took money but we may not
      // have credited coins yet.
      const owned = await getOwnedPlayPurchases();
      for (const p of owned) {
        if (!p.purchaseToken || !p.productId) continue;
        try {
          await redeem(p.productId, p.purchaseToken, true);
        } catch {
          /* leave it owned so the next attempt can retry */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onAndroidApp, plans, redeem]);

  async function buy(productId: string | null) {
    if (!productId) return;
    if (!purchasesEnabled) return;
    setBusy(productId);
    try {
      const res = await startPlayPurchase(productId, me?.profile?.id ?? undefined);
      if (res.status === "cancelled") {
        toast.info("Purchase cancelled");
        return;
      }
      if (res.status === "unavailable" || !res.purchase?.purchaseToken) {
        toast.error("Google Play is not available on this device.");
        return;
      }
      await redeem(productId, res.purchase.purchaseToken);
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? "Could not complete the purchase");
    } finally {
      setBusy(null);
    }
  }

  async function restorePurchases() {
    setRestoring(true);
    try {
      const owned = await getOwnedPlayPurchases();
      let credited = 0;
      for (const p of owned) {
        if (!p.purchaseToken || !p.productId) continue;
        if (await redeem(p.productId, p.purchaseToken, true)) credited++;
      }
      await qc.invalidateQueries({ queryKey: ["wallet"] });
      if (credited === 0) toast.info("No pending purchases found.");
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? "Could not check purchases");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <AppShell isAdmin={me?.isAdmin}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Recharge coins</h1>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" /> Coin packs are billed securely
            by Google Play.
          </p>
        </div>
        {onAndroidApp && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={restoring}
            onClick={() => void restorePurchases()}
          >
            <RefreshCw className={`size-4 ${restoring ? "animate-spin" : ""}`} />
            <span className="ml-1.5">{restoring ? "Checking…" : "Restore"}</span>
          </Button>
        )}
      </div>

      {!onAndroidApp && (
        <Card className="glass mt-4 flex items-start gap-3 border-primary/40 bg-primary/5 p-4">
          <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="text-xs">
            <p className="text-sm font-semibold">Recharge in the Talkora Android app</p>
            <p className="mt-1 text-muted-foreground">
              Coin packs are sold through Google Play, so purchases are only available in the
              Talkora app on Android. Your coins and balance stay the same everywhere.
            </p>
          </div>
        </Card>
      )}

      {onAndroidApp && !purchasesEnabled && (
        <Card className="glass mt-4 flex items-start gap-3 border-warning/50 bg-warning/5 p-4">
          <Wrench className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="text-xs">
            <p className="text-sm font-semibold">Coin purchases coming soon</p>
            <p className="mt-1 text-muted-foreground">
              We're finishing the Google Play billing setup for coin packs. Free trial minutes,
              chat, calls and gifts keep working meanwhile — thanks for your patience!
            </p>
          </div>
        </Card>
      )}

      {bonusPct > 0 && (
        <Card className="glass mt-4 flex items-center gap-3 border-accent/40 p-4">
          <Gift className="size-5 text-accent" />
          <div className="flex-1">
            <p className="text-sm font-medium">{Math.round(bonusPct * 100)}% BONUS on this deposit!</p>
            <p className="text-xs text-muted-foreground">Bonus applies to your first 3 deposits.</p>
          </div>
          <Badge className="bg-accent text-accent-foreground">
            Deposit #{(wallet?.depositCount ?? 0) + 1}
          </Badge>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(plans ?? []).map((p) => {
          const productId = p.play_product_id;
          const store = productId ? storePrices[productId] : undefined;
          const bonus = Math.floor(Number(p.coins) * bonusPct);
          return (
            <Card
              key={p.id}
              className="glass p-4 text-center transition-colors hover:border-primary/50"
            >
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {p.label}
              </div>
              <div className="mt-1 flex items-baseline justify-center gap-1">
                <span className="text-2xl font-bold">
                  {store?.price ?? "—"}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-center gap-1 font-semibold text-coin">
                <Coins className="size-4" /> {Number(p.coins).toLocaleString("en-IN")}
              </div>
              {bonus > 0 && (
                <p className="mt-1 text-xs text-accent">+ {bonus.toLocaleString("en-IN")} bonus</p>
              )}
              <Button
                size="sm"
                disabled={!purchasesEnabled || busy === productId}
                onClick={() => void buy(productId)}
                className="brand-gradient mt-3 w-full text-primary-foreground"
              >
                {!purchasesEnabled ? "Unavailable" : busy === productId ? "…" : "Buy"}
              </Button>
            </Card>
          );
        })}
      </div>

      {(plans ?? []).length === 0 && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Coin packs will appear here as soon as they go live.
        </p>
      )}

      <Card className="glass mt-6 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" /> Bonus tiers
        </div>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li>1st deposit — 50% bonus coins</li>
          <li>2nd deposit — 40% bonus coins</li>
          <li>3rd deposit — 30% bonus coins</li>
          <li>After that — no bonus</li>
        </ul>
      </Card>

      <p className="mt-4 text-center text-[10px] text-muted-foreground">
        Coins are virtual in-app credits with no monetary value and cannot be exchanged for
        cash. Prices shown are set by Google Play for your country. Refunds are handled by
        Google Play — see our <a className="underline" href="/refund-policy">refund policy</a>.
      </p>
    </AppShell>
  );
}
