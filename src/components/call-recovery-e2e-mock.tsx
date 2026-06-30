import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CallControlsClickableE2EMock } from "@/components/call-controls-e2e-mock";

// Headless mock for tests/e2e/call-recovery-after-kill.spec.ts.
//
// Reproduces the real-world bug:
//   1. Caller (Dheeraj) and creator (Anika) connect a call.
//   2. Both apps are force-closed mid-connect — leaving an orphan
//      "accepted" invite + open call_log (ended_at = NULL) on the server.
//   3. Caller re-launches and calls the same creator again.
//
// Before the fix, step 3 would never reach `connected` because the stale
// state poisoned busy-detection and the partial-unique index. This mock
// models the same lifecycle in-memory and verifies the new reconciler
// behaviour: a fresh "start" after a force-kill must reach connected and
// the five call controls must all work.
type Phase =
  | "idle"
  | "round1-connecting"
  | "round1-connected"
  | "killed"
  | "round2-connecting"
  | "round2-connected";

interface FakeServerState {
  invites: Array<{ id: string; status: "pending" | "accepted" | "cancelled"; created: number; heartbeat: number | null }>;
  logs: Array<{ id: string; ended_at: number | null; heartbeat: number | null }>;
}

const STALE_MS = 60_000;

function reconcile(state: FakeServerState, nowMs: number): FakeServerState {
  // Mirrors src/lib/call-invites.functions.ts refreshStaleBusy:
  // - Cancel stale accepted invites whose heartbeat is silent for >60s
  // - Close orphan call_logs with ended_at = NULL whose heartbeat is silent for >60s
  const invites = state.invites.map((i) => {
    if (i.status !== "accepted") return i;
    const last = i.heartbeat ?? i.created;
    if (nowMs - last > STALE_MS) return { ...i, status: "cancelled" as const };
    return i;
  });
  const logs = state.logs.map((l) => {
    if (l.ended_at !== null) return l;
    const last = l.heartbeat ?? 0;
    if (nowMs - last > STALE_MS) return { ...l, ended_at: nowMs };
    return l;
  });
  return { invites, logs };
}

function hasBlockingState(state: FakeServerState): boolean {
  const acceptedAlive = state.invites.some((i) => i.status === "accepted");
  const logOpen = state.logs.some((l) => l.ended_at === null);
  return acceptedAlive || logOpen;
}

export function CallRecoveryE2EMock() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [serverState, setServerState] = useState<FakeServerState>({ invites: [], logs: [] });
  const [round2Error, setRound2Error] = useState<string | null>(null);
  const advanceTimer = useRef<number | null>(null);

  // Simulated wall-clock for the fake server. The "force-close" jump
  // pushes this >60s into the future so the reconciler treats orphan
  // state as stale on the next call attempt.
  const fakeNowRef = useRef<number>(Date.now());

  const cleanupTimer = () => {
    if (advanceTimer.current) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  };
  useEffect(() => cleanupTimer, []);

  const startRound1 = () => {
    const now = fakeNowRef.current;
    const invite = { id: "inv-1", status: "pending" as const, created: now, heartbeat: now };
    setServerState({ invites: [invite], logs: [] });
    setPhase("round1-connecting");
    advanceTimer.current = window.setTimeout(() => {
      // Simulate accept + call_log creation
      setServerState((s) => ({
        invites: s.invites.map((i) => (i.id === "inv-1" ? { ...i, status: "accepted" } : i)),
        logs: [{ id: "log-1", ended_at: null, heartbeat: fakeNowRef.current }],
      }));
      setPhase("round1-connected");
    }, 150);
  };

  const forceCloseBoth = () => {
    cleanupTimer();
    // Both apps die mid-call: no end-call RPC fires, no heartbeat sent,
    // no cancelled_at written. Server keeps the accepted invite + open
    // call_log exactly as they were. Then time passes (user reopens the
    // app a minute later).
    fakeNowRef.current = fakeNowRef.current + STALE_MS + 5_000;
    setPhase("killed");
  };

  const startRound2 = () => {
    setRound2Error(null);
    const now = fakeNowRef.current;
    // Reconcile before busy-check (mirrors createCallInvite pre-flight).
    const reconciled = reconcile(serverState, now);
    if (hasBlockingState(reconciled)) {
      setRound2Error("BUSY: stale state not cleaned");
      setServerState(reconciled);
      return;
    }
    const invite = { id: "inv-2", status: "pending" as const, created: now, heartbeat: now };
    setServerState({
      invites: [...reconciled.invites, invite],
      logs: reconciled.logs,
    });
    setPhase("round2-connecting");
    advanceTimer.current = window.setTimeout(() => {
      setServerState((s) => ({
        invites: s.invites.map((i) => (i.id === "inv-2" ? { ...i, status: "accepted" } : i)),
        logs: [...s.logs, { id: "log-2", ended_at: null, heartbeat: fakeNowRef.current }],
      }));
      setPhase("round2-connected");
    }, 150);
  };

  return (
    <div
      data-testid="call-recovery-root"
      data-phase={phase}
      data-round2-error={round2Error ?? ""}
      data-invites-accepted={serverState.invites.filter((i) => i.status === "accepted").length}
      data-logs-open={serverState.logs.filter((l) => l.ended_at === null).length}
      className="min-h-screen bg-background text-foreground p-4 space-y-4"
    >
      <div className="flex flex-wrap gap-2">
        <Button data-testid="btn-round1" onClick={startRound1} disabled={phase !== "idle"}>
          Start round 1 (caller → creator)
        </Button>
        <Button
          data-testid="btn-force-close"
          variant="destructive"
          onClick={forceCloseBoth}
          disabled={phase !== "round1-connected"}
        >
          Force-close both apps
        </Button>
        <Button
          data-testid="btn-round2"
          onClick={startRound2}
          disabled={phase !== "killed"}
        >
          Start round 2 (same pair)
        </Button>
      </div>

      <div data-testid="phase-readout" className="text-sm text-muted-foreground">
        Phase: {phase}
        {round2Error ? <span data-testid="round2-error"> — {round2Error}</span> : null}
      </div>

      {phase === "round2-connected" ? (
        <div data-testid="round2-controls-wrap">
          <CallControlsClickableE2EMock />
        </div>
      ) : null}
    </div>
  );
}
