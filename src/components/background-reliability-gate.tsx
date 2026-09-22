import { useEffect, useState } from "react";
import { BatteryCharging, RotateCcw, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getBackgroundReliabilityStatus,
  openAutostartSettings,
  openBatterySettings,
  isNative,
  type BackgroundReliabilityStatus,
  type OemVendor,
} from "@/lib/native";

/**
 * Background-reliability gate.
 *
 * Many Chinese OEM ROMs (MIUI / FunTouch / ColorOS / Realme UI / Honor /
 * Huawei / OnePlus / Asus) aggressively kill backgrounded apps. Without
 * the user manually enabling:
 *   1. Autostart  — lets FCM wake our process when the app is killed
 *   2. "Don't optimize battery" — keeps the process alive long enough to
 *      ring + launch IncomingCallActivity
 * incoming calls silently fail when the app isn't already open.
 *
 * We can deep-link to the right OEM screen but can't toggle the values
 * on the user's behalf — this is an OS-level constraint. The banner is
 * sticky (no "dismiss") until both checks pass, because skipping it
 * means calls are unreliable.
 */

const DISMISS_KEY = "talkora.bgReliabilityDismissed";

const VENDOR_LABEL: Record<OemVendor, string> = {
  xiaomi: "Xiaomi / Redmi / Poco",
  vivo: "Vivo / iQOO",
  oppo: "Oppo",
  realme: "Realme",
  oneplus: "OnePlus",
  honor: "Honor",
  huawei: "Huawei",
  samsung: "Samsung",
  asus: "Asus",
  letv: "LeEco",
  nokia: "Nokia",
  stock: "Android",
};

export function BackgroundReliabilityGate() {
  const [status, setStatus] = useState<BackgroundReliabilityStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const s = await getBackgroundReliabilityStatus();
      if (alive) setStatus(s);
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!isNative()) return null;
  if (!status || !status.recommended) return null;

  const needsBattery = !status.batteryOptIgnored;
  const needsAutostart = status.autostartSupported;
  // If only the soft autostart hint is left (battery already OK) and the
  // user dismissed once this session, hide it.
  if (!needsBattery && needsAutostart && dismissed) return null;

  const handleBattery = async () => {
    setBusy(true);
    // Opens the system battery-optimization list; the user flips the toggle.
    await openBatterySettings();
    // Re-check after the user returns from Settings.
    const next = await getBackgroundReliabilityStatus();
    setStatus(next);
    setBusy(false);
  };

  const handleAutostart = async () => {
    setBusy(true);
    await openAutostartSettings();
    setBusy(false);
  };

  const handleFallbackBattery = async () => {
    setBusy(true);
    await openBatterySettings();
    setBusy(false);
  };

  const handleDismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setDismissed(true);
  };

  const vendorLabel = VENDOR_LABEL[status.vendor] ?? "your device";
  const canDismiss = !needsBattery; // only the soft autostart hint is dismissable

  return (
    <div
      className="mx-auto max-w-3xl px-4 pt-3 animate-in fade-in slide-in-from-top-2"
      role="region"
      aria-label="Background reliability"
    >
      <div className="glass relative flex items-start gap-3 rounded-2xl border border-amber-500/40 p-3.5 sm:p-4">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-500"
          aria-hidden
        >
          <BatteryCharging className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Keep Talkora ringing in background</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {vendorLabel} aggressively closes apps to save battery. To make sure
            incoming calls always ring — even when Talkora is closed or your
            phone is locked — please enable these two settings.
          </p>

          <ul className="mt-2 space-y-2">
            {needsBattery && (
              <li className="flex flex-wrap items-center gap-2">
                <span className="text-xs">
                  <strong>1.</strong> In Battery settings, set Talkora to{" "}
                  <em>Unrestricted / Don't optimise</em>
                </span>
                <Button size="sm" onClick={handleBattery} disabled={busy} className="h-7">
                  <BatteryCharging className="mr-1.5 size-3.5" />
                  Open
                </Button>
              </li>
            )}
            {needsAutostart && (
              <li className="flex flex-wrap items-center gap-2">
                <span className="text-xs">
                  <strong>{needsBattery ? "2." : "1."}</strong> Turn on{" "}
                  <em>Autostart</em> for Talkora
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleAutostart}
                  disabled={busy}
                  className="h-7"
                >
                  <RotateCcw className="mr-1.5 size-3.5" />
                  Open Autostart
                </Button>
              </li>
            )}
          </ul>

          {!needsBattery && needsAutostart && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Already done? Open{" "}
              <button
                type="button"
                onClick={handleFallbackBattery}
                className="underline underline-offset-2"
              >
                Battery settings
              </button>
              {" "}to double-check.
            </p>
          )}

          <p className="mt-2 text-[11px] text-muted-foreground">
            <Settings className="mr-1 inline size-3" />
            We can only open these settings — you must toggle them. Android
            does not let apps enable Autostart on your behalf.
          </p>
        </div>
        {canDismiss && (
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
