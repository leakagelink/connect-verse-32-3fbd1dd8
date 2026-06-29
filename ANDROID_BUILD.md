# Talkora — Android (Capacitor) Build Guide

Phase 4 wraps the Talkora web app into a Play-Store-ready Android APK/AAB using **Capacitor**. The web build is unchanged — Android is a native shell that loads the same UI, plus a few native capabilities (screenshot block, push, secure recents preview).

> All commands below use **PowerShell** (per your environment).

---

## 1. One-time machine setup

Install on your Windows dev machine:

1. **Node 20+** and **bun** (already used by this project).
2. **Android Studio** (Hedgehog or newer) + Android SDK 34 + Build-Tools 34.
3. **JDK 17** (Android Studio bundles one — point `JAVA_HOME` at it).
4. Set environment variable `ANDROID_HOME` to your SDK location, e.g.
   ```powershell
   setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
   ```

---

## 2. Initialise the Android project (run once)

From the repo root in PowerShell:

```powershell
bun run build
npx cap add android
npx cap sync android
```

This generates the `android/` folder. Commit it.

---

## 3. Required `AndroidManifest.xml` additions

Android does **not** show Camera/Microphone permission at install time. Only notification permission appears on install/first launch. Mic/camera permission should appear when the user taps **Allow access** on the call permission screen. If it does not appear, confirm these manifest entries exist and rebuild the APK/AAB.

Open `android/app/src/main/AndroidManifest.xml` and add inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />

<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.microphone" android:required="true" />
```

Inside `<application>`:

```xml
android:usesCleartextTraffic="false"
android:networkSecurityConfig="@xml/network_security_config"
```

Create `android/app/src/main/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
```

---

## 4. App icons & splash

Drop a 1024×1024 PNG at `resources/icon.png` and a 2732×2732 PNG at `resources/splash.png`, then:

```powershell
npx @capacitor/assets generate --android
```

---

## 5. Sign your release build

1. Generate a keystore (keep it safe — same key signs every future update):

   ```powershell
   keytool -genkey -v -keystore talkora-release.keystore -alias talkora -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Add to `android/key.properties` (do **NOT** commit this file):

   ```
   storePassword=...
   keyPassword=...
   keyAlias=talkora
   storeFile=../talkora-release.keystore
   ```

3. Wire it up in `android/app/build.gradle` (Android Studio shows the exact `signingConfigs` snippet to paste).

---

## 6. Build the upload bundle (AAB)

```powershell
bun run build
npx cap sync android
cd android
./gradlew bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab` — that file goes to Play Console.

### If the APK still shows an old/wrong UI

Capacitor can keep an old native bundle or Android can keep old app data. From the repo root in **PowerShell**, rebuild cleanly:

```powershell
bun run build
New-Item -ItemType Directory -Force -Path "android\app\src\main\assets"
npx cap sync android
Set-Location android
.\gradlew clean
.\gradlew assembleDebug
Set-Location ..
```

Then uninstall the old app from the phone/emulator and install again. If a device is connected:

```powershell
adb uninstall in.talkora.app
adb install "android\app\build\outputs\apk\debug\app-debug.apk"
```

This project **does** set `server.url` to the live Talkora web app. That is required because creators, presence, calls, wallet, gifts and server functions need the live backend. If the APK acts static/empty, verify `android/app/src/main/assets/capacitor.config.json` contains `https://connect-verse-32.lovable.app`, then uninstall the old app and reinstall.

---

## 7. Play Console submission checklist

Already covered inside the app — for the listing form you'll need:

- **Privacy policy URL** → `https://<your-domain>/privacy`
- **Account deletion URL** → `https://<your-domain>/delete-account`
- **Terms of service** → `https://<your-domain>/terms`
- **Community guidelines** → `https://<your-domain>/community-guidelines`
- **Safety policy** → `https://<your-domain>/safety`
- **Data Safety form** — declare: Personal info (name, email, phone), Photos (KYC docs — encrypted, auto-deleted), Audio (call recording samples for AI moderation — not stored), Location (country/state, coarse), Financial (UPI/bank for withdrawals).
- **Content rating** → IARC questionnaire: User-to-user communication = Yes, User-generated content = Yes, Unrestricted internet = Yes → expect **Mature 17+**.
- **Target audience** → 18+. Toggle off "appeals to children".
- **In-app purchases** → list coin packs ₹9 – ₹50,000.
- **Permissions justification** — camera + mic only used during live calls; foreground service ensures the call survives backgrounding.

---

## 8. Native features wired in this phase

| Feature | Where it's used | Implementation |
|---|---|---|
| Block screenshots / hide recents preview | Call screen, KYC, Withdrawals | `useScreenPrivacy()` → `@capacitor-community/privacy-screen` (FLAG_SECURE) |
| Status-bar colour + splash hide on boot | `AppShell` | `applyChromeForApp()` |
| Hardware back button → "End call?" prompt | Call screen | `onHardwareBack()` |
| Push notifications (incoming calls / messages) | `AppShell` registration | `registerPushNotifications()` — token stored in `profiles.push_token` |
| Native device id for ban-evasion signals | `SafetySignalsProbe` | `getNativeDeviceId()` merged into `ban_signals.device_hash` |

All helpers live in `src/lib/native.ts` and are **safe no-ops on web**, so the same codebase keeps running unchanged in the browser preview.

---

## 9. Updating after a web change

After any web change you ship to production:

```powershell
bun run build
npx cap sync android
```

If `capacitor.config.ts` still uses `server.url` pointing at your live web build, you usually **don't need to rebuild the APK** — users get the new web UI on next launch. Rebuild only when you change native code, plugins, permissions, or app version.
