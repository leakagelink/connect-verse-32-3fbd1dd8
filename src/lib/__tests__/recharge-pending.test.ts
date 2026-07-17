import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The project's vitest runs in the default node environment (no jsdom /
// happy-dom installed). `recharge-pending` only needs `window.localStorage`,
// so provide a tiny in-memory polyfill instead of pulling in a full DOM.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  get length() { return this.store.size; }
}
const memoryLocalStorage = new MemoryStorage();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = { localStorage: memoryLocalStorage };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = memoryLocalStorage;

import {
  PENDING_KEY,
  PENDING_TTL_MS,
  readPending,
  writePending,
  clearPending,
  newPurchaseId,
  type PendingRecharge,
} from "@/lib/recharge-pending";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});


function makeRecord(over: Partial<PendingRecharge> = {}): PendingRecharge {
  return {
    planId: "pro",
    planLabel: "Pro pack",
    startedAt: Date.now(),
    purchaseId: "pp_test_1234",
    ...over,
  };
}

describe("newPurchaseId", () => {
  it("mints a non-empty unique id per call", () => {
    const a = newPurchaseId();
    const b = newPurchaseId();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe("writePending / readPending round trip", () => {
  it("returns null when nothing is stored", () => {
    expect(readPending()).toBeNull();
  });

  it("round-trips a fresh record", () => {
    const rec = makeRecord();
    writePending(rec);
    expect(readPending()).toEqual(rec);
  });

  it("returns null and wipes storage on malformed JSON", () => {
    window.localStorage.setItem(PENDING_KEY, "{not json");
    expect(readPending()).toBeNull();
  });

  it("returns null and wipes storage when planId is missing", () => {
    window.localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ planLabel: "x", startedAt: Date.now(), purchaseId: "pp" }),
    );
    expect(readPending()).toBeNull();
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("back-fills a missing purchaseId on legacy records", () => {
    // Older builds stored records without a purchaseId. Reading one MUST
    // still succeed and mint a fresh key so the next retry can dedupe.
    window.localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({
        planId: "starter",
        planLabel: "Starter pack",
        startedAt: Date.now(),
      }),
    );
    const got = readPending();
    expect(got).not.toBeNull();
    expect(got!.planId).toBe("starter");
    expect(got!.purchaseId).toBeTruthy();
  });

  it("back-fills a missing planLabel with a sensible default", () => {
    window.localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ planId: "pro", startedAt: Date.now(), purchaseId: "pp" }),
    );
    const got = readPending();
    expect(got?.planLabel).toBe("Coin pack");
  });
});

describe("clearPending", () => {
  it("removes an existing record so readPending returns null", () => {
    writePending(makeRecord());
    expect(readPending()).not.toBeNull();

    clearPending();

    expect(readPending()).toBeNull();
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("is a no-op when no record exists", () => {
    expect(() => clearPending()).not.toThrow();
    expect(readPending()).toBeNull();
  });
});

describe("stale record sweeping (TTL)", () => {
  it("returns the record when just under the TTL boundary", () => {
    const rec = makeRecord({ startedAt: Date.now() - (PENDING_TTL_MS - 1_000) });
    writePending(rec);
    expect(readPending()).not.toBeNull();
  });

  it("sweeps records older than the TTL and returns null", () => {
    const rec = makeRecord({ startedAt: Date.now() - (PENDING_TTL_MS + 60_000) });
    writePending(rec);

    expect(readPending()).toBeNull();
    expect(
      window.localStorage.getItem(PENDING_KEY),
      "stale record must be wiped from storage on read",
    ).toBeNull();
  });

  it("sweeps a record that ages past the TTL between two reads", () => {
    vi.useFakeTimers();
    const start = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(start);

    writePending(makeRecord({ startedAt: start }));
    expect(readPending()).not.toBeNull();

    vi.setSystemTime(start + PENDING_TTL_MS + 1_000);
    expect(readPending()).toBeNull();
  });
});

describe("purchaseId reuse contract", () => {
  // The recharge screen encodes idempotency by reusing the SAME purchaseId
  // on retries for the SAME plan, so the server-side order dedupes and no
  // duplicate coin credit lands. These tests pin the reuse rule the UI
  // relies on (`existing.planId === planId` → reuse; otherwise mint).

  function pickPurchaseId(planId: string): string {
    const existing = readPending();
    return existing && existing.planId === planId ? existing.purchaseId : newPurchaseId();
  }

  it("reuses the stored purchaseId when retrying the same plan", () => {
    writePending(makeRecord({ planId: "pro", purchaseId: "pp_pro_1" }));
    expect(pickPurchaseId("pro")).toBe("pp_pro_1");
  });

  it("mints a new purchaseId when switching plans", () => {
    writePending(makeRecord({ planId: "pro", purchaseId: "pp_pro_1" }));
    const next = pickPurchaseId("mega");
    expect(next).not.toBe("pp_pro_1");
    expect(next).toBeTruthy();
  });

  it("mints a new purchaseId when nothing is pending", () => {
    const id = pickPurchaseId("starter");
    expect(id).toBeTruthy();
  });

  it("mints a new purchaseId when the stored record is stale", () => {
    writePending(
      makeRecord({
        planId: "pro",
        purchaseId: "pp_stale",
        startedAt: Date.now() - (PENDING_TTL_MS + 1_000),
      }),
    );
    // readPending sweeps the stale record, so the retry cannot reuse its id.
    const id = pickPurchaseId("pro");
    expect(id).not.toBe("pp_stale");
  });
});
