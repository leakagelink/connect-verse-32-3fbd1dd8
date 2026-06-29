# Talkora — Android (Capacitor) Build Guide

Phase 4 wraps the Talkora web app into a Play-Store-ready Android APK/AAB using **Capacitor**. The web build is unchanged — Android is a native shell that loads the same UI, plus a few native capabilities (screenshot block, push, secure recents preview).

> All commands below use **PowerShell** (per your environment).

---

## 0. If your laptop copy is broken, do a truly fresh clone

Do **not** delete only the `android/` folder inside the project. That removes Talkora's custom native permission bridge (`CallPermissionsPlugin`) and causes camera/mic prompts to stop working. If you want a fresh copy, delete/rename the whole project folder and clone again:

```powershell
cd C:\Users\ASUS
Rename-Item connect-verse-32 connect-verse-32-old -ErrorAction SilentlyContinue
git clone https://github.com/leakagelink/connect-verse-32.git
cd connect-verse-32
```

Then use the automated script below. It fixes `JAVA_HOME`, installs packages, builds web assets, syncs Android, verifies the live URL + native call-permission files, and opens Android Studio:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-fresh-android-build.ps1 -OpenAndroidStudio
```

If Android Studio is installed in the default path, this script uses Android Studio's bundled JDK automatically. The `inputValidator()` lines in the build output are deprecation warnings, not build errors.

---

## 1. One-time machine setup

Install on your Windows dev machine:

1. **Node 20+** and **bun** (already used by this project).
2. **Android Studio** (Hedgehog or newer) + Android SDK 34 + Build-Tools 34.
3. **JDK 17 or newer** (Android Studio bundles one — the script auto-points `JAVA_HOME` at it when your existing `JAVA_HOME` is invalid).
4. Set environment variable `ANDROID_HOME` to your SDK location, e.g.
   ```powershell
   setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
   ```

---

## 2. Initialise the Android project (run once)

From the repo root in PowerShell:

```powershell
bun run build
bunx cap sync android
```

The `android/` folder is already part of this repo and contains Talkora's custom native permission bridge. Do **not** run `cap add android` unless you are intentionally recreating the native project from scratch and then re-applying all Talkora native files.

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

<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.microphone" android:required="false" />
```

Inside `<application>`:

```xml
android:usesCleartextTraffic="false"
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
bunx cap sync android
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

### Important checks before running from Android Studio

```powershell
Test-Path android\app\src\main\java\in\talkora\app\CallPermissionsPlugin.java
Get-Content android\app\src\main\assets\capacitor.config.json | Select-String connect-verse-32.lovable.app
Get-Content android\app\src\main\AndroidManifest.xml | Select-String "RECORD_AUDIO|CAMERA|POST_NOTIFICATIONS"
```

All three checks must return output. If not, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-fresh-android-build.ps1
```

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
