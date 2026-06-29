
# Background incoming-call wake-up (WhatsApp style)

Goal: jab koi user/creator app close/background me ho aur koi unhe call kare, to phone ki lock screen pe full-screen incoming-call UI khule with Accept/Reject, aur Accept pe app khulkar call connect ho jaye.

## Aapko Firebase me ek-baar ka setup karna hoga

Mere paas `FCM_SERVICE_ACCOUNT_JSON` already saved hai (server-side push send karne ke liye), lekin Android app ke liye `google-services.json` aapko Firebase Console se download karke project me daalna hoga. Steps:

1. https://console.firebase.google.com par jao → **Add project** → naam: `Talkora` (ya jo aap chahein).
2. Project ke andar **Add app → Android** select karo.
3. **Android package name** dalo exactly: `app.lovable.1f2f31124f554d2fa8de269e271b47a3` (ya jo bhi aapke `capacitor.config.ts` me `appId` hai — main verify karunga).
4. App nickname: `Talkora`, SHA-1 optional (release signing ke time chahiye).
5. **Download `google-services.json`** — mujhe is file ka content chat me paste kar do (ya upload karo), main `android/app/google-services.json` me daal dunga.
6. Firebase console me **Project Settings → Service Accounts → Generate new private key** se JSON download karo — agar pehle wala `FCM_SERVICE_ACCOUNT_JSON` is naye project ka nahi hai, to mujhe bata dena, main update kar dunga. Warna skip.

Bas itna manual kaam hai. Baaki sab main code karunga.

## Implementation (mera kaam)

### 1. Device token registration
- `@capacitor/push-notifications` plugin install.
- `src/lib/push-register.ts`: app boot pe permission maango, FCM token lo, `device_tokens` table me upsert karo (token + platform + user_id + last_seen).
- Sign-out pe token delete.

### 2. Server-side push trigger
- `src/lib/call-push.functions.ts` me `sendCallInvitePush` server fn — `requireSupabaseAuth`, inside handler `supabaseAdmin` se receiver ke active tokens lo, FCM HTTP v1 API ko **high-priority data-only** message bhejo (Google access token Service Account JSON se mint).
- Payload: `{ type: "incoming_call", invite_id, caller_id, caller_name, caller_avatar, kind: "voice"|"video", agora_channel }`.
- `createCallInvite` me, invite insert ke turant baad, fire-and-forget `sendCallInvitePush` call.
- Hang-up / cancel / no-answer pe ek `cancelCallInvitePush` bhi bhejo (`type: "cancel_call"`) taaki dusri side ka full-screen UI auto-dismiss ho.

### 3. Android native — full-screen incoming call
Naye files `android/app/src/main/java/.../`:
- **`TalkoraMessagingService.java`** (extends `FirebaseMessagingService`):
  - `onMessageReceived` me `type=="incoming_call"` → `IncomingCallActivity` launch karo via `PendingIntent` with `FLAG_ACTIVITY_NEW_TASK`.
  - `type=="cancel_call"` → notification cancel + broadcast bhejo.
  - `onNewToken` → WebView ke through JS bridge se naya token sync.
- **`IncomingCallActivity.java`**:
  - `setShowWhenLocked(true)` + `setTurnScreenOn(true)` + `KeyguardManager.requestDismissKeyguard`.
  - Custom layout: caller avatar, name, "Incoming voice/video call", **Accept** (green) + **Reject** (red).
  - Ringtone (`RingtoneManager.TYPE_RINGTONE`) + vibration pattern.
  - Accept → MainActivity ko deep link intent (`talkora://call/<kind>/<callerId>?invite=<id>&action=accept`).
  - Reject → server fn call via broadcast → activity finish.
- **High-priority notification channel** `incoming_calls` with `IMPORTANCE_HIGH`, `setBypassDnd(true)`, full-screen intent attached (Android 10+ fallback agar activity directly launch na ho).
- **`CallForegroundService.java`** with `FOREGROUND_SERVICE_PHONE_CALL` — call connect hone ke baad start ho, ongoing notification rakhe (Play Store policy compliant).

### 4. `AndroidManifest.xml` updates
- Permissions: `USE_FULL_SCREEN_INTENT`, `POST_NOTIFICATIONS`, `WAKE_LOCK`, `VIBRATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_PHONE_CALL`, `DISABLE_KEYGUARD`.
- Register `TalkoraMessagingService` (FCM intent-filter), `IncomingCallActivity` (`showWhenLocked`, `turnScreenOn`, `launchMode=singleInstance`), `CallForegroundService` (`foregroundServiceType=phoneCall`).
- Deep link intent-filter on `MainActivity` for `talkora://call/*`.

### 5. `build.gradle` + plugins
- `android/build.gradle`: `com.google.gms:google-services` classpath.
- `android/app/build.gradle`: `apply plugin: 'com.google.gms.google-services'`, `firebase-bom`, `firebase-messaging`.

### 6. Deep-link handling in React app
- `src/router.tsx` ya root pe Capacitor `App.addListener('appUrlOpen')` → parse `talkora://call/<kind>/<callerId>?invite=<id>&action=accept` → router.navigate to existing `/call/$kind/$userId` route with `?autoAccept=1`.
- Call route me `autoAccept` flag dekhe to invite ko turant `accepted` mark kare + Agora join start kare (existing flow reuse).

### 7. Play Store policy compliance
- Privacy Policy me FCM + microphone/camera background use mention (already exists, sirf line add).
- `USE_FULL_SCREEN_INTENT` Android 14+ pe sirf "calling apps" ko default-granted; in-app prompt rakhenge agar permission revoked.
- Foreground service ki notification clearly "Ongoing call with X" dikhayega.

## Test plan (mere taraf se)
1. Server fn ko `invoke-server-function` se trigger karke FCM payload format verify.
2. APK build → ek device pe app band karke, dusre device se call → lock screen pe full-screen UI verify.
3. Accept → app open → Agora connect verify.
4. Caller cancel → receiver ka UI auto-dismiss verify.

## Aage kya chahiye aapse

1. **`google-services.json`** Firebase console se download karke share karo (steps upar).
2. Confirm karo: agar `FCM_SERVICE_ACCOUNT_JSON` secret purane Firebase project ka hai to naya JSON bhi share karo — warna main yahi use kar lunga.

Confirmation aate hi main turant implementation start karunga (estimated ~12-15 file changes).
