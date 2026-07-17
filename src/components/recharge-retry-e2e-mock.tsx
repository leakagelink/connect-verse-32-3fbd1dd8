import { useEffect, useRef, useState } from "react";
import {
  readPending,
  writePending,
  clearPending,
  newPurchaseId,
  type PendingRecharge,
} from "@/lib/recharge-pending";

// Minimal, unauthenticated stand-in for the recharge screen. Reproduces the
// two behaviours that `tests/e2e/recharge-retry.spec.ts` guards:
//
//   1. Retry banner: after starting an external checkout, a pending record
//      is persisted; on mount we hydrate it and render a "Resume payment"
//      prompt with the original plan label. Dismiss clears it.
//
//   2. Deep-link handoff: opening the page with `?plan=<id>&pp=<id>` seeds
//      the pending record with the caller-supplied purchaseId (idempotency
//      key) BEFORE auto-buying, so a retry dedupes against the same order.
//
// It uses the same helpers as production (`src/lib/recharge-pending.ts`),
// so any regression in storage shape / TTL / back-compat breaks both.

type Search = { plan?: string; pp?: string };

function parseSearch(): Search {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  return {
    plan: q.get("plan") ?? undefined,
    pp: q.get("pp") ?? undefined,
  };
}

const PLANS: Record<string, string> = {
  starter: "Starter pack",
  pro: "Pro pack",
  mega: "Mega pack",
};

export function RechargeRetryE2EMock() {
  const [pending, setPending] = useState<PendingRecharge | null>(null);
  const [lastBuy, setLastBuy] = useState<PendingRecharge | null>(null);
  const [autoBuyRan, setAutoBuyRan] = useState(false);
  const autoBuyTried = useRef(false);
  const search = parseSearch();

  useEffect(() => {
    setPending(readPending());
  }, []);

  function buy(planId: string, planLabel: string) {
    const existing = readPending();
    const purchaseId =
      existing && existing.planId === planId ? existing.purchaseId : newPurchaseId();
    const record: PendingRecharge = {
      planId,
      planLabel,
      startedAt: Date.now(),
      purchaseId,
    };
    writePending(record);
    setPending(record);
    setLastBuy(record);
  }

  // Deep-link auto-buy: mirrors the production flow — seed pending with the
  // caller's purchaseId (so retry keeps the same idempotency key) then buy.
  useEffect(() => {
    if (autoBuyTried.current) return;
    if (!search.plan) return;
    const label = PLANS[search.plan] ?? "Coin pack";
    autoBuyTried.current = true;
    if (search.pp) {
      writePending({
        planId: search.plan,
        planLabel: label,
        startedAt: Date.now(),
        purchaseId: search.pp,
      });
    }
    buy(search.plan, label);
    setAutoBuyRan(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div data-testid="recharge-retry-mock" style={{ padding: 16 }}>
      <h1>Recharge (E2E mock)</h1>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {Object.entries(PLANS).map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`buy-${id}`}
            onClick={() => buy(id, label)}
          >
            Buy {label}
          </button>
        ))}
      </div>

      {pending && (
        <div
          data-testid="retry-banner"
          data-plan-id={pending.planId}
          data-purchase-id={pending.purchaseId}
          style={{ marginTop: 16, padding: 8, border: "1px solid" }}
        >
          <p data-testid="retry-banner-label">
            Finish your {pending.planLabel} recharge?
          </p>
          <button
            type="button"
            data-testid="retry-resume"
            onClick={() => buy(pending.planId, pending.planLabel)}
          >
            Resume payment
          </button>
          <button
            type="button"
            data-testid="retry-dismiss"
            onClick={() => {
              clearPending();
              setPending(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {lastBuy && (
        <div
          data-testid="last-buy"
          data-plan-id={lastBuy.planId}
          data-purchase-id={lastBuy.purchaseId}
        >
          last buy: {lastBuy.planId} / {lastBuy.purchaseId}
        </div>
      )}

      <div data-testid="auto-buy-ran">{autoBuyRan ? "yes" : "no"}</div>
    </div>
  );
}
