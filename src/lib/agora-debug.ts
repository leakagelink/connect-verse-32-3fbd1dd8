/**
 * In-memory pub/sub ring buffer for Agora lifecycle events.
 *
 * Why: blank-video bugs (peer cam toggle, track-ended swap, missed
 * republish) are hard to repro from logs alone. The call screen mounts
 * <AgoraDebugPanel /> when `?agoraDebug=1` is on the URL and renders
 * everything pushed here in real time.
 *
 * Anyone can `pushAgoraDebug(...)` — agora-client.ts is the main producer.
 */

export type AgoraDebugLevel = "info" | "warn" | "error";

export type AgoraDebugEvent = {
  id: number;
  ts: number;
  level: AgoraDebugLevel;
  kind: string;
  detail?: Record<string, unknown> | string;
};

const MAX_EVENTS = 200;
let buffer: AgoraDebugEvent[] = [];
let nextId = 1;
const listeners = new Set<(events: AgoraDebugEvent[]) => void>();

export function pushAgoraDebug(
  kind: string,
  detail?: Record<string, unknown> | string,
  level: AgoraDebugLevel = "info",
) {
  const evt: AgoraDebugEvent = { id: nextId++, ts: Date.now(), kind, detail, level };
  buffer = [...buffer, evt].slice(-MAX_EVENTS);
  for (const fn of listeners) {
    try { fn(buffer); } catch { /* ignore */ }
  }
  if (typeof console !== "undefined") {
    const tag = `[agora-debug] ${kind}`;
    if (level === "error") console.error(tag, detail);
    else if (level === "warn") console.warn(tag, detail);
    // info events stay out of console to avoid noise; panel still shows them.
  }
}

export function subscribeAgoraDebug(fn: (events: AgoraDebugEvent[]) => void): () => void {
  listeners.add(fn);
  fn(buffer);
  return () => { listeners.delete(fn); };
}

export function clearAgoraDebug() {
  buffer = [];
  for (const fn of listeners) {
    try { fn(buffer); } catch { /* ignore */ }
  }
}
