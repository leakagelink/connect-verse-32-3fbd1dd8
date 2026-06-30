import { useEffect } from "react";

// Runtime safeguard wired into the in-call surface.
//
// 1. Marks <body data-call-active="1"> so the CSS rules in styles.css can
//    neutralise pointer events on known dev/error overlays for as long as
//    the call is on screen.
// 2. Observes the DOM and, for any *unknown* fixed/absolute element that
//    mounts on top of the call surface (higher z-index, covers the screen),
//    forces `pointer-events: none` so it cannot swallow control taps.
//
// The guard never removes overlays — they stay visible so the cause is still
// debuggable — it only prevents them from intercepting clicks. The call
// surface itself is exempted via `data-call-surface="1"`.
export function useCallPointerSafeguard(active: boolean) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!active) return;

    const body = document.body;
    const prev = body.getAttribute("data-call-active");
    body.setAttribute("data-call-active", "1");

    const NEUTRALISED = "data-call-pointer-neutralised";

    const isCoveringOverlay = (el: Element): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.hasAttribute("data-call-surface")) return false;
      if (el.closest("[data-call-surface='1']")) return false;
      // Skip well-known interactive layers we own (toasts, dialogs,
      // sheets) — they are part of the call UX, not blocking overlays.
      if (el.closest("[data-sonner-toaster]")) return false;
      if (el.closest("[data-radix-portal]")) return false;
      if (el.getAttribute(NEUTRALISED) === "1") return false;

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

    const sweep = () => {
      const candidates = document.querySelectorAll<HTMLElement>("body > *");
      candidates.forEach((el) => {
        if (isCoveringOverlay(el)) {
          el.style.setProperty("pointer-events", "none", "important");
          el.setAttribute(NEUTRALISED, "1");
          // eslint-disable-next-line no-console
          console.warn(
            "[call-pointer-safeguard] neutralised covering overlay so call controls stay tappable",
            el,
          );
        }
      });
    };

    sweep();
    const observer = new MutationObserver(() => sweep());
    observer.observe(document.body, { childList: true, subtree: false });

    return () => {
      observer.disconnect();
      if (prev === null) body.removeAttribute("data-call-active");
      else body.setAttribute("data-call-active", prev);
      // Leave neutralised attribute in place; once the call ends overlays
      // can be interacted with again because the marker class no longer
      // applies.
      document
        .querySelectorAll<HTMLElement>(`[${NEUTRALISED}='1']`)
        .forEach((el) => {
          el.style.removeProperty("pointer-events");
          el.removeAttribute(NEUTRALISED);
        });
    };
  }, [active]);
}
