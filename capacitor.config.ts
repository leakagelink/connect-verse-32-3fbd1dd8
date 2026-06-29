import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Talkora — Capacitor (Android) configuration.
 *
 * Production wrap target:
 *   - appId: in.talkora.app   (final id will be reserved on Play Console)
 *   - appName: Talkora
 *
 * The Android shell loads the published Talkora deployment so server-backed
 * features (presence, creators, calls, wallets) behave exactly like the web app.
 * Re-run `bunx cap sync android` after native/config changes before building.
 */
const config: CapacitorConfig = {
  appId: 'in.talkora.app',
  appName: 'Talkora',
  webDir: '.output/public',
  server: {
    // Talkora is a TanStack Start app — it NEEDS a live backend for server
    // functions (presence, creators list, calls, wallet, gifts, …). A pure
    // bundled APK has no server, so every server-fn POST returns 404 and the
    // app appears empty (no online creators, calls never start, etc.).
    //
    // Loading the published deployment makes the Android wrap behave exactly
    // like the website that already works for the user.
    url: 'https://connect-verse-32.lovable.app',
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: ['connect-verse-32.lovable.app', '*.lovable.app', 'talkora.app', '*.talkora.app'],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    // Phase 10 — custom URL scheme: talkora://chat/<id>, talkora://recharge, …
    // Register the intent-filter in android/app/src/main/AndroidManifest.xml
    // with <data android:scheme="talkora" />.
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0B0B12',
      androidSplashResourceName: 'splash',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0B0B12',
      overlaysWebView: false,
    },
    PrivacyScreen: {
      // Hides app preview in the recents switcher + blocks screenshots on
      // sensitive screens (KYC, calls, withdrawals). We toggle this at
      // runtime via the privacy-screen plugin.
      enable: true,
      imageName: 'splash',
      preventScreenshots: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
