import { useEffect, useState } from "react";
import { subscribeAgoraDebug, clearAgoraDebug, type AgoraDebugEvent } from "@/lib/agora-debug";

/**
 * Floating overlay that prints Agora lifecycle events as they happen.
 * Enable from any call screen with `?agoraDebug=1` on the URL.
 * Sits above the call surface (z-90) and is pointer-events-none on the
 * container so it can never swallow control taps — only the inner card
 * accepts clicks (for Clear / Hide).
 */
export function AgoraDebugPanel() {
  const [events, setEvents] = useState<AgoraDebugEvent[]>([]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => subscribeAgoraDebug(setEvents), []);

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="fixed bottom-2 right-2 z-[90] rounded bg-black/70 px-2 py-1 text-[10px] font-mono text-white"
      >
        agora-debug ({events.length})
      </button>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-2 bottom-2 z-[90] flex justify-end">
      <div className="pointer-events-auto w-[min(420px,100%)] max-h-[40vh] overflow-hidden rounded-lg border border-white/10 bg-black/80 text-white shadow-xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-white/10 px-2 py-1 text-[11px] font-mono">
          <span>agora-debug · {events.length} events</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={clearAgoraDebug}
              className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20"
            >
              clear
            </button>
            <button
              type="button"
              onClick={() => setHidden(true)}
              className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20"
            >
              hide
            </button>
          </div>
        </div>
        <ol className="max-h-[36vh] overflow-y-auto px-2 py-1 text-[10px] font-mono leading-tight">
          {events.length === 0 && (
            <li className="py-2 text-white/50">no events yet — join a call to populate</li>
          )}
          {events.slice().reverse().map((e) => {
            const t = new Date(e.ts);
            const stamp = `${t.getMinutes().toString().padStart(2, "0")}:${t.getSeconds().toString().padStart(2, "0")}.${t.getMilliseconds().toString().padStart(3, "0")}`;
            const color =
              e.level === "error" ? "text-red-300"
              : e.level === "warn" ? "text-amber-300"
              : "text-emerald-200";
            const detail = e.detail == null
              ? ""
              : typeof e.detail === "string"
                ? e.detail
                : JSON.stringify(e.detail);
            return (
              <li key={e.id} className="border-b border-white/5 py-0.5">
                <span className="text-white/40">{stamp}</span>{" "}
                <span className={color}>{e.kind}</span>
                {detail && <span className="text-white/70"> {detail}</span>}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
