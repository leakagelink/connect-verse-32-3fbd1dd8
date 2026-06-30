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
