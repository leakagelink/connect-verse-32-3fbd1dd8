// Stale-reservation aware retry wrapper for acceptCallInvite.
//
// Heartbeat-based reconciler (refreshStaleBusy) runs server-side, but it
// can only clear an "accepted" ghost row once the heartbeat is >60s silent.
// A user tapping "Answer" exactly when the previous call session is still
// within that window will hit either:
//   - "This creator just picked up another call." (genuine OR ghost reservation)
//   - "This call is no longer ringing." (server cleaned the ghost mid-retry)
//   - 23505 unique conflict bubbling through (rare race)
//
// We retry the accept a couple of times with a short backoff so the server's
// cleanup pass and the heartbeat threshold have a chance to free the slot,
// and surface a "Reconnecting…" state to the UI via the onAttempt callback.

export type AcceptRetryAttempt = {
  attempt: number; // 1-indexed
  maxAttempts: number;
  reason: "initial" | "stale-busy" | "no-longer-ringing" | "unknown-conflict";
};

const STALE_PATTERNS = [
  /picked up another call/i,
  /no longer ringing/i,
  /one_accepted_per_callee/i,
  /duplicate key/i,
  /23505/,
];

export function isStaleReservationError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  const code = String((err as any)?.code ?? "");
  if (code === "23505") return true;
  return STALE_PATTERNS.some((re) => re.test(msg));
}

export async function acceptInviteWithRetry<T>(
  acceptFn: (args: { data: { inviteId: string } }) => Promise<T>,
  inviteId: string,
  opts: {
    maxAttempts?: number;
    backoffMs?: number[];
    onAttempt?: (info: AcceptRetryAttempt) => void;
  } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  // Server's STALE_HEARTBEAT_MS is 60s; we can't outwait it, but spacing
  // retries lets the server's own refresh-and-retry cycle re-run.
  const backoffMs = opts.backoffMs ?? [0, 1500, 3500];
  let lastErr: unknown = null;
  for (let i = 0; i < maxAttempts; i++) {
    const reason: AcceptRetryAttempt["reason"] =
      i === 0
        ? "initial"
        : /picked up another call/i.test(String((lastErr as any)?.message ?? ""))
          ? "stale-busy"
          : /no longer ringing/i.test(String((lastErr as any)?.message ?? ""))
            ? "no-longer-ringing"
            : "unknown-conflict";
    opts.onAttempt?.({ attempt: i + 1, maxAttempts, reason });
    const delay = backoffMs[i] ?? backoffMs[backoffMs.length - 1] ?? 0;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      return await acceptFn({ data: { inviteId } });
    } catch (e) {
      lastErr = e;
      if (!isStaleReservationError(e)) throw e;
      if (i === maxAttempts - 1) throw e;
    }
  }
  throw lastErr ?? new Error("Could not accept call.");
}
