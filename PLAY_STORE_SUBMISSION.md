# Talkora — Google Play Submission Kit (FREE release)

This release ships Talkora as a **free social communication app**. There are no
in-app purchases, no coins, no gifts, no creator earnings and no withdrawals in
the build you upload. Monetization code paths exist but are switched off centrally
in `src/lib/feature-flags.ts` and are additionally blocked on the server.

> Read order: §1 Listing → §2 Data Safety → §3 Content rating → §4 Monetization → §5 Screenshots → §6 Pre-launch checklist → §7 Reviewer notes.

---

## 1. Store Listing

### App name (max 30)
```
Talkora: Voice & Video Chat
```

### Short description (max 80)
```
Free chat and voice/video calls with new people. 18+ community with safety tools.
```

### Full description
```
Talkora is a free social communication app for adults (18+) to meet new people,
chat, and talk over voice or video calls.

WHAT YOU CAN DO
• Create a profile with your languages, interests and availability
• Send and accept connection requests
• 1-on-1 chat — unlimited and free
• Voice and video calls — free, no coins, no recharge
• Join or host community rooms and talk about shared interests

FREE TO USE
Talkora has no in-app purchases, no coins and no paid features in this release.
Chat and calls cost nothing.

SAFETY FIRST
• 18+ only. Age confirmation at signup.
• One-tap block and report on every profile, chat and call
• Dedicated child-safety reporting with priority human review
• SOS button during calls
• Automated filters for abusive content and contact sharing
• Full account deletion in the app and on the web

Talkora is not a dating app and not a live-streaming app. Nudity, sexual content,
harassment, and any content involving minors are strictly forbidden and enforced.
```

### Policy URLs
| Field | URL |
|---|---|
| Privacy policy | https://talkoraapp.com/privacy |
| Terms | https://talkoraapp.com/terms |
| Community guidelines | https://talkoraapp.com/community-guidelines |
| Child safety standards | https://talkoraapp.com/child-safety |
| Account deletion | https://talkoraapp.com/delete-account |
| Refund policy (no purchases today) | https://talkoraapp.com/refund-policy |
| Support email | support@talkora.app |

---

## 2. Data Safety form

| Data type | Collected | Shared | Optional | Purpose | Notes |
|---|---|---|---|---|---|
| Name (username) | Yes | No | No | App functionality, Account management | Public to other users |
| Email address | Yes | No | No | Account management | Sign-in only |
| User ID | Yes | No | No | App functionality | Internal id |
| Phone number | Optional | No | Yes | Account management | Only if the user adds it |
| Country & State | Yes | No | No | App functionality | Shown to other users |
| Photos (avatar) | Yes | No | Yes | App functionality | Public profile picture |
| In-app messages | Yes | No | No | App functionality | Stored to deliver; moderated for abuse |
| App interactions | Yes | No | No | App functionality, Analytics | Call and session logs |
| Crash logs / diagnostics | Yes | No | Yes | Analytics, Crash reporting | Anonymous |

**Do NOT declare** payment info, bank/UPI details, or identity documents — none are
collected in this release (no purchases, no payouts, no KYC).

### Security practices
- Data is encrypted in transit (HTTPS/TLS) — ✅
- Data is encrypted at rest — ✅
- Users can request data deletion (in-app + web URL) — ✅
- Independent security review — leave unchecked
- Play Families Policy commitment — leave unchecked (app is 18+)

---

## 3. Content rating questionnaire (IARC)

| Question | Answer |
|---|---|
| Violence | No |
| Sexual content / nudity | No (forbidden and moderated) |
| Profanity / crude humor | Mild — user-generated chat may contain language |
| Controlled substances | No |
| Gambling / simulated gambling | No |
| **User-generated content** | **Yes** |
| **Users communicate with each other** | **Yes — text, voice, video** |
| Users share location with others | No (country/state only) |
| Personal info shared with others | Yes — username, country, state |
| Unrestricted internet access | Yes |
| **Digital purchases** | **No** |

Expected outcome: **Mature 17+**. Target audience: 18 and over only. Turn OFF
"appeals to children" and OFF "mixed audience".

---

## 4. Monetization

- No in-app products. Do **not** create managed products or subscriptions for this release.
- No third-party payment gateway is reachable in the Android build.
- If paid features are added later, they must use **Google Play Billing** in the
  Android app, with server-side purchase verification, and the Data Safety form,
  content rating, and refund policy must be updated **before** rollout.

---

## 5. Screenshots (1080×1920, in `src/assets/screenshots/in/`)

| # | Screen | Caption idea |
|---|---|---|
| 1 | Chat | "Free unlimited chat" |
| 2 | Call | "Free voice & video calls" |
| 3 | Safety | "Block, report, SOS — 18+ only" |
| 4 | Profile / Discovery | "Find people and start talking" |

Screenshots must show only what the app actually does today — no coin packs, no
recharge or wallet screens, no gift animations, no earnings dashboards, and no
admin or moderation dashboards.

---

## 6. Pre-launch checklist

- [ ] Test account credentials filled in Console → App content → App access.
- [ ] Sensitive permission justifications submitted for camera, microphone,
      foreground service (microphone/camera), and post-notifications.
- [ ] Talkora does not request a battery-optimization exemption; the build
      declares only the permissions required for legitimate voice/video calling
      and incoming-call delivery.
- [ ] UGC declaration: in-app reporting, moderation workflow, 18+ gate.
- [ ] Child safety standards URL submitted in Console → App content.
- [ ] Account deletion reachable in-app and at `/delete-account` without login.
- [ ] "Download my data" verified end-to-end.
- [ ] All policy URLs load over HTTPS.
- [ ] No purchase or coin UI visible anywhere in the build.
- [ ] Signing key backed up.
- [ ] Pre-launch report clean; internal testing track verified with 1 tester.

---

## 7. Reviewer notes (Console → App content → App access → Instructions)

```
Talkora is an adult (18+) social communication app. It is FREE — there are no
in-app purchases, coins or paid features in this build.

How to test:
1. Open the app, sign up with the test account below and pass the 18+ confirmation.
2. Complete the short onboarding (country/state default to India).
3. Open "People" to send a connection request; once accepted, chat is enabled.
4. Start a free voice or video call from the chat or profile screen.
5. Safety: use Block / Report on any profile or chat. The report dialog includes
   "Underage user" and "Child safety" reasons, which escalate to priority review.
6. During a call, the red SOS button ends the call and files a safety alert.
7. Account deletion: Settings → Account → Delete account, or
   https://talkoraapp.com/delete-account in any browser (no login needed).

Test accounts:
  email: play-review@talkora.app     password: <set before submission>
  email: play-review2@talkora.app    password: <set before submission>
  (use the second account on another device to accept requests and receive calls)
```
