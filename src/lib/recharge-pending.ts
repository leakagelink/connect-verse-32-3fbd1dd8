// Shared "pending external recharge" helpers used by the recharge route and
// its E2E mock. Kept in a tiny module so `tests/e2e/recharge-retry.spec.ts`
// exercises the SAME storage contract as production code — not a copy.

export const PENDING_KEY = "talkora.recharge.pending";
// Pending records older than this are considered stale and swept on read.
// Razorpay orders are short-lived, so surfacing a resume prompt for an
// hours-old plan would only confuse the user.
export const PENDING_TTL_MS = 30 * 60_000;

export type PendingRecharge = {
  planId: string;
  planLabel: string;
  startedAt: number;
  purchaseId: string;
};

export function newPurchaseId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* ignore */ }
  return `pp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function readPending(): PendingRecharge | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingRecharge>;
    if (!p?.planId || Date.now() - (p.startedAt ?? 0) > PENDING_TTL_MS) {
      window.localStorage.removeItem(PENDING_KEY);
      return null;
    }
    // Back-compat: older records may not carry a purchaseId; mint one now
    // so the next retry still dedupes against the server-side order.
    return {
      planId: p.planId,
      planLabel: p.planLabel ?? "Coin pack",
      startedAt: p.startedAt ?? Date.now(),
      purchaseId: p.purchaseId ?? newPurchaseId(),
    };
  } catch {
    return null;
  }
}

export function writePending(p: PendingRecharge) {
  try { window.localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function clearPending() {
  try { window.localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}
