/**
 * Native bridge helpers (Capacitor).
 *
 * Every function here is **safe to call from the web** — if the app is
 * running in a regular browser the call no-ops. Inside the Android wrap
 * (Capacitor) the corresponding plugin is invoked.
 *
 * Used by:
 *   - Call screen (enable screenshot block while video/audio is live)
 *   - KYC screen (block screen capture of Aadhaar/PAN previews)
 *   - Withdrawal screen (block screen capture of bank details)
 *   - AppShell (status-bar colour, splash hide, push registration)
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const platform = (): string => Capacitor.getPlatform();

/* ---------------- Privacy screen (FLAG_SECURE wrapper) ---------------- */

let privacyDepth = 0;

export async function enablePrivacyScreen(): Promise<void> {
  privacyDepth += 1;
  if (!isNative()) return;
  try {
    const { PrivacyScreen } = await import('@capacitor-community/privacy-screen');
    await PrivacyScreen.enable();
  } catch {
    /* plugin unavailable — ignore */
  }
}

export async function disablePrivacyScreen(): Promise<void> {
  privacyDepth = Math.max(0, privacyDepth - 1);
  if (privacyDepth > 0 || !isNative()) return;
  try {
    const { PrivacyScreen } = await import('@capacitor-community/privacy-screen');
    await PrivacyScreen.disable();
  } catch {
    /* ignore */
  }
}

/* ---------------- Status bar / splash ---------------- */

export async function applyChromeForApp(): Promise<void> {
  if (!isNative()) return;
  try {
    const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([
      import('@capacitor/status-bar'),
      import('@capacitor/splash-screen'),
    ]);
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0B0B12' });
    // Force the WebView to render BELOW the system status bar. Some Android
    // OEMs ignore the capacitor.config 'overlaysWebView' flag, which causes
    // the app header to clip into the notification bar. Calling this at
    // runtime guarantees no overlap regardless of OEM defaults.
    try { await StatusBar.setOverlaysWebView({ overlay: false }); } catch { /* ignore */ }
    await SplashScreen.hide();
  } catch {
    /* ignore */
  }
}

/* ---------------- Hardware back button ---------------- */

/**
 * Subscribe to the Android hardware back-button. The call screen uses this
 * to intercept back and trigger the "End call?" confirmation instead of
 * navigating away mid-call.
 *
 * Returns an unsubscribe function.
 */
export function onHardwareBack(handler: () => boolean | void): () => void {
  if (!isNative()) return () => {};
  let cleanup: (() => void) | undefined;
  (async () => {
    const { App } = await import('@capacitor/app');
    const sub = await App.addListener('backButton', () => {
      const handled = handler();
      if (!handled) App.exitApp();
    });
    cleanup = () => sub.remove();
  })();
  return () => cleanup?.();
}

/* ---------------- Push notifications ---------------- */

export interface PushRegistration {
  token: string;
  platform: 'android' | 'ios' | 'web';
}

export async function registerPushNotifications(): Promise<PushRegistration | null> {
  if (!isNative()) return null;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return null;
    return await new Promise<PushRegistration | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 8000);
      PushNotifications.addListener('registration', (t) => {
        clearTimeout(timeout);
        resolve({ token: t.value, platform: platform() as 'android' });
      });
      PushNotifications.addListener('registrationError', () => {
        clearTimeout(timeout);
        resolve(null);
      });
      void PushNotifications.register();
    });
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------
 * Auto-registration on every app launch.
 *
 * Goals:
 *   - Run silently on every cold start AND on resume from background.
 *   - Pick up FCM token rotations (Android can rotate at any time after
 *     reinstall / clear-data / 28-day inactivity / Google Play Services
 *     refresh) and immediately push the fresh value to the server so
 *     stale tokens get replaced.
 *   - Idempotent — listeners attach exactly once per JS context, even
 *     if AppShell remounts.
 *
 * The caller supplies an `onToken` callback (wired to the
 * `registerDeviceToken` server function in AppShell) so this module
 * stays free of server-function imports.
 * ---------------------------------------------------------------- */

let pushAutoRegisterStarted = false;
let pushTokenHandler: ((reg: PushRegistration) => void) | null = null;
let lastSentToken: string | null = null;

export function startPushAutoRegister(
  onToken: (reg: PushRegistration) => void | Promise<void>,
): void {
  if (!isNative()) return;
  // Always keep the latest handler (component may remount with a new fn ref).
  pushTokenHandler = (reg) => { void onToken(reg); };

  if (pushAutoRegisterStarted) {
    // Already wired — just kick a fresh register() to surface current token.
    void kickPushRegister();
    return;
  }
  pushAutoRegisterStarted = true;

  (async () => {
    try {
      const [{ PushNotifications }, { App }] = await Promise.all([
        import('@capacitor/push-notifications'),
        import('@capacitor/app'),
      ]);

      // 1) Persistent registration listener — fires on initial token AND on
      //    every FCM-driven rotation. We forward unique values upstream.
      await PushNotifications.addListener('registration', (t) => {
        const token = t?.value;
        if (!token) return;
        if (token === lastSentToken) return;
        lastSentToken = token;
        pushTokenHandler?.({ token, platform: platform() as 'android' });
      });
      await PushNotifications.addListener('registrationError', (err) => {
        console.warn('[push] registrationError', err);
      });

      // 2) Re-kick on every resume so a token rotated in the background
      //    while the JS context was dead gets refreshed immediately.
      await App.addListener('appStateChange', (state) => {
        if (state.isActive) void kickPushRegister();
      });

      // 3) Initial kick on launch.
      await kickPushRegister();
    } catch (e) {
      console.warn('[push] auto-register init failed', e);
      pushAutoRegisterStarted = false;
    }
  })();
}

async function kickPushRegister(): Promise<void> {
  if (!isNative()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    // Only auto-register when the user has already granted permission.
    // The first-run prompt is owned by <PushPermissionGate> so it can show
    // an explainer (and inline guidance on deny) instead of a silent OS popup.
    if (perm.receive !== 'granted') return;
    await PushNotifications.register();
  } catch (e) {
    console.warn('[push] kick register failed', e);
  }
}

/** Forget the cached "last sent" token. Call on sign-out so the next user
 *  re-registers the same physical token under their own account. */
export function resetPushAutoRegisterCache(): void {
  lastSentToken = null;
}

/**
 * Read current push-notification permission state without prompting.
 * Used by <PushPermissionGate> to decide between explainer, request, or
 * inline "denied" guidance.
 */
export async function getPushPermissionState(): Promise<PermState> {
  if (!isNative()) {
    if (typeof Notification === 'undefined') return 'unknown';
    const p = Notification.permission;
    return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
  }
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    return normalizeNativePerm(perm.receive);
  } catch {
    return 'unknown';
  }
}

/**
 * Trigger the OS push-notification permission dialog (Android 13+ /
 * iOS). On grant, immediately register so the FCM token rotates to the
 * server right away. Returns the resulting permission state.
 */
export async function requestPushPermission(): Promise<PermState> {
  if (!isNative()) {
    if (typeof Notification === 'undefined') return 'unknown';
    try {
      const r = await Notification.requestPermission();
      return r === 'granted' ? 'granted' : r === 'denied' ? 'denied' : 'prompt';
    } catch {
      return 'unknown';
    }
  }
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const req = await PushNotifications.requestPermissions();
    const state = normalizeNativePerm(req.receive);
    if (state === 'granted') {
      try { await PushNotifications.register(); } catch { /* ignore */ }
    }
    return state;
  } catch {
    return 'unknown';
  }
}

/* ---------------- Full-screen-intent permission (Android 14+) ----------------
 * Without USE_FULL_SCREEN_INTENT granted at runtime, Android 14+ demotes our
 * incoming-call full-screen launch to a regular heads-up notification, which
 * means a killed/backgrounded app will NOT auto-pop the ringer screen.
 * Bridged via FullScreenIntentPlugin.java.
 */

interface FullScreenIntentBridge {
  check(): Promise<{ granted: boolean; required: boolean }>;
  openSettings(): Promise<void>;
}

let fullScreenIntentPlugin: FullScreenIntentBridge | null = null;
function fsiPlugin(): FullScreenIntentBridge | null {
  if (!isNative()) return null;
  if (!fullScreenIntentPlugin) {
    try {
      fullScreenIntentPlugin = registerPlugin<FullScreenIntentBridge>('FullScreenIntent');
    } catch {
      return null;
    }
  }
  return fullScreenIntentPlugin;
}

export async function checkFullScreenIntentPermission(): Promise<{ granted: boolean; required: boolean }> {
  const p = fsiPlugin();
  if (!p) return { granted: true, required: false };
  try {
    return await p.check();
  } catch {
    return { granted: true, required: false };
  }
}

export async function openFullScreenIntentSettings(): Promise<void> {
  const p = fsiPlugin();
  if (!p) return;
  try { await p.openSettings(); } catch { /* ignore */ }
}

/* ---------------- Background reliability (Autostart + battery) ----------------
 * OEM-specific Autostart toggles + REQUEST_IGNORE_BATTERY_OPTIMIZATIONS.
 * Without these, MIUI / FunTouch / ColorOS / Realme / Honor kill our process
 * shortly after backgrounding, so the FCM ringer push either never wakes
 * Talkora or can't launch the IncomingCallActivity. Bridged via
 * BackgroundReliabilityPlugin.java.
 */

export type OemVendor =
  | 'xiaomi' | 'vivo' | 'oppo' | 'realme' | 'oneplus'
  | 'honor' | 'huawei' | 'samsung' | 'asus' | 'letv'
  | 'nokia' | 'stock';

export interface BackgroundReliabilityStatus {
  vendor: OemVendor;
  autostartSupported: boolean;
  batteryOptIgnored: boolean;
  recommended: boolean;
}

interface BackgroundReliabilityBridge {
  status(): Promise<BackgroundReliabilityStatus>;
  requestIgnoreBatteryOptimizations(): Promise<{ granted: boolean; opened?: boolean }>;
  openBatterySettings(): Promise<{ opened: boolean }>;
  openAutostartSettings(): Promise<{ opened: boolean; vendor?: OemVendor; fallback?: boolean }>;
}

let bgReliabilityPlugin: BackgroundReliabilityBridge | null = null;
function bgPlugin(): BackgroundReliabilityBridge | null {
  if (!isNative() || platform() !== 'android') return null;
  if (!bgReliabilityPlugin) {
    try {
      bgReliabilityPlugin = registerPlugin<BackgroundReliabilityBridge>('BackgroundReliability');
    } catch { return null; }
  }
  return bgReliabilityPlugin;
}

export async function getBackgroundReliabilityStatus(): Promise<BackgroundReliabilityStatus | null> {
  const p = bgPlugin();
  if (!p) return null;
  try { return await p.status(); } catch { return null; }
}

export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  const p = bgPlugin();
  if (!p) return false;
  try {
    const r = await p.requestIgnoreBatteryOptimizations();
    return !!r.granted;
  } catch { return false; }
}

export async function openAutostartSettings(): Promise<boolean> {
  const p = bgPlugin();
  if (!p) return false;
  try {
    const r = await p.openAutostartSettings();
    return !!r.opened;
  } catch { return false; }
}

export async function openBatterySettings(): Promise<boolean> {
  const p = bgPlugin();
  if (!p) return false;
  try {
    const r = await p.openBatterySettings();
    return !!r.opened;
  } catch { return false; }
}


/* ---------------- Call permissions (mic / camera) ---------------- */

/**
 * Request RECORD_AUDIO (and CAMERA for video) at the OS level BEFORE the
 * call screen calls `navigator.mediaDevices.getUserMedia()`. Two reasons:
 *
 *  1. Capacitor's WebView only auto-grants `getUserMedia` requests for
 *     resources owned by a registered native plugin. Without the Camera
 *     plugin + voice-recorder plugin installed and synced, the WebView
 *     silently denies the request and the call fails with no prompt.
 *  2. Calling the plugin's `requestPermissions()` triggers the standard
 *     Android runtime permission dialog inside a user gesture chain.
 *
 * Safe on web — returns `granted: true` without prompting (the browser
 * will handle its own mic/camera prompt on the actual getUserMedia call).
 */
export type PermState = 'granted' | 'denied' | 'prompt' | 'unknown';

type NativePermissionState = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';

interface CallPermissionsPlugin {
  check(): Promise<{ microphone?: NativePermissionState; camera?: NativePermissionState }>;
  request(options: { kind: 'voice' | 'video' }): Promise<{ microphone?: NativePermissionState; camera?: NativePermissionState }>;
}

const CallPermissions = registerPlugin<CallPermissionsPlugin>('CallPermissions');

function normalizeNativePerm(state: string | undefined): PermState {
  if (state === 'granted') return 'granted';
  if (state === 'denied') return 'denied';
  if (state === 'prompt' || state === 'prompt-with-rationale') return 'prompt';
  return 'unknown';
}

/**
 * Read current mic/camera permission status WITHOUT prompting. Used by the
 * pre-call gate so we can show the user accurate badges and tailor the
 * next CTA (Allow vs. Open Settings).
 */
export async function checkCallPermissions(): Promise<{ mic: PermState; camera: PermState }> {
  if (isNative()) {
    try {
      if (Capacitor.isPluginAvailable('CallPermissions')) {
        const status = await CallPermissions.check();
        return {
          mic: normalizeNativePerm(status.microphone),
          camera: normalizeNativePerm(status.camera),
        };
      }
    } catch {
      // Fall through to plugin-specific checks for older installed builds.
    }
    let mic: PermState = 'unknown';
    let camera: PermState = 'unknown';
    try {
      const { VoiceRecorder } = await import('@independo/capacitor-voice-recorder');
      const has = await VoiceRecorder.hasAudioRecordingPermission();
      mic = has.value ? 'granted' : 'prompt';
    } catch { mic = 'unknown'; }
    try {
      const { Camera } = await import('@capacitor/camera');
      const status = await Camera.checkPermissions();
      const v = status.camera;
      camera = v === 'granted' ? 'granted'
        : v === 'denied' ? 'denied'
        : v === 'prompt' || v === 'prompt-with-rationale' ? 'prompt'
        : 'unknown';
    } catch { camera = 'unknown'; }
    return { mic, camera };
  }
  // Web: Permissions API (best-effort; Safari may not support 'camera').
  const read = async (name: PermissionName): Promise<PermState> => {
    try {
      // @ts-ignore — name strings beyond the lib's union
      const r = await navigator.permissions?.query?.({ name });
      if (!r) return 'unknown';
      return (r.state as PermState) ?? 'unknown';
    } catch { return 'unknown'; }
  };
  const [mic, camera] = await Promise.all([
    read('microphone' as PermissionName),
    read('camera' as PermissionName),
  ]);
  return { mic, camera };
}

/** Open the OS app-settings screen so the user can flip a denied permission. */
export async function openAppSettings(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const mod = await import('capacitor-native-settings');
    if (mod?.NativeSettings?.open) {
      await mod.NativeSettings.open({
        optionAndroid: mod.AndroidSettings.ApplicationDetails,
        optionIOS: mod.IOSSettings.App,
      });
      return true;
    }
  } catch { /* ignore */ }
  try {
    const { App } = await import('@capacitor/app');
    // Fallback: at least surface a hint; can't deep-link without the plugin.
    void App;
  } catch { /* ignore */ }
  return false;
}

/* ---- Last denial reason (for the debug panel) ---- */
const LAST_PERM_KEY = 'talkora.lastPermDenial';
const PERM_FAIL_COUNT_KEY = 'talkora.permFailCount';
export interface LastPermDenial {
  kind: 'voice' | 'video';
  reason: string;
  at: number;
}
export function getLastPermDenial(): LastPermDenial | null {
  try {
    const raw = localStorage.getItem(LAST_PERM_KEY);
    return raw ? (JSON.parse(raw) as LastPermDenial) : null;
  } catch { return null; }
}
export function clearLastPermDenial(): void {
  try { localStorage.removeItem(LAST_PERM_KEY); } catch { /* ignore */ }
}
function recordPermDenial(kind: 'voice' | 'video', reason: string): void {
  try {
    localStorage.setItem(LAST_PERM_KEY, JSON.stringify({ kind, reason, at: Date.now() }));
  } catch { /* ignore */ }
}

/* ---- Consecutive failure counter (drives auto-open of debug panel) ---- */
export function getPermFailCount(): number {
  try {
    const n = parseInt(localStorage.getItem(PERM_FAIL_COUNT_KEY) ?? '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}
export function resetPermFailCount(): void {
  try { localStorage.removeItem(PERM_FAIL_COUNT_KEY); } catch { /* ignore */ }
}
function bumpPermFailCount(): number {
  const next = getPermFailCount() + 1;
  try { localStorage.setItem(PERM_FAIL_COUNT_KEY, String(next)); } catch { /* ignore */ }
  return next;
}

async function _requestCallPermissionsImpl(kind: 'voice' | 'video'): Promise<{
  granted: boolean;
  reason?: 'mic-denied' | 'camera-denied' | 'media-denied' | 'media-unavailable' | 'plugin-missing';
}> {
  const verifyWebRtcCapture = async (): Promise<{
    granted: boolean;
    reason?: 'mic-denied' | 'camera-denied' | 'media-denied' | 'media-unavailable';
  }> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { granted: false, reason: 'media-unavailable' };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: kind === 'video' ? { width: 640, height: 480, facingMode: 'user' } : false,
      });
      stream.getTracks().forEach((track) => track.stop());
      return { granted: true };
    } catch (error: unknown) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        return { granted: false, reason: 'media-unavailable' };
      }
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
        return { granted: false, reason: kind === 'video' ? 'media-denied' : 'mic-denied' };
      }
      return { granted: false, reason: 'media-denied' };
    }
  };

  if (!isNative()) return verifyWebRtcCapture();
  try {
    // Android WebView/WebRTC is the source of truth for calls. Trigger
    // getUserMedia first while we are still inside the user's tap handler so
    // Capacitor's WebChromeClient can surface the real mic/camera prompt used
    // by Agora/100ms. Native plugin requests are only a fallback for devices
    // where WebView refuses before the OS permission is primed.
    const directWebRtc = await verifyWebRtcCapture();
    if (directWebRtc.granted) return directWebRtc;

    if (directWebRtc.reason === 'media-unavailable') {
      return directWebRtc;
    }

    // Fallback path for Android builds: one small native bridge owns the
    // runtime permission dialog for RECORD_AUDIO/CAMERA when WebRTC did not
    // show the prompt itself.
    try {
      if (Capacitor.isPluginAvailable('CallPermissions')) {
        const status = await CallPermissions.request({ kind });
        const mic = normalizeNativePerm(status.microphone);
        const camera = normalizeNativePerm(status.camera);
        if (mic !== 'granted') return { granted: false, reason: 'mic-denied' };
        if (kind === 'video' && camera !== 'granted') {
          return { granted: false, reason: 'camera-denied' };
        }
        return await verifyWebRtcCapture();
      }
    } catch (e) {
      console.warn('[perm] native call-permissions bridge unavailable', e);
      // Continue to the fallback bridges below.
    }

    // Microphone — required for both voice and video.
    try {
      const { VoiceRecorder } = await import('@independo/capacitor-voice-recorder');
      let hasValue = false;
      try {
        const has = await VoiceRecorder.hasAudioRecordingPermission();
        hasValue = has.value;
      } catch {
        // Some Android WebView / OEM combinations cannot query status but can
        // still show the runtime dialog when requestAudioRecordingPermission()
        // is called from the user's tap.
        hasValue = false;
      }
      if (!hasValue) {
        const req = await VoiceRecorder.requestAudioRecordingPermission();
        if (!req.value) return { granted: false, reason: 'mic-denied' };
      }
    } catch (e) {
      console.warn('[perm] mic plugin missing', e);
      return { granted: false, reason: 'plugin-missing' };
    }
    if (kind === 'video') {
      try {
        const { Camera } = await import('@capacitor/camera');
        const status = await Camera.checkPermissions();
        if (status.camera !== 'granted') {
          const req = await Camera.requestPermissions({ permissions: ['camera'] });
          if (req.camera !== 'granted') return { granted: false, reason: 'camera-denied' };
        }
      } catch (e) {
        console.warn('[perm] camera plugin missing', e);
        return { granted: false, reason: 'plugin-missing' };
      }
    }

    // Final and most important check: WebRTC itself must be allowed in the
    // Android WebView.
    return await verifyWebRtcCapture();
  } catch (e) {
    console.warn('[perm] requestCallPermissions failed', e);
    return { granted: false, reason: 'plugin-missing' };
  }
}

export async function requestCallPermissions(kind: 'voice' | 'video') {
  const res = await _requestCallPermissionsImpl(kind);
  if (!res.granted && res.reason) {
    recordPermDenial(kind, res.reason);
    bumpPermFailCount();
  } else if (res.granted) {
    clearLastPermDenial();
    resetPermFailCount();
  }
  return res;
}


/* ---------------- Device fingerprint (for ban_signals) ---------------- */

export async function getNativeDeviceId(): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const { Device } = await import('@capacitor/device');
    const id = await Device.getId();
    return id.identifier ?? null;
  } catch {
    return null;
  }
}
