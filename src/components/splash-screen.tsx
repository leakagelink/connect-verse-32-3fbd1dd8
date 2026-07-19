import { useEffect, useState } from "react";
import { APP_NAME } from "@/lib/constants";
import talkoraLogo from "@/assets/talkora-logo.png.asset.json";

const SEEN_KEY = "talkora.splash.seen";
const LOGO_CACHE_KEY = "talkora.splash.logo.v1";
const HOLD_MS = 1000;
const FADE_MS = 300;
const TOTAL_MS = HOLD_MS + FADE_MS;

function useCachedLogo(url: string) {
  const [src, setSrc] = useState<string>(() => {
    if (typeof window === "undefined") return url;
    try {
      return window.localStorage.getItem(LOGO_CACHE_KEY) || url;
    } catch {
      return url;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (src !== url) return; // already using cached base64

    let cancelled = false;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`logo fetch ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          try {
            window.localStorage.setItem(LOGO_CACHE_KEY, base64);
          } catch {
            // localStorage full — ignore, CDN cache will still work
          }
          setSrc(base64);
        };
        reader.readAsDataURL(blob);
      })
      .catch(() => {
        // keep original CDN url on failure
      });

    return () => { cancelled = true; };
  }, [url, src]);

  return src;
}

/**
 * Modern, fast splash overlay.
 * - Caches the logo in localStorage so repeat opens are instant.
 * - Matches native Capacitor splash background (#0B0B12) for a seamless hand-off.
 * - Shows once per browser session (sessionStorage).
 * - Pure CSS animations; respects prefers-reduced-motion.
 */
export function SplashScreen() {
  const [seen, setSeen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return !!sessionStorage.getItem(SEEN_KEY);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Mark as seen as soon as React commits so rapid reloads in the same
    // session do not show the splash again.
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch {}
    const t = setTimeout(() => setSeen(true), TOTAL_MS);
    return () => clearTimeout(t);
  }, []);

  if (seen) return null;

  const logoSrc = useCachedLogo(`${talkoraLogo.url}?v=${talkoraLogo.asset_id}`);
  const progressDuration = `${HOLD_MS}ms`;
  const fadeDuration = `${TOTAL_MS}ms`;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden splash-fade"
      style={{
        background:
          "radial-gradient(ellipse 120% 80% at 50% -20%, oklch(0.35 0.14 340 / 0.55), transparent 60%), radial-gradient(ellipse 100% 70% at 50% 120%, oklch(0.32 0.12 22 / 0.50), transparent 55%), #0B0B12",
      }}
    >
      {/* ambient mesh orbs */}
      <div className="splash-orb splash-orb-1" />
      <div className="splash-orb splash-orb-2" />
      <div className="splash-orb splash-orb-3" />

      <div className="relative flex flex-col items-center gap-6 px-6">
        {/* logo with double ring pulse */}
        <div className="relative">
          <span className="splash-ring" />
          <span className="splash-ring splash-ring-delay" />
          <div className="relative size-28 rounded-3xl brand-gradient shadow-[0_24px_60px_-20px_oklch(0.55_0.22_350/0.65)] flex items-center justify-center splash-logo-pop">
            <img
              src={logoSrc}
              alt=""
              width={88}
              height={88}
              decoding="async"
              className="size-20 rounded-2xl"
            />
          </div>
        </div>

        <div className="text-center splash-text-rise">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-gradient drop-shadow-[0_2px_10px_rgba(255,255,255,0.15)]">
            {APP_NAME}
          </h1>
          <p className="mt-2 text-sm sm:text-base text-pink-200/80 font-medium">
            Voice rooms. Real conversations.
          </p>
          <p className="mt-1 text-xs text-white/50">
            आवाज़ से जुड़ो, दोस्त बनाओ
          </p>
        </div>

        {/* progress bar */}
        <div className="w-40 sm:w-48 h-1.5 rounded-full bg-white/10 overflow-hidden splash-text-rise" style={{ animationDelay: "350ms" }}>
          <div
            className="h-full rounded-full bg-gradient-to-r from-pink-400 via-purple-400 to-pink-400 splash-progress"
            style={{ animationDuration: progressDuration }}
          />
        </div>

        {/* loader dots */}
        <div className="flex gap-1.5 splash-text-rise" style={{ animationDelay: "400ms" }}>
          <span className="splash-dot" />
          <span className="splash-dot splash-dot-2" />
          <span className="splash-dot splash-dot-3" />
        </div>
      </div>

      <style>{`
        .splash-fade {
          animation: splash-fade-out ${fadeDuration} ease-out forwards;
          pointer-events: none;
        }
        @keyframes splash-fade-out {
          0% { opacity: 1; }
          ${(HOLD_MS / TOTAL_MS) * 100}% { opacity: 1; }
          100% { opacity: 0; }
        }
        .splash-progress {
          animation-name: splash-progress;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
        }
        @keyframes splash-progress {
          from { width: 0%; }
          to { width: 100%; }
        }
        @keyframes splash-logo-pop {
          0% { transform: scale(0.55) rotate(-6deg); opacity: 0; }
          60% { transform: scale(1.08) rotate(0deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes splash-text-rise {
          0% { transform: translateY(16px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes splash-ring {
          0% { transform: scale(0.82); opacity: 0.55; }
          100% { transform: scale(1.95); opacity: 0; }
        }
        @keyframes splash-dot {
          0%, 80%, 100% { transform: scale(0.55); opacity: 0.35; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes splash-orb-float {
          0%, 100% { transform: translate(0,0) scale(1); }
          50% { transform: translate(24px, -34px) scale(1.08); }
        }
        .splash-logo-pop { animation: splash-logo-pop 760ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        .splash-text-rise { animation: splash-text-rise 620ms ease-out both; }
        .splash-ring {
          position: absolute; inset: -8px; border-radius: 1.75rem;
          border: 2px solid oklch(0.75 0.18 22 / 0.55);
          animation: splash-ring 2s ease-out infinite;
        }
        .splash-ring-delay { animation-delay: 1s; }
        .splash-dot {
          width: 7px; height: 7px; border-radius: 9999px;
          background: linear-gradient(135deg, oklch(0.75 0.18 22), oklch(0.70 0.17 340));
          animation: splash-dot 1.2s ease-in-out infinite;
        }
        .splash-dot-2 { animation-delay: 0.15s; }
        .splash-dot-3 { animation-delay: 0.3s; }
        .splash-orb {
          position: absolute; border-radius: 9999px; filter: blur(72px);
          animation: splash-orb-float 7s ease-in-out infinite;
        }
        .splash-orb-1 {
          width: 280px; height: 280px; top: 8%; left: -70px;
          background: oklch(0.55 0.18 350 / 0.42);
        }
        .splash-orb-2 {
          width: 240px; height: 240px; bottom: 6%; right: -50px;
          background: oklch(0.50 0.16 22 / 0.38);
          animation-delay: 1.8s;
        }
        .splash-orb-3 {
          width: 200px; height: 200px; top: 48%; left: 50%;
          transform: translate(-50%, -50%);
          background: oklch(0.82 0.16 85 / 0.14);
          animation-delay: 3.5s;
        }
        @media (prefers-reduced-motion: reduce) {
          .splash-fade, .splash-progress, .splash-logo-pop, .splash-text-rise, .splash-ring, .splash-dot, .splash-orb {
            animation: none !important;
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
