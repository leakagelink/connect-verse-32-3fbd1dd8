import { useEffect, useRef, useState } from "react";

type Props = {
  connected: boolean;
  remoteJoined: boolean;
  everConnected: boolean;
  elapsed: number;
  connectedAtMs: number | null;
  myId: string;
  peerId: string;
};

function fmtAbs(ts: number | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}
function fmtDelta(a: number | null, b: number | null) {
  if (!a || !b) return "—";
  const ms = a - b;
  const sign = ms >= 0 ? "+" : "-";
  return `${sign}${Math.abs(ms)}ms`;
}

/**
 * Floating overlay that records the exact wall-clock moment each timer-
 * relevant flag first flipped true on THIS client, plus when the server
 * anchor (`connected_at`) landed and when the local tick first fired.
 *
 * Open the same call on both sides with `?timerDebug=1` (or
 * `localStorage.setItem("timerDebug","1")`) and compare the rows — they
 * should agree on `Anchor (server)` exactly, and the live `Elapsed` value
 * should be identical to within ±1s.
 */
export function TimerDebugOverlay({
  connected,
  remoteJoined,
  everConnected,
  elapsed,
  connectedAtMs,
  myId,
  peerId,
}: Props) {
  const connectedAtRef = useRef<number | null>(null);
  const remoteJoinedAtRef = useRef<number | null>(null);
  const everConnectedAtRef = useRef<number | null>(null);
  const anchorReceivedAtRef = useRef<number | null>(null);
  const firstTickAtRef = useRef<number | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    if (connected && !connectedAtRef.current) {
      connectedAtRef.current = Date.now();
      force((n) => n + 1);
    }
  }, [connected]);
  useEffect(() => {
    if (remoteJoined && !remoteJoinedAtRef.current) {
      remoteJoinedAtRef.current = Date.now();
      force((n) => n + 1);
    }
  }, [remoteJoined]);
  useEffect(() => {
    if (everConnected && !everConnectedAtRef.current) {
      everConnectedAtRef.current = Date.now();
      force((n) => n + 1);
    }
  }, [everConnected]);
  useEffect(() => {
    if (connectedAtMs != null && !anchorReceivedAtRef.current) {
      anchorReceivedAtRef.current = Date.now();
      force((n) => n + 1);
    }
  }, [connectedAtMs]);
  useEffect(() => {
    if (elapsed > 0 && !firstTickAtRef.current) {
      firstTickAtRef.current = Date.now();
      force((n) => n + 1);
    }
  }, [elapsed]);

  // Lightweight 1Hz repaint so the "Live elapsed" row stays current even
  // when nothing else re-renders this overlay.
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const c = connectedAtRef.current;
  const r = remoteJoinedAtRef.current;
  const e = everConnectedAtRef.current;
  const a = anchorReceivedAtRef.current;
  const f = firstTickAtRef.current;
  const anchorClient = connectedAtMs;
  const liveElapsedMs = anchorClient ? Date.now() - anchorClient : null;

  return (
    <div
      className="fixed top-2 right-2 z-[90] pointer-events-none select-none rounded-md bg-black/80 text-white text-[10px] leading-tight font-mono px-2 py-1.5 max-w-[280px] shadow-lg border border-white/10"
      data-testid="timer-debug-overlay"
    >
      <div className="text-yellow-300 mb-1">⏱ Timer Debug</div>
      <Row k="me" v={myId.slice(0, 8)} />
      <Row k="peer" v={peerId.slice(0, 8)} />
      <Row k="connected" v={`${connected ? "✓" : "✗"}  ${fmtAbs(c)}`} />
      <Row k="remoteJoined" v={`${remoteJoined ? "✓" : "✗"}  ${fmtAbs(r)}`} />
      <Row k="everConnected" v={`${everConnected ? "✓" : "✗"}  ${fmtAbs(e)}`} />
      <Row k="Δ remote−conn" v={fmtDelta(r, c)} />
      <Row k="Anchor (server)" v={fmtAbs(anchorClient)} />
      <Row k="anchor recv" v={fmtAbs(a)} />
      <Row k="first tick" v={fmtAbs(f)} />
      <Row k="Δ anchor−ever" v={fmtDelta(anchorClient, e)} />
      <Row
        k="Elapsed (state)"
        v={`${elapsed}s`}
        hi
      />
      <Row
        k="Elapsed (live)"
        v={liveElapsedMs != null ? `${(liveElapsedMs / 1000).toFixed(2)}s` : "—"}
      />
    </div>
  );
}

function Row({ k, v, hi }: { k: string; v: string; hi?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-white/60">{k}</span>
      <span className={hi ? "text-emerald-300" : "text-white"}>{v}</span>
    </div>
  );
}
