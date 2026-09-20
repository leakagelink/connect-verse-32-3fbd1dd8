import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Coins, Gift as GiftIcon, Loader2 } from "lucide-react";
import { listGifts, sendGift } from "@/lib/gifts.functions";
import { GIFTS_ENABLED } from "@/lib/feature-flags";

export type GiftSendEvent = {
  giftId: string;
  giftName: string;
  giftEmoji: string;
  cost: number;
  requestedAt: number;
  serverRespondedAt: number;
  uiRefreshedAt: number;
  preBalance: number;          // sender balance shown in UI before send
  newBalance: number;          // sender balance returned by server
  serverProcessedMs?: number;
  receiverPreBalance?: number;
  receiverNewBalance?: number;
  ok: boolean;
  error?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  receiverId: string;
  callLogId: string | null;
  balance: number;
  onSent?: (newBalance: number) => void;
  onLowBalance?: () => void;
  onEvent?: (event: GiftSendEvent) => void;
};

export function GiftPanel(props: Props) {
  // Gifts cost coins — not available in the free release.
  if (!GIFTS_ENABLED) return null;
  return <GiftPanelInner {...props} />;
}

function GiftPanelInner({ open, onOpenChange, receiverId, callLogId, balance, onSent, onLowBalance, onEvent }: Props) {
  const listFn = useServerFn(listGifts);
  const sendFn = useServerFn(sendGift);
  const qc = useQueryClient();
  const [sendingId, setSendingId] = useState<string | null>(null);

  const { data: gifts, isLoading } = useQuery({
    queryKey: ["gift-catalog"],
    queryFn: () => listFn(),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  async function handleSend(giftId: string, cost: number) {
    const giftMeta = (gifts ?? []).find((g) => g.id === giftId);
    const giftName = giftMeta?.name ?? "Gift";
    const giftEmoji = giftMeta?.emoji ?? "🎁";
    const requestedAt = Date.now();
    console.log("[gift-client] requested", { giftId, giftName, cost, receiverId, callLogId, balance, at: requestedAt });

    if (balance < cost) {
      console.warn("[gift-client] insufficient_local", { balance, cost });
      toast.error(`Need ${cost} coins · you have ${balance}`);
      onLowBalance?.();
      onEvent?.({
        giftId, giftName, giftEmoji, cost,
        requestedAt, serverRespondedAt: requestedAt, uiRefreshedAt: requestedAt,
        preBalance: balance, newBalance: balance,
        ok: false, error: "insufficient_local",
      });
      return;
    }
    setSendingId(giftId);
    try {
      const res = await sendFn({ data: { giftId, receiverId, callLogId } });
      const serverRespondedAt = Date.now();
      console.log("[gift-client] server_ok", {
        giftId, cost,
        serverProcessedMs: res.serverProcessedMs,
        roundtripMs: serverRespondedAt - requestedAt,
        preBalance: res.preBalance,
        newBalance: res.newBalance,
        receiverPreBalance: res.receiverPreBalance,
        receiverNewBalance: res.receiverNewBalance,
      });
      toast.success(`Sent ${res.gift.emoji} ${res.gift.name} · -${res.gift.coin_cost} coins`);
      onSent?.(res.newBalance);
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      const uiRefreshedAt = Date.now();
      console.log("[gift-client] ui_refreshed", { totalMs: uiRefreshedAt - requestedAt });
      onEvent?.({
        giftId, giftName: res.gift.name, giftEmoji: res.gift.emoji, cost: res.gift.coin_cost,
        requestedAt, serverRespondedAt, uiRefreshedAt,
        preBalance: res.preBalance ?? balance,
        newBalance: res.newBalance,
        serverProcessedMs: res.serverProcessedMs,
        receiverPreBalance: res.receiverPreBalance,
        receiverNewBalance: res.receiverNewBalance,
        ok: true,
      });
    } catch (e) {
      const serverRespondedAt = Date.now();
      const msg = e instanceof Error ? e.message : "Could not send gift";
      console.error("[gift-client] error", { giftId, cost, msg, roundtripMs: serverRespondedAt - requestedAt });
      toast.error(msg);
      onEvent?.({
        giftId, giftName, giftEmoji, cost,
        requestedAt, serverRespondedAt, uiRefreshedAt: serverRespondedAt,
        preBalance: balance, newBalance: balance,
        ok: false, error: msg,
      });
    } finally {
      setSendingId(null);
    }
  }


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <GiftIcon className="size-4 text-primary" /> Send a gift
          </SheetTitle>
        </SheetHeader>
        <div className="flex items-center justify-between mt-2 mb-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Coins className="size-3" /> Your balance: <span className="font-medium text-foreground">{balance}</span> coins</span>
          <span>Coins are deducted instantly</span>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin inline mr-1" /> Loading gifts…
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 pb-4">
            {(gifts ?? []).map((g) => {
              const afford = balance >= g.coin_cost;
              const sending = sendingId === g.id;
              return (
                <Button
                  key={g.id}
                  variant="outline"
                  disabled={sending || !!sendingId}
                  onClick={() => handleSend(g.id, g.coin_cost)}
                  className={`flex flex-col h-auto py-3 gap-0.5 ${!afford ? "opacity-60" : ""}`}
                >
                  <span className="text-2xl leading-none">{g.emoji}</span>
                  <span className="text-[11px] font-medium truncate w-full">{g.name}</span>
                  <span className={`text-[10px] flex items-center gap-0.5 ${afford ? "text-muted-foreground" : "text-destructive"}`}>
                    <Coins className="size-2.5" /> {g.coin_cost}
                  </span>
                  {sending && <Loader2 className="size-3 animate-spin mt-0.5" />}
                </Button>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
