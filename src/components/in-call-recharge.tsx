import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Coins, Gift, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { listPlans, mockRecharge, getWallet } from "@/lib/wallet.functions";
import { bonusForDeposit } from "@/lib/constants";
import { parseRechargeError, type ParsedRechargeError } from "@/lib/recharge-errors";
import { RechargeHelpDialog } from "./recharge-help-dialog";
import { HelpCircle } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Minimum coins required for the action the user is trying to perform. Used to surface a "covers your case" hint. */
  requiredCoins?: number;
  /** Called after a successful recharge so the caller can refresh derived state. */
  onRecharged?: (newBalance: number, meta?: RechargeMeta) => void;
};

export type RechargeMeta = {
  planId: string;
  /** Mock has no order_id; Razorpay path passes the real one. */
  orderId?: string;
  paymentId?: string;
  source: "mock" | "razorpay";
  /** Client clock — request fired. */
  requestedAt: number;
  /** Client clock — server responded with credited balance. */
  serverRespondedAt: number;
  /** Client clock — wallet query refetched + onRecharged delivered. */
  uiRefreshedAt: number;
  added: number;
  bonus: number;
  newBalance: number;
};

export function InCallRecharge({ open, onOpenChange, requiredCoins, onRecharged }: Props) {
  const qc = useQueryClient();
  const plansFn = useServerFn(listPlans);
  const walletFn = useServerFn(getWallet);
  const rechargeFn = useServerFn(mockRecharge);

  const { data: plans } = useQuery({ queryKey: ["plans"], queryFn: () => plansFn(), enabled: open });
  const { data: wallet } = useQuery({ queryKey: ["wallet"], queryFn: () => walletFn(), enabled: open });
  const [busy, setBusy] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpError, setHelpError] = useState<ParsedRechargeError | null>(null);
  const [helpPlanId, setHelpPlanId] = useState<string | null>(null);

  const bonusPct = bonusForDeposit(wallet?.depositCount ?? 0);
  const balance = wallet?.balance ?? 0;

  const refreshBalance = async () => {
    await qc.invalidateQueries({ queryKey: ["wallet"] });
    const fresh = await walletFn().catch(() => null);
    if (fresh) onRecharged?.(fresh.balance ?? 0);
  };

  function openHelp(err: ParsedRechargeError, planId: string) {
    setHelpError(err);
    setHelpPlanId(planId);
    setHelpOpen(true);
  }


  async function buy(planId: string) {
    setBusy(planId);
    const requestedAt = Date.now();
    try {
      const r = await rechargeFn({ data: { planId } });
      const serverRespondedAt = Date.now();
      toast.success(`+${r.added.toLocaleString("en-IN")} coins${r.bonus > 0 ? ` (+${r.bonus} bonus)` : ""}`);
      // Refresh everything that depends on balance
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["wallet"] }),
        qc.invalidateQueries({ queryKey: ["me"] }),
      ]);
      const fresh = await walletFn();
      const uiRefreshedAt = Date.now();
      onRecharged?.(fresh?.balance ?? 0, {
        planId,
        source: "mock",
        requestedAt,
        serverRespondedAt,
        uiRefreshedAt,
        added: r.added,
        bonus: r.bonus,
        newBalance: fresh?.balance ?? 0,
      });
      // Auto-close when the user has enough for the gated action
      if (!requiredCoins || (fresh?.balance ?? 0) >= requiredCoins) {
        setTimeout(() => onOpenChange(false), 600);
      }
    } catch (e: any) {
      const parsed = parseRechargeError(e);

      // Silently refresh in case the charge actually landed (ALREADY_PURCHASED / partial).
      if (parsed.code === "ALREADY_PURCHASED") void refreshBalance();

      // Whole toast click opens detailed help. Action button = quick "View help" CTA.
      toast.error(`${parsed.title} (${parsed.code})`, {
        description: `${parsed.description} Tap for help & next steps — your call stays connected.`,
        duration: 12000,
        onAutoClose: () => {},
        // Make the toast body itself clickable
        onDismiss: () => {},
        action: {
          label: "View help",
          onClick: () => openHelp(parsed, planId),
        },
        cancel: { label: "Close", onClick: () => {} },
        // sonner forwards className to the toast root; we use it to add a pointer cursor
        className: "cursor-pointer",
        // Clicking anywhere on the toast opens the help dialog
        onClick: () => openHelp(parsed, planId),
      } as any);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <Coins className="size-5 text-coin" /> Recharge without leaving the call
          </SheetTitle>
          <SheetDescription>
            Your call stays connected. After buying, the Host Mystery button refreshes automatically.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="flex items-center gap-1">
            <Coins className="size-4 text-coin" /> Balance:{" "}
            <span className="font-semibold text-foreground">{balance.toLocaleString("en-IN")}</span>
          </span>
          {requiredCoins != null && (
            <span className={balance >= requiredCoins ? "text-emerald-500" : "text-destructive"}>
              {balance >= requiredCoins
                ? "Ready to host"
                : `Need ${(requiredCoins - balance).toLocaleString("en-IN")} more`}
            </span>
          )}
        </div>

        {bonusPct > 0 && (
          <Card className="glass mt-3 p-3 flex items-center gap-3 border-accent/40">
            <Gift className="size-5 text-accent shrink-0" />
            <div className="flex-1 text-sm">
              <p className="font-medium">{Math.round(bonusPct * 100)}% BONUS on this deposit!</p>
              <p className="text-xs text-muted-foreground">Limited bonus on your first 3 deposits.</p>
            </div>
            <Badge className="bg-accent text-accent-foreground">#{(wallet?.depositCount ?? 0) + 1}</Badge>
          </Card>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 pb-4">
          {(plans ?? []).map((p) => {
            const bonus = Math.floor(Number(p.coins) * bonusPct);
            const covers = requiredCoins == null ? false : balance + Number(p.coins) + bonus >= requiredCoins;
            return (
              <Card
                key={p.id}
                className={`glass p-3 text-center transition-colors ${
                  covers ? "border-primary/60 ring-1 ring-primary/30" : "hover:border-primary/40"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.label}</div>
                <div className="mt-1 text-xl font-bold">
                  ₹{Number(p.price_inr).toLocaleString("en-IN")}
                </div>
                <div className="mt-1 flex items-center justify-center gap-1 text-coin text-sm font-semibold">
                  <Coins className="size-3.5" /> {Number(p.coins).toLocaleString("en-IN")}
                </div>
                {bonus > 0 && (
                  <p className="mt-0.5 text-[11px] text-accent">+ {bonus.toLocaleString("en-IN")} bonus</p>
                )}
                <Button
                  size="sm"
                  disabled={busy === p.id}
                  onClick={() => buy(p.id)}
                  className="mt-2 w-full brand-gradient text-primary-foreground"
                >
                  {busy === p.id ? "…" : "Buy"}
                </Button>
              </Card>
            );
          })}
        </div>

        <p className="pb-4 text-[11px] text-muted-foreground flex items-center gap-1">
          <Sparkles className="size-3" /> Mock recharge — real payments in Phase 3.
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
            onClick={() =>
              openHelp(
                {
                  code: "UNKNOWN",
                  title: "Recharge help",
                  description: "Common recharge issues and how to resolve them while staying in your call.",
                  nextStepLabel: "Close",
                  nextStep: "retry",
                },
                "",
              )
            }
          >
            <HelpCircle className="size-3" /> Need help?
          </button>
        </p>
      </SheetContent>

      <RechargeHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        error={helpError}
        planId={helpPlanId}
        onRetry={(pid) => void buy(pid)}
        onRefreshBalance={() => void refreshBalance()}
        onPickAnotherPlan={() => {
          /* sheet is already open with plan grid; just close dialog */
        }}
        onReauth={() => {
          window.location.href = "/auth";
        }}
      />
    </Sheet>
  );
}
