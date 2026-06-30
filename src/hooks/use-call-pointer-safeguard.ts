import { useEffect } from "react";

// Runtime safeguard wired into the in-call surface.
//
// 1. Marks <body data-call-active="1"> so the CSS rules in styles.css can
//    neutralise pointer events on known dev/error overlays for as long as
//    the call is on screen.
// 2. Observes the DOM and, for any *unknown* fixed/absolute element that
//    mounts on top of the call surface (higher z-index, covers the screen),
//    forces `pointer-events: none` so it cannot swallow control taps.
// 3. Classifies whatever it neutralises into a coarse `OverlayKind` so the
//    audit log makes it obvious *what* swallowed the tap (anonymous scrim,
//    Radix portal, sonner toast container, route loader, etc).
// 4. In debug mode (`?callDebug=1` or `localStorage.callPointerDebug=1`)
//    paints a translucent outline on every neutralised overlay and mounts
//    a small HUD showing live counts + the most recent tap probe so you
//    can immediately verify a control click reached `data-call-surface`
//    and was not eaten by an overlay.
//
// The guard never removes overlays — they stay visible so the cause is still
// debuggable — it only prevents them from intercepting clicks. The call
// surface itself is exempted via `data-call-surface="1"`.

type OverlayKind =
  | "radix-portal"
  | "sonner-toast"
  | "route-loader"
  | "dev-error-overlay"
  | "anonymous-scrim";

interface AuditEntry {
  at: number;
  kind: OverlayKind;
  tag: string;
  id: string | null;
  className: string;
  zIndex: string;
  rect: { w: number; h: number; x: number; y: number };
}

interface TapProbe {
  at: number;
  target: string;
  reachedCallSurface: boolean;
  blockedByKind: OverlayKind | null;
  x: number;
  y: number;
}

// Public surface attached to window so the in-call debug overlay (and any
// E2E harness) can read live state without taking a dependency on this hook.
interface CallPointerAudit {
  entries: AuditEntry[];
  taps: TapProbe[];
  countsByKind: Record<OverlayKind, number>;
  reset(): void;
}

declare global {
  interface Window {
    __callPointerAudit?: CallPointerAudit;
  }
}

const MAX_AUDIT = 50;
const MAX_TAPS = 25;

function classify(el: HTMLElement): OverlayKind {
  if (el.matches("[data-sonner-toaster], [data-sonner-toaster] *")) return "sonner-toast";
  if (
    el.matches(
      "[data-radix-portal], [data-radix-popper-content-wrapper], [data-radix-dialog-overlay], [data-radix-alert-dialog-overlay]",
    )
  )
    return "radix-portal";
  if (el.matches("[data-tanstack-router-loading], [data-pending-route]")) return "route-loader";
  if (
    el.id === "vite-error-overlay" ||
    el.tagName.toLowerCase() === "vite-error-overlay" ||
    el.matches("[data-error-overlay], #webpack-dev-server-client-overlay")
  )
    return "dev-error-overlay";
  return "anonymous-scrim";
}

function ensureAudit(): CallPointerAudit {
  if (typeof window === "undefined") {
    return {
      entries: [],
      taps: [],
      countsByKind: {
        "radix-portal": 0,
        "sonner-toast": 0,
        "route-loader": 0,
        "dev-error-overlay": 0,
        "anonymous-scrim": 0,
      },
      reset() {},
    };
  }
  if (window.__callPointerAudit) return window.__callPointerAudit;
  const audit: CallPointerAudit = {
    entries: [],
    taps: [],
    countsByKind: {
      "radix-portal": 0,
      "sonner-toast": 0,
      "route-loader": 0,
      "dev-error-overlay": 0,
      "anonymous-scrim": 0,
    },
    reset() {
      this.entries = [];
      this.taps = [];
      (Object.keys(this.countsByKind) as OverlayKind[]).forEach((k) => {
        this.countsByKind[k] = 0;
      });
    },
  };
  window.__callPointerAudit = audit;
  return audit;
}

function isDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("callDebug") === "1" || params.get("debug") === "1") return true;
    if (window.localStorage?.getItem("callPointerDebug") === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function useCallPointerSafeguard(active: boolean) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!active) return;

    const body = document.body;
    const prev = body.getAttribute("data-call-active");
    body.setAttribute("data-call-active", "1");

    const NEUTRALISED = "data-call-pointer-neutralised";
    const NEUTRALISED_KIND = "data-call-pointer-kind";
    const audit = ensureAudit();
    const debug = isDebugEnabled();

    // Selectors that mark an element (or any descendant) as a real,
    // interactive overlay belonging to our UX — Radix dialogs/sheets/
    // popovers, sonner toasts, and any container that hosts focusable
    // controls. We must NEVER neutralise these or the gift sheet,
    // end-call confirm, low-balance dialog, etc. become dead pixels.
    const INTERACTIVE_MARKERS = [
      "[data-call-surface='1']",
      "[data-sonner-toaster]",
      "[data-radix-portal]",
      "[data-radix-popper-content-wrapper]",
      "[role='dialog']",
      "[role='alertdialog']",
      "[role='menu']",
      "[role='listbox']",
      "[role='tooltip']",
      "[data-state='open']",
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    const isCoveringOverlay = (el: Element): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.hasAttribute("data-call-surface")) return false;
      if (el.closest("[data-call-surface='1']")) return false;
      if (el.getAttribute(NEUTRALISED) === "1") return false;

      // If this subtree contains ANY real interactive content, it's part of
      // the live UX (a Radix dialog/sheet/popover, a toast, a menu, …) —
      // leave it alone. We only want to kill blind, fully opaque dev/error
      // scrims that ship no controls of their own.
      if (el.matches(INTERACTIVE_MARKERS)) return false;
      if (el.querySelector(INTERACTIVE_MARKERS)) return false;

      const cs = window.getComputedStyle(el);
      if (cs.pointerEvents === "none") return false;
      if (cs.position !== "fixed" && cs.position !== "absolute") return false;

      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Only neutralise true full-viewport scrims, not small popovers.
      const coversViewport =
        r.width >= vw * 0.9 &&
        r.height >= vh * 0.9 &&
        r.left <= vw * 0.05 &&
        r.top <= vh * 0.05;
      if (!coversViewport) return false;

      // Z-index must be ≥ the call surface (z-60 → 60).
      const z = parseInt(cs.zIndex, 10);
      if (Number.isFinite(z) && z < 60) return false;

      return true;
    };

    const recordNeutralised = (el: HTMLElement) => {
      const kind = classify(el);
      const cs = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const entry: AuditEntry = {
        at: Date.now(),
        kind,
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        className: typeof el.className === "string" ? el.className.slice(0, 120) : "",
        zIndex: cs.zIndex,
        rect: {
          w: Math.round(r.width),
          h: Math.round(r.height),
          x: Math.round(r.left),
          y: Math.round(r.top),
        },
      };
      audit.entries.unshift(entry);
      if (audit.entries.length > MAX_AUDIT) audit.entries.length = MAX_AUDIT;
      audit.countsByKind[kind] = (audit.countsByKind[kind] ?? 0) + 1;
      el.setAttribute(NEUTRALISED_KIND, kind);

      // eslint-disable-next-line no-console
      console.warn(
        `[call-pointer-safeguard] neutralised ${kind} so call controls stay tappable`,
        { tag: entry.tag, id: entry.id, z: entry.zIndex, rect: entry.rect, el },
      );

      if (debug) {
        el.style.setProperty("outline", "2px dashed rgba(244,63,94,0.85)", "important");
        el.style.setProperty("outline-offset", "-2px", "important");
        el.style.setProperty("box-shadow", "inset 0 0 0 9999px rgba(244,63,94,0.06)", "important");
      }
    };

    const sweep = () => {
      const candidates = document.querySelectorAll<HTMLElement>("body > *");
      candidates.forEach((el) => {
        if (isCoveringOverlay(el)) {
          el.style.setProperty("pointer-events", "none", "important");
          el.setAttribute(NEUTRALISED, "1");
          recordNeutralised(el);
        }
      });
      if (debug) renderHud();
    };

    sweep();
    const observer = new MutationObserver(() => sweep());
    observer.observe(document.body, { childList: true, subtree: false });

    // ── Tap-probe (debug only) ───────────────────────────────────────────
    // Captures every pointerdown and records whether it landed inside a
    // `data-call-surface` ancestor or was intercepted by a neutralised
    // overlay. Use the HUD or `window.__callPointerAudit.taps` to verify.
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const reachedCallSurface = !!target.closest("[data-call-surface='1']");
      const blocker = target.closest(`[${NEUTRALISED}='1']`) as HTMLElement | null;
      const tap: TapProbe = {
        at: Date.now(),
        target: target.tagName.toLowerCase() + (target.id ? `#${target.id}` : ""),
        reachedCallSurface,
        blockedByKind: blocker ? ((blocker.getAttribute(NEUTRALISED_KIND) as OverlayKind) ?? null) : null,
        x: e.clientX,
        y: e.clientY,
      };
      audit.taps.unshift(tap);
      if (audit.taps.length > MAX_TAPS) audit.taps.length = MAX_TAPS;
      if (debug) renderHud();
    };

    // ── HUD (debug only) ─────────────────────────────────────────────────
    let hud: HTMLDivElement | null = null;
    function renderHud() {
      if (!debug) return;
      if (!hud) {
        hud = document.createElement("div");
        hud.setAttribute("data-call-pointer-hud", "1");
        hud.setAttribute("data-call-surface", "1");
        Object.assign(hud.style, {
          position: "fixed",
          bottom: "8px",
          left: "8px",
          zIndex: "2147483646",
          maxWidth: "min(360px, 90vw)",
          padding: "8px 10px",
          background: "rgba(15,23,42,0.92)",
          color: "#f8fafc",
          font: "11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
          borderRadius: "8px",
          border: "1px solid rgba(244,63,94,0.6)",
          pointerEvents: "auto",
          boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
        } as Partial<CSSStyleDeclaration>);
        document.body.appendChild(hud);
      }
      const counts = audit.countsByKind;
      const lastTap = audit.taps[0];
      const tapLine = lastTap
        ? `tap ${lastTap.target} @${lastTap.x},${lastTap.y} → ${
            lastTap.reachedCallSurface
              ? "✅ call-surface"
              : lastTap.blockedByKind
                ? `⛔ ${lastTap.blockedByKind}`
                : "↪ outside"
          }`
        : "tap: (none yet)";
      hud.innerHTML = `
        <div style="font-weight:700;color:#fda4af;margin-bottom:4px">call-pointer audit</div>
        <div>neutralised:
          radix=${counts["radix-portal"]} ·
          toast=${counts["sonner-toast"]} ·
          loader=${counts["route-loader"]} ·
          dev=${counts["dev-error-overlay"]} ·
          scrim=${counts["anonymous-scrim"]}
        </div>
        <div style="margin-top:4px;color:#e2e8f0">${tapLine}</div>
        <div style="margin-top:4px;color:#94a3b8">callPointerDebug=1 · window.__callPointerAudit</div>
      `;
    }

    if (debug) {
      document.addEventListener("pointerdown", onPointerDown, true);
      renderHud();
    }

    return () => {
      observer.disconnect();
      if (debug) document.removeEventListener("pointerdown", onPointerDown, true);
      if (prev === null) body.removeAttribute("data-call-active");
      else body.setAttribute("data-call-active", prev);
      // Leave neutralised attribute in place; once the call ends overlays
      // can be interacted with again because the marker class no longer
      // applies.
      document
        .querySelectorAll<HTMLElement>(`[${NEUTRALISED}='1']`)
        .forEach((el) => {
          el.style.removeProperty("pointer-events");
          el.style.removeProperty("outline");
          el.style.removeProperty("outline-offset");
          el.style.removeProperty("box-shadow");
          el.removeAttribute(NEUTRALISED);
          el.removeAttribute(NEUTRALISED_KIND);
        });
      if (hud && hud.parentElement) hud.parentElement.removeChild(hud);
      hud = null;
    };
  }, [active]);
}
