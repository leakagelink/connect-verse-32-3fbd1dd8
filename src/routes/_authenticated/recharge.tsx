import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPlans, getWallet, mockRecharge } from "@/lib/wallet.functions";
import { createRazorpayOrder, verifyRazorpayPayment } from "@/lib/razorpay.functions";
import { getPaymentConfig } from "@/lib/payments.functions";
import { getMyProfile } from "@/lib/onboarding.functions";
import { createAutoLoginUrl } from "@/lib/auto-login.functions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Coins, Sparkles, Gift, ShieldCheck, FlaskConical, ExternalLink, RefreshCw, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { bonusForDeposit, APP_NAME, PAYMENTS_MAINTENANCE } from "@/lib/constants";
import { Wrench } from "lucide-react";
import { openRazorpay } from "@/lib/razorpay-client";
import { isNative, openExternalUrl } from "@/lib/native";

// Deep-link params. `plan` is preselected (e.g. magic-link handoff from the
// Android app → website). `src=android` lets us tell handoffs apart from
// regular website visits. `resume=1` is set when we bounce the user back
// into a retry flow after an interrupted external checkout.
const SearchSchema = z.object({
  plan: z.string().min(1).max(100).optional(),
  src: z.string().max(50).optional(),
  resume: z.union([z.literal("1"), z.literal("0")]).optional(),
  // Client-generated idempotency key forwarded via deep link so the website
  // side of the magic-link handoff uses the same key when creating the order.
  pp: z.string().min(8).max(80).optional(),
}).partial();

export const Route = createFileRoute("/_authenticated/recharge")({
  validateSearch: (s) => SearchSchema.parse(s ?? {}),
  component: Recharge,
});

// Pending-recharge storage helpers (see `src/lib/recharge-pending.ts`) live
// in a shared module so `tests/e2e/recharge-retry.spec.ts` exercises the
// exact same contract as production.
import {
  readPending,
  writePending,
  clearPending,
  newPurchaseId,
  type PendingRecharge,
} from "@/lib/recharge-pending";


function Recharge() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const plansFn = useServerFn(listPlans);
  const walletFn = useServerFn(getWallet);
  const profileFn = useServerFn(getMyProfile);
  const createOrderFn = useServerFn(createRazorpayOrder);
  const verifyFn = useServerFn(verifyRazorpayPayment);
  const mockFn = useServerFn(mockRecharge);
  const cfgFn = useServerFn(getPaymentConfig);
  const autoLoginFn = useServerFn(createAutoLoginUrl);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });
  const { data: plans } = useQuery({ queryKey: ["plans"], queryFn: () => plansFn() });
  const { data: wallet } = useQuery({ queryKey: ["wallet"], queryFn: () => walletFn() });
  const { data: cfg } = useQuery({ queryKey: ["payment-config"], queryFn: () => cfgFn() });
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Non-null while a previous external checkout was started but never confirmed
  // credited — drives the "Resume payment" retry banner. Hydrated from
  // localStorage on mount so a full app restart still surfaces the prompt.
  const [pending, setPending] = useState<PendingRecharge | null>(null);

  const bonusPct = bonusForDeposit(wallet?.depositCount ?? 0);
  const isTest = cfg?.mode !== "live";
  const native = isNative();
  // Play Store policy: on the Android build, live purchases must NOT go through
  // in-app alternative billing. Route to the website instead. Test mode stays
  // in-app so QA can still credit coins without real money.
  const useExternalCheckout = native && !isTest;


  /**
   * Re-fetch wallet + payment config, retrying a few times because the webhook
   * from Razorpay can lag a few seconds behind the user's redirect back to the
   * app. Compares the balance before/after so we can tell the user whether
   * anything actually landed. Safe to call from anywhere (auto-resume or the
   * manual "Sync coins" button).
   */
  async function syncCoins(opts?: { silent?: boolean }): Promise<boolean> {
    if (syncing) return false;
    setSyncing(true);
    const before = wallet?.balance ?? 0;
    const attempts = [0, 1500, 3000, 5000, 8000]; // ms — total ~17s
    let landed = false;
    try {
      for (let i = 0; i < attempts.length; i++) {
        if (attempts[i]) await new Promise((r) => setTimeout(r, attempts[i]));
        await qc.invalidateQueries({ queryKey: ["wallet"] });
        await qc.invalidateQueries({ queryKey: ["payment-config"] });
        const fresh = await walletFn().catch(() => null);
        const after = fresh?.balance ?? before;
        if (after > before) {
          landed = true;
          const delta = after - before;
          toast.success(`+${delta.toLocaleString("en-IN")} coins credited`, {
            description: `New balance: ${after.toLocaleString("en-IN")}`,
          });
          // Payment confirmed — drop any pending retry record.
          clearPending();
          setPending(null);
          break;
        }
      }
      if (!landed && !opts?.silent) {
        toast.info("No new coins yet", {
          description: "If you just paid, it can take up to a minute. Tap Sync again shortly.",
        });
      }
    } finally {
      setSyncing(false);
    }
    return landed;
  }

  // Hydrate pending-recharge state from localStorage on mount so a browser
  // closed early, an app kill, or a failed return-sync still surfaces the
  // "Resume payment" prompt without losing the user's plan choice.
  useEffect(() => {
    setPending(readPending());
  }, []);

  // When the user returns from the external browser after paying, auto-sync
  // (silent — no toast if nothing landed) so the balance updates without a tap.
  // If we still have a pending record after the sync attempts, keep showing
  // the retry banner so the user can resume without losing the plan choice.
  useEffect(() => {
    if (!native) return;
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const sub = await App.addListener("appStateChange", async (state) => {
          if (!state.isActive) return;
          const credited = await syncCoins({ silent: true });
          if (!credited) setPending(readPending());
        });
        cleanup = () => sub.remove();
      } catch { /* ignore */ }
    })();
    return () => cleanup?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native]);


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

      // Reuse the purchaseId from any live pending record for the SAME plan,
      // so a "Resume payment" tap dedupes against the server-side order —
      // even after a browser close, app kill, or accidental double tap.
      const existing = readPending();
      const purchaseId =
        existing && existing.planId === planId ? existing.purchaseId : newPurchaseId();

      if (useExternalCheckout) {
        // Open the same /recharge page in the system browser. To avoid a
        // second sign-in, we mint a short-lived Supabase magic link server-
        // side; opening it signs the user into the website and lands them on
        // /recharge with the chosen plan preselected. Coins auto-sync via the
        // appStateChange listener above when they return.
        // Persist the plan choice BEFORE launching the browser so that if the
        // user closes the tab early / the return-sync finds nothing, we can
        // still show a "Resume payment" prompt with the right plan.
        const record: PendingRecharge = { planId, planLabel, startedAt: Date.now(), purchaseId };
        writePending(record);
        setPending(record);
        const redirectPath = `/recharge?plan=${encodeURIComponent(planId)}&src=android&resume=1&pp=${encodeURIComponent(purchaseId)}`;
        let url = `https://talkoraapp.com${redirectPath}`;
        try {
          const r = await autoLoginFn({ data: { redirectPath } });
          if (r?.url) url = r.url;
        } catch {
          // Fall back to plain URL — user will sign in on the website.
        }
        await openExternalUrl(url);
        toast.info("Opening secure browser for payment", {
          description: "Complete your recharge in the browser. Coins will appear here automatically when you return.",
          duration: 8000,
        });
        setBusy(null);
        return;
      }



      const order = await createOrderFn({ data: { planId, purchaseId } });
      // Persist so a page reload / crash between order creation and the
      // Razorpay callback still dedupes on retry.
      writePending({ planId, planLabel, startedAt: Date.now(), purchaseId });
      await openRazorpay({
        keyId: order.keyId,
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: APP_NAME,
        description: `${planLabel} coin pack`,
        prefillName: order.username || undefined,
        onSuccess: async (resp) => {
          // Hand off to the status screen immediately so the user sees a clear
          // pending/success/failed state. Verification + wallet refresh still
          // run here for instant credit; the status screen polls the order in
          // case the webhook is slower than the redirect.
          // Also clear any pending-retry record — this checkout completed.
          clearPending();
          setPending(null);
          navigate({
            to: "/recharge/status",
            search: { orderId: order.orderId },
          });
          try {
            await verifyFn({ data: resp });
            qc.invalidateQueries({ queryKey: ["wallet"] });
            qc.invalidateQueries({ queryKey: ["recharge-order", order.orderId] });
          } catch (e: any) {
            // Non-fatal — the webhook will still credit. Status screen surfaces the outcome.
            console.warn("verifyRazorpayPayment failed", e);
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

  // Deep-link auto-buy: when the website is opened with `?plan=<id>` (from
  // the Android magic-link handoff, or a saved deep link), auto-open Razorpay
  // for that plan as soon as plans + config are ready. Runs at most once per
  // page load; native app itself ignores this because it re-launches the
  // browser rather than opening checkout in-place.
  const autoBuyTried = useRef(false);
  useEffect(() => {
    if (autoBuyTried.current) return;
    if (native) return; // native shell reopens browser; don't loop
    if (!search.plan) return;
    if (!plans || !cfg) return;
    if (busy) return;
    const plan = plans.find((p) => p.id === search.plan);
    if (!plan) return;
    autoBuyTried.current = true;
    // Seed the pending record with the deep-link purchaseId so buy() reuses
    // the same idempotency key server-side and doesn't create a duplicate.
    if (search.pp) {
      writePending({ planId: plan.id, planLabel: plan.label ?? "Coin pack", startedAt: Date.now(), purchaseId: search.pp });
    }
    // Strip the deep-link params from the URL so a refresh doesn't re-trigger.
    navigate({ to: "/recharge", search: {}, replace: true });
    void buy(plan.id, plan.label ?? "Coin pack");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.plan, plans, cfg, native, busy]);


  return (
    <AppShell isAdmin={me?.isAdmin}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Recharge coins</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="size-3.5 text-primary" /> Secure payments via Razorpay — UPI, Cards, NetBanking, Wallets.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void syncCoins()}
          disabled={syncing}
          className="shrink-0"
        >
          <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
          <span className="ml-1.5">{syncing ? "Syncing…" : "Sync coins"}</span>
        </Button>
      </div>

      {isTest && (
        <Card className="glass mt-4 p-3 flex items-center gap-2 border-warning/40 bg-warning/5">
          <FlaskConical className="size-4 text-warning" />
          <div className="flex-1 text-xs">
            <p className="font-semibold">Test mode active</p>
            <p className="text-muted-foreground">No real money is charged. Coins credit instantly for testing. Admin can enable live payments from Admin → Payments.</p>
          </div>
        </Card>
      )}

      {useExternalCheckout && (
        <Card className="glass mt-4 p-3 flex items-center gap-2 border-primary/40 bg-primary/5">
          <ExternalLink className="size-4 text-primary shrink-0" />
          <div className="flex-1 text-xs">
            <p className="font-semibold">Recharge opens in your browser</p>
            <p className="text-muted-foreground">For your safety and to comply with Play Store rules, coin purchases complete in your default browser. Coins will appear here automatically when you return — or tap <span className="font-semibold">Sync coins</span>.</p>
          </div>
        </Card>
      )}

      {pending && (
        <Card className="glass mt-4 p-3 border-warning/50 bg-warning/5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-xs">
              <p className="font-semibold">Finish your {pending.planLabel} recharge?</p>
              <p className="text-muted-foreground mt-0.5">
                We didn't confirm your last payment yet. If you closed the browser
                early, tap <span className="font-semibold">Resume payment</span> to
                try again with the same plan — you won't be charged twice.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="brand-gradient text-primary-foreground h-8"
                  disabled={busy === pending.planId}
                  onClick={() => buy(pending.planId, pending.planLabel)}
                >
                  {busy === pending.planId ? "…" : "Resume payment"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={syncing}
                  onClick={() => void syncCoins()}
                >
                  <RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />
                  <span className="ml-1.5">Check status</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-muted-foreground"
                  onClick={() => { clearPending(); setPending(null); }}
                >
                  <X className="size-3.5" />
                  <span className="ml-1">Dismiss</span>
                </Button>
              </div>
            </div>
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
                {busy === p.id ? "…" : useExternalCheckout ? "Buy in browser" : "Buy"}
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
