import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import {
  Receipt,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Coins,
  Sparkles,
  Copy,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listMyRechargeReceipts } from "@/lib/receipts.functions";

export const Route = createFileRoute("/_authenticated/receipts")({
  head: () => ({
    meta: [
      { title: "Recharge receipts — Talkora" },
      { name: "robots", content: "noindex" },
      {
        name: "description",
        content:
          "Every Talkora coin recharge with amount, coins credited, and refund/failed status.",
      },
    ],
  }),
  component: ReceiptsPage,
});

type Status = "created" | "paid" | "credited" | "failed" | "expired" | "refunded";

const STATUS_META: Record<
  Status,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  credited: {
    label: "Coins credited",
    className: "bg-success/15 text-success border-success/30",
    icon: CheckCircle2,
  },
  paid: {
    label: "Paid — crediting",
    className: "bg-primary/10 text-primary border-primary/30",
    icon: Clock,
  },
  created: {
    label: "Awaiting payment",
    className: "bg-muted text-muted-foreground border-border",
    icon: Clock,
  },
  failed: {
    label: "Payment failed",
    className: "bg-destructive/15 text-destructive border-destructive/30",
    icon: XCircle,
  },
  expired: {
    label: "Expired",
    className: "bg-muted text-muted-foreground border-border",
    icon: AlertTriangle,
  },
  refunded: {
    label: "Refunded",
    className: "bg-warning/15 text-warning border-warning/30",
    icon: AlertTriangle,
  },
};

function formatInr(paise: number, currency: string) {
  const amount = paise / 100;
  return `${currency === "INR" ? "₹" : currency + " "}${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ReceiptsPage() {
  const listFn = useServerFn(listMyRechargeReceipts);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["receipts", "mine"],
    queryFn: () => listFn({ data: {} }),
    refetchOnWindowFocus: true,
  });

  const copy = (v: string) => {
    navigator.clipboard.writeText(v).then(
      () => toast.success("Copied"),
      () => toast.error("Could not copy"),
    );
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Recharge receipts</h1>
            <p className="text-sm text-muted-foreground">
              Every purchase, including refunds and failed payments.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh"
            >
              <RefreshCw
                className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
              />
            </Button>
            <Link to="/recharge">
              <Button size="sm">Recharge</Button>
            </Link>
          </div>
        </div>

        {isLoading ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Loading…
          </Card>
        ) : !data?.length ? (
          <Card className="p-8 text-center">
            <Receipt className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No receipts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your recharge history will appear here.
            </p>
            <Link to="/recharge" className="mt-4 inline-block">
              <Button>Buy coins</Button>
            </Link>
          </Card>
        ) : (
          <div className="space-y-3">
            {data.map((r) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.created;
              const Icon = meta.icon;
              const total = r.coinsCredited + r.bonusCredited;
              const showRetry = r.status === "failed" || r.status === "expired";
              return (
                <Card key={r.orderId} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold">
                          {r.planLabel ?? "Coin plan"}
                        </p>
                        <Badge variant="outline" className={meta.className}>
                          <Icon className="mr-1 h-3 w-3" />
                          {meta.label}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {format(new Date(r.createdAt), "dd MMM yyyy, HH:mm")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">
                        {formatInr(r.amountPaise, r.currency)}
                      </p>
                    </div>
                  </div>

                  {r.status === "credited" && (
                    <div className="mt-3 rounded-lg bg-success/5 border border-success/20 p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Coins className="h-4 w-4 text-coin" />
                        <span className="font-medium">
                          {r.coinsCredited.toLocaleString("en-IN")} coins credited
                        </span>
                      </div>
                      {r.bonusCredited > 0 && (
                        <div className="mt-1 flex items-center gap-2 text-sm text-primary">
                          <Sparkles className="h-4 w-4" />
                          <span>
                            +{r.bonusCredited.toLocaleString("en-IN")} bonus coins
                          </span>
                        </div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">
                        Total added:{" "}
                        <span className="font-medium text-foreground">
                          {total.toLocaleString("en-IN")}
                        </span>
                        {r.creditedAt && (
                          <>
                            {" · "}
                            {format(new Date(r.creditedAt), "dd MMM, HH:mm")}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {(r.status === "paid" || r.status === "created") && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {r.status === "paid"
                        ? "Payment received — coins will appear in a moment."
                        : "Complete the payment to receive your coins."}
                    </p>
                  )}

                  {(r.status === "failed" ||
                    r.status === "expired" ||
                    r.status === "refunded") && (
                    <div className="mt-3 rounded-lg bg-destructive/5 border border-destructive/20 p-3 text-sm">
                      <p className="font-medium">
                        {r.status === "refunded"
                          ? "Refunded — coins reversed."
                          : r.status === "expired"
                            ? "Order expired before payment completed."
                            : "Payment did not go through."}
                      </p>
                      {r.failureReason && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Reason: {r.failureReason}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        No coins were credited. You were not charged, or the
                        amount will be refunded to the original payment method
                        within 5–7 business days.
                      </p>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <button
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => copy(r.orderId)}
                    >
                      Order: <span className="font-mono">{r.orderId}</span>
                      <Copy className="h-3 w-3" />
                    </button>
                    {r.paymentId && (
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => copy(r.paymentId!)}
                      >
                        Payment:{" "}
                        <span className="font-mono">{r.paymentId}</span>
                        <Copy className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {showRetry && (
                    <Link to="/recharge" className="mt-3 inline-block">
                      <Button size="sm" variant="outline">
                        Try again <ExternalLink className="ml-1 h-3 w-3" />
                      </Button>
                    </Link>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        <p className="pt-2 text-center text-xs text-muted-foreground">
          Payment issues? Email support@talkoraapp.com with your Order ID.
        </p>
      </div>
    </AppShell>
  );
}
