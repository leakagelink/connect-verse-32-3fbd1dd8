import { useEffect, useState } from "react";
import { Bell, BellOff, X, Settings, PhoneIncoming } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getPushPermissionState,
  requestPushPermission,
  openAppSettings,
  isNative,
  checkFullScreenIntentPermission,
  openFullScreenIntentSettings,
  type PermState,
} from "@/lib/native";

/**
 * First-launch push-notification opt-in.
 *
 * Behaviour:
 *  - On mount, reads the OS permission state (without prompting).
 *  - state === 'prompt'  → shows a soft explainer card. Tapping "Enable"
 *    triggers the actual OS dialog. If the user grants, the card hides;
 *    if they deny, it flips to the "denied" inline-guidance state.
 *  - state === 'denied'  → shows inline guidance with an "Open Settings"
 *    button (deep-links to the app's notification settings via
 *    capacitor-native-settings).
 *  - state === 'granted' → renders nothing.
 *
 * The "dismiss" affordance only suppresses the soft-prompt explainer for
 * the rest of the session (sessionStorage). The hard-denied guidance is
 * sticky until the user actually flips the OS toggle, because without
 * notifications the app cannot ring incoming calls.
 */

const DISMISS_KEY = "talkora.pushPromptDismissed";

export function PushPermissionGate() {
  const [state, setState] = useState<PermState | null>(null);
  // Android 14+ full-screen-intent runtime grant — without it, killed/backgrounded
  // apps can't auto-launch the ringer screen even when FCM is delivered.
  const [fsiNeeded, setFsiNeeded] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const s = await getPushPermissionState();
      if (!alive) return;
      setState(s);
      // Only check FSI grant once notifications themselves are granted —
      // otherwise the notification toggle is the more urgent fix.
      if (s === "granted") {
        const fsi = await checkFullScreenIntentPermission();
        if (alive) setFsiNeeded(fsi.required && !fsi.granted);
      } else {
        setFsiNeeded(false);
      }
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Show FSI banner even when push state is "granted" (the early-return below
  // would otherwise hide the gate entirely).
  if (state === null || state === "unknown") return null;
  if (state === "granted" && !fsiNeeded) return null;

  const isDenied = state === "denied";
  const showFsiOnly = state === "granted" && fsiNeeded;
  if (!isDenied && !showFsiOnly && dismissed) return null;

  const handleEnable = async () => {
    setBusy(true);
    const next = await requestPushPermission();
    setState(next);
    setBusy(false);
    if (next === "granted") {
      try {
        sessionStorage.removeItem(DISMISS_KEY);
      } catch {
        /* ignore */
      }
    }
  };

  const handleOpenSettings = async () => {
    setBusy(true);
    await openAppSettings();
    setBusy(false);
  };

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      className={
        "mx-auto max-w-3xl px-4 pt-3 " +
        (isDenied ? "" : "animate-in fade-in slide-in-from-top-2")
      }
      role="region"
      aria-label="Notification permission"
    >
      <div
        className={
          "glass relative flex items-start gap-3 rounded-2xl border p-3.5 sm:p-4 " +
          (isDenied ? "border-destructive/40" : "border-primary/30")
        }
      >
        <div
          className={
            "flex size-10 shrink-0 items-center justify-center rounded-full " +
            (isDenied ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary")
          }
          aria-hidden
        >
          {isDenied ? <BellOff className="size-5" /> : <Bell className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {isDenied ? "Notifications are turned off" : "Stay reachable on Talkora"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isDenied
              ? "Without notification permission you won't get incoming call rings, chat alerts, or missed-call updates — even when the app is in the background. Open Settings and turn on Notifications for Talkora."
              : "Turn on notifications so incoming calls and messages reach you even when the app is closed. You can change this anytime in Settings."}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {isDenied ? (
              <Button
                size="sm"
                onClick={handleOpenSettings}
                disabled={busy || !isNative()}
                className="h-8"
              >
                <Settings className="mr-1.5 size-3.5" />
                Open Settings
              </Button>
            ) : (
              <>
                <Button size="sm" onClick={handleEnable} disabled={busy} className="h-8">
                  <Bell className="mr-1.5 size-3.5" />
                  {busy ? "Asking…" : "Enable notifications"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDismiss}
                  disabled={busy}
                  className="h-8"
                >
                  Not now
                </Button>
              </>
            )}
          </div>
          {isDenied && !isNative() && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              In your browser, click the lock icon in the address bar → Site
              settings → Notifications → Allow.
            </p>
          )}
        </div>
        {!isDenied && (
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
