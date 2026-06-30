# Talkora — Google Play Store Submission Kit (Phase 5)

Everything you need to fill the **Play Console** listing without writing copy yourself. Paste each block into the matching Console field. Hindi context kept in mind — copy is plain English at 6th-grade level so Google's policy review reads it cleanly.

> Read order: §1 Listing → §2 Data Safety → §3 Content rating → §4 In-App purchases → §5 Screenshots prompt-pack → §6 Pre-launch checklist.

---

## 1. Store Listing

### App name (max 30)
```
Talkora: Voice & Video Chat
```

### Short description (max 80)
```
Live voice & video chat with verified creators. Coins, gifts, rooms & games.
```

### Full description (max 4000)

```
Talkora is a live voice and video chat community for adults (18+) to meet new friends, join interest-based rooms, send gifts, and play quick mystery games together. Every new account gets 5 free minutes of calling on signup — no card needed.

WHAT YOU CAN DO ON TALKORA
• Discover online creators with verified profiles, language and location
• Voice and video call 1-on-1 with anyone available
• Join public rooms or female-hosted "Ladies Lounge" rooms
• Chat one-to-one with realtime messaging
• Send virtual gifts during live calls
• Play AI-generated mystery cases with your call partner
• Track every call in your Recents history

CREATOR EARNINGS
Female creators can sign up free, set their availability, and earn coins on every call, message and gift they receive. Coins convert to INR and can be withdrawn to a verified bank account or UPI after a one-time KYC (Aadhaar + PAN). Minimum withdrawal: 10,000 coins (₹500).

COIN PACKS & BONUS
Coins start at just ₹9 and go up to ₹50,000. Bonus on first three top-ups:
• First recharge — 50% extra
• Second recharge — 40% extra
• Third recharge — 30% extra

SAFETY FIRST
• Mandatory 18+ confirmation at signup
• Aadhaar/PAN KYC for every female creator before payout
• In-call SOS button — one tap reports the partner and ends the call
• 24/7 AI moderation reviews random audio/video samples for nudity, harassment and abuse
• Three-strike auto-ban for confirmed policy violations
• Per-creator block lists by country, state and individual user
• Hidden DOB — partners only see username, gender, country and state
• Screenshot block on calls, KYC and withdrawal screens

YOUR CONTROL
• Block, mute and report any user from inside the chat or call
• "Download my data" export from Settings
• Delete your account anytime from Settings → Account, or from talkoraapp.com/delete-account without opening the app
• Language switcher: English and हिन्दी

POLICIES
By using Talkora you agree to our Terms of Service, Community Guidelines, Privacy Policy and Refund Policy linked inside the app.

Talkora is intended for users aged 18 and above. Sexually explicit content, harassment, and CSAM are strictly prohibited and result in permanent ban + escalation to authorities.
```

### App category / Tags

| Field | Value |
|---|---|
| App category | **Social** (primary) — alternate: Communication |
| Tags (pick up to 5) | Chat & messaging, Video calling, Voice calling, Live communities, Dating & social |

### Contact details

| Field | Value |
|---|---|
| Email | `support@talkora.app` |
| Website | `https://talkoraapp.com` |
| Phone | (optional — only if you have a verified business line) |

### External legal URLs (must be reachable before submission — already implemented in the app)

| Console field | URL |
|---|---|
| Privacy policy | `https://talkoraapp.com/privacy` |
| Terms of service | `https://talkoraapp.com/terms` |
| Community guidelines | `https://talkoraapp.com/community-guidelines` |
| Safety policy | `https://talkoraapp.com/safety` |
| Refund policy | `https://talkoraapp.com/refund-policy` |
| Account deletion (web) | `https://talkoraapp.com/delete-account` |

---

## 2. Data Safety form

Declare exactly this in **Policy → App content → Data safety**. Anything we collect must appear here or Play will reject.

| Data type | Collected? | Shared? | Optional? | Purpose | Notes |
|---|---|---|---|---|---|
| **Name** (username) | Yes | No | No | App functionality, Account management | Public to other users |
| **Email address** | Yes | No | No | Account management | Used only for sign-in & receipts |
| **User ID** | Yes | No | No | App functionality | Internal id, exposed to other users in call logs |
| **Phone number** | Optional | No | Yes | Account management, Fraud prevention | Only if user adds it for OTP/login |
| **Address — Country & State** | Yes | No | No | App functionality | Shown to call partners |
| **Photos** (avatar) | Yes | No | Yes | App functionality | Public profile picture |
| **Photos** (KYC documents — Aadhaar / PAN) | Yes | No | No | Identity verification, Fraud prevention | **Encrypted at rest. Auto-deleted: 7 days after KYC approval, 30 days after rejection.** Female creators only. |
| **Voice / sound recordings — short samples** | Yes | No | No | Safety / fraud prevention | 4-second clips sampled during calls, sent to AI moderation, **never stored after classification**. |
| **Video frames — single frame** | Yes | No | No | Safety / fraud prevention | 320×240 JPEG sampled during video calls, classified by AI, **never stored after classification**. |
| **In-app messages** | Yes | No | No | App functionality | Stored to deliver to recipient. Moderated for abuse. |
| **App interactions** | Yes | No | No | Analytics, App functionality | Call logs, recharge history |
| **Device or other identifiers** | Yes | No | No | Fraud prevention, Security | Device hash used for ban-evasion detection (no raw IMEI/MAC). |
| **Approximate location** | Yes | No | Yes | App functionality | Derived from country/state user picks at onboarding. No GPS. |
| **Payment info** | Yes | No | No | App functionality (purchases) | Processed by payment gateway — Talkora never sees full card. |
| **Bank/UPI details (creator payouts)** | Yes | No | No | App functionality | Stored only for verified KYC creators. |
| **Crash logs / diagnostics** | Yes | No | Yes | Analytics, Crash reporting | Anonymous. |

### Security practices (tick these)

- ✅ Data is encrypted in transit (HTTPS / TLS)
- ✅ Data is encrypted at rest
- ✅ Users can request that their data be deleted (in-app + web URL)
- ✅ Independent security review — **leave UNCHECKED** unless you have one
- ✅ Committed to follow the Play Families Policy — **leave UNCHECKED** (app is 18+)
- ✅ Data collection complies with the Mobile Unwanted Software policy

---

## 3. Content rating questionnaire (IARC)

Answer the IARC form exactly like this — anything else risks the wrong age band.

| Question | Answer |
|---|---|
| Does the app contain violence? | No |
| Sexual content / nudity? | No (app forbids it; moderated) |
| Profanity / crude humor? | Mild — user-generated chat may contain language |
| Controlled substances? | No |
| Gambling / simulated gambling? | No |
| Horror / fear themes? | No |
| **User-generated content?** | **Yes** |
| **Users interact / communicate with each other?** | **Yes — text, voice and video** |
| **Users can share their location with other users?** | No (only country/state shown) |
| **Personal info shared with other users?** | Yes — username, gender, country, state |
| Unrestricted access to the internet? | Yes |
| Digital purchases? | Yes |

**Expected outcome**: IARC **17+ / Mature 17+** (Communication + UGC = mandatory).

**Target audience**: 18 and over only. Toggle OFF "appeals to children" and OFF "mixed audience".

---

## 4. In-App Products (coin packs)

Create these as **Managed products** (one-time, consumable) in Console → Monetize → In-app products. SKU naming `coins_<inr-amount>`.

| SKU | Title | Price (INR) | Coins | First-buy bonus (50%) | Notes |
|---|---|---|---|---|---|
| `coins_9` | 90 Coins | ₹9 | 90 | +45 | Starter pack |
| `coins_49` | 550 Coins | ₹49 | 550 | +275 | |
| `coins_99` | 1,150 Coins | ₹99 | 1,150 | +575 | Most popular |
| `coins_249` | 3,000 Coins | ₹249 | 3,000 | +1,500 | |
| `coins_499` | 6,200 Coins | ₹499 | 6,200 | +3,100 | |
| `coins_999` | 12,800 Coins | ₹999 | 12,800 | +6,400 | |
| `coins_2499` | 33,000 Coins | ₹2,499 | 33,000 | +16,500 | |
| `coins_4999` | 68,000 Coins | ₹4,999 | 68,000 | +34,000 | |
| `coins_9999` | 140,000 Coins | ₹9,999 | 140,000 | +70,000 | VIP |
| `coins_24999` | 360,000 Coins | ₹24,999 | 360,000 | +180,000 | |
| `coins_49999` | 750,000 Coins | ₹49,999 | 750,000 | +375,000 | Whale |

> Reminder: the 50/40/30% bonus applies on **first / second / third** lifetime top-ups respectively — the price field in Console stays the same; the bonus is added by our backend after the purchase webhook fires.

---

## 5. Visual assets — prompt-pack (paste into our image generator)

Generate locally (or in Lovable) at the listed dimensions. All assets must use the same dark gradient brand (#0B0B12 → #1A0B2E) and the Talkora wordmark.

### App icon (512×512 PNG, no alpha)
```
A square app icon, 512x512, no transparency. Bold gradient from deep violet #2A0B4A bottom-left to electric pink #E5096B top-right. Centered: a chat-bubble silhouette in pure white with a small play/triangle inside it suggesting voice + video. Flat, modern, no text, no shadows, no glow. Apple/Material clarity.
```

### Feature graphic (1024×500 JPG)
```
Wide hero banner 1024x500, dark midnight gradient background (#0B0B12 to #1A0B2E). Left half: stylized Talkora wordmark in bold sans-serif white, with a small magenta dot above the "i". Right half: three floating phone mockups at slight tilt showing a video call screen, a chat bubble, and a glowing coin icon. Soft pink and violet bokeh particles. Tagline beneath wordmark in light gray: "Live voice + video. Real connections."
```

### Phone screenshots (1080×1920 PNG, minimum 4, recommend 8)

For each, use a phone frame mock with the actual app screen inside. The caption sits in the top 25% of the canvas.

| # | Caption (top of frame, max 5 words) | Screen to capture |
|---|---|---|
| 1 | **Meet creators live, now** | Discover tab with online creator cards visible |
| 2 | **5 free minutes on signup** | Discover banner "5 min free — Use now" |
| 3 | **One-tap video calls** | Connect screen with audio/video buttons and per-minute coin label |
| 4 | **Join rooms by interest** | Rooms tab list (including Ladies Lounge badge) |
| 5 | **Send gifts in calls** | Active call with floating gift animation |
| 6 | **Play AI mystery cases** | MysteryPanel mid-call |
| 7 | **Safe & moderated 24/7** | SOS button + safety tip overlay |
| 8 | **Cash out your coins** | Withdraw screen with KYC verified badge |

### Promo video (optional, 30s, YouTube unlisted)
Storyboard:
```
0:00 — Talkora wordmark fades in on dark gradient
0:03 — "Meet. Talk. Earn." typed line-by-line
0:07 — Quick cuts: Discover tab, incoming video call, mystery game
0:18 — Coin pack screen, "₹9 starter pack — 50% first-time bonus"
0:23 — Safety reel: SOS, KYC badge, 18+
0:28 — End card: "Download Talkora — Free on Play Store"
```

---

## 6. Pre-launch policy checklist (run this before clicking "Send for review")

- [ ] Test account credentials filled in Console → App content → App access (Play reviewers need a working login).
- [ ] **Sensitive permissions justification** submitted for camera, mic, foreground service mic, foreground service camera, post-notifications.
- [ ] **Real-money trading / virtual currency** declared — coins are virtual, non-refundable except per Refund Policy, cannot be transferred between users.
- [ ] **UGC** declaration: in-app reporting flow (DONE), moderation workflow (DONE), 18+ gate (DONE).
- [ ] **Account deletion** — both in-app (Settings → Account → Delete) and web URL (`/delete-account`) reachable without login.
- [ ] **Data deletion** — verify "Download my data" works end-to-end.
- [ ] All **policy URLs** load with HTTPS and a valid cert.
- [ ] **App bundle size** under 150 MB (AAB will be ~15 MB — fine).
- [ ] **Signing key** stored in a password manager + offline backup. Lose it = can never update the app again.
- [ ] **Privacy policy** explicitly mentions: KYC retention windows, AI moderation sampling, device fingerprinting for ban evasion, third-party payment processor name.
- [ ] Pre-launch report ran on Console → Testing → Pre-launch report, no critical issues.
- [ ] Internal testing track populated with at least 1 tester; verified the AAB installs and signs in.

---

## 7. Reviewer notes (paste into Console → App content → App access → Instructions)

```
Talkora is an adult (18+) voice/video chat & creator community.

How to test:
1. Open the app. Tap "Continue with email" and sign up using the test account below. The 18+ confirmation gate must be passed.
2. After onboarding (defaults: India, your state), the Discover tab opens with a "5 free minutes" banner. Tap "Use now" to be auto-matched to a female test creator.
3. To test in-app purchases, go to Wallet → Recharge. Use the ₹9 starter pack.
4. To test the SOS / safety flow, tap the red SOS pulse button during any call.
5. To test account deletion, Settings → Account → Delete account, OR visit https://talkoraapp.com/delete-account in any browser.

Test account (email/OTP):
  email: play-review@talkora.app
  password: <set this before submission>

Female creator test account (for receiving calls):
  email: play-creator@talkora.app
  password: <set this before submission>

KYC documents are auto-deleted; please do not use real Aadhaar/PAN data during review.
```

---

You're now ready to upload `app-release.aab` (from `ANDROID_BUILD.md` step 6) and ship Talkora to the Play Store.
