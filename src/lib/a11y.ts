/**
 * Accessibility preferences persisted in localStorage and applied
 * as classes on <html>. Kept as a plain module so it can be
 * invoked from app boot BEFORE React hydrates — avoids theme flash.
 */

export type A11yContrast = "default" | "high";
export type A11yTextScale = "default" | "lg" | "xl";
export type A11yMotion = "system" | "reduced";

export type A11yPrefs = {
  contrast: A11yContrast;
  textScale: A11yTextScale;
  motion: A11yMotion;
};

const STORAGE_KEY = "talkora.a11y.v1";

export const A11Y_DEFAULTS: A11yPrefs = {
  contrast: "default",
  textScale: "default",
  motion: "system",
};

export function readA11yPrefs(): A11yPrefs {
  if (typeof window === "undefined") return A11Y_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return A11Y_DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      contrast: parsed.contrast === "high" ? "high" : "default",
      textScale:
        parsed.textScale === "lg" || parsed.textScale === "xl"
          ? parsed.textScale
          : "default",
      motion: parsed.motion === "reduced" ? "reduced" : "system",
    };
  } catch {
    return A11Y_DEFAULTS;
  }
}

export function writeA11yPrefs(prefs: A11yPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

export function applyA11yPrefs(prefs: A11yPrefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  root.classList.toggle("theme-high-contrast", prefs.contrast === "high");
  root.classList.toggle("text-scale-lg", prefs.textScale === "lg");
  root.classList.toggle("text-scale-xl", prefs.textScale === "xl");
  root.classList.toggle("reduce-motion", prefs.motion === "reduced");
}

/** Called once from src/start.ts / __root.tsx before hydration. */
export function initA11y() {
  applyA11yPrefs(readA11yPrefs());
}
