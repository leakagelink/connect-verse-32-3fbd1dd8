# Talkora — Google Play compliance pass (no rebuild)

Everything below modifies the existing app. Chat, calls, creators, coins, gifts, earnings, withdrawals, KYC, moderation, reports, blocking, notifications and account deletion all stay.

## What I found in the audit (the important parts)

1. **The Android app is a shell that loads the live website.** Coin purchases today open Razorpay inside that shell. For Google Play this is the single biggest risk: digital coins sold outside Play billing.
2. **Razorpay is wired into many screens** (recharge, wallet, in-call top-up, receipts, deep links, webhook, admin payment settings). It is currently behind a "maintenance" flag, so no real payments flow today.
3. Coin spending, call billing and gift sending are already server-side, but some rates live in a frontend constants file and are passed around in places that deserve tightening.
4. Blocking exists but is only enforced on some paths (chat, reports). Calls, gifts and follow requests need the same enforcement in the backend.
5. Creator "verified" state is derived from a single flag; identity approval, payout permission and suspension are not separated.
6. Legal pages exist for privacy, terms, guidelines, refunds and account deletion. **Child safety page is missing** (Play now requires it for social apps).
7. The Android permission list includes items Play will question: battery-optimisation exemption, boot-completed, bluetooth, full-screen intent.

## What I will do

### 1. Coins on Android move to Google Play Billing
- Add a native billing bridge to the Android project using the current Play Billing library, exposing product listing and purchase to the app.
- Coin packs become configurable Play products (`talkora_coins_100`, `_500`, `_1000`, `_5000`, extendable). **Prices are never hardcoded** — the screen shows the price Google returns, in the user's local currency.
- Purchase flow: Play purchase → purchase token sent to our server → server verifies with Google's Play Developer API (package, product, token, purchase state, acknowledgement) → coins credited → purchase acknowledged. Coins are never credited from the app itself.
- New purchase table keyed uniquely on the purchase token, so the same purchase can never credit twice. Refunds and revocations reverse the credit; pending purchases wait.
- Deposit bonus tiers (50/40/30%) are preserved, applied server-side.

### 2. Razorpay removed from the product
Per your answer, Razorpay is switched off everywhere and isolated behind a payment-provider switch fixed to Google Play. The Razorpay code and webhook stay in the repository, unreachable, in case you ever sell coins on the web again. No external checkout, no browser redirect, no deep link can reach it.

### 3. Money and coin safety
- All rates (chat per minute, call per minute, message cost, gift cost) move to trusted server/database configuration; the app only displays them.
- Every deduction, gift, call settlement and earning becomes a single atomic server operation with a ledger entry, so no double charge, negative balance or replay is possible.
- Creator earnings get a proper ledger (source transaction, gross, platform fee, creator amount) with duplicate protection.
- Withdrawals: amounts calculated server-side, one payout per request, no cross-user access, bank details never returned to the app beyond a masked form.

### 4. Creator status, split properly
Separate flags for creator, identity approval (pending / approved / rejected / suspended) and payout permission. "Verified" only shows after real approval. Suspended creators cannot receive paid calls, paid chats or gifts, cannot earn and cannot withdraw.

### 5. Safety, blocking and reporting
- Backend enforcement of blocking on messages, call invites, calls, gifts, follows and notifications — not just hidden buttons.
- Report and block reachable from every profile, chat and call screen, with the existing report categories (harassment, scams, threats, sexual content, exploitation, underage, CSAM, impersonation, spam, other) plus bullying.
- Reports stay immutable and visible to moderators; the reported person cannot erase them.

### 6. Child safety and 18+
- New public **/child-safety** page: our standards, zero tolerance for child sexual abuse material, grooming ban, how to report, how we enforce, cooperation with law enforcement, and a child safety contact address (you confirm the address to use).
- Server-side age check on every signup path including Google sign-in; under-18 accounts cannot reach chat, calls or discovery.
- Terms, Privacy and Community Guidelines acceptance recorded with version and timestamp before a profile becomes usable.

### 7. KYC hardening
Documents stay private, admin-only, never in logs, exports, analytics or the app's local storage; only the minimum fields collected; retention and deletion documented on-page.

### 8. Privacy policy rewritten to match the code
Every data type the app actually collects, why, who receives it (including the AI moderation provider and calling provider), how long it is kept, and how it is deleted. No claims that contradict the implementation.

### 9. Android manifest and permissions cleanup
Keep only what the calling experience needs, with camera and microphone requested at call time, never at signup. Drop battery-optimisation exemption, boot-completed and legacy bluetooth unless a feature truly needs them. Foreground service declared with the correct call type.

### 10. Store listing copy
Neutral positioning: "Talkora — Social Chat & Calls", short description "Chat, connect and call with people and creators on Talkora." No dating, gender-targeted or companionship language anywhere in the app or listing. Existing screenshots reviewed and the coins screenshot regenerated to show Play pricing honestly.

### 11. Reviewer access
A normal 18+ test account with a filled profile and written reviewer instructions, using Play's own licence-tester purchases. No reviewer-only behaviour, no fake test coins, nothing hidden from review.

### 12. Build and verification
Type check, lint and a production build; Android Gradle configuration checked. I will fix everything my changes touch.

## What I will need from you (not blockers to starting)

- A Google Play **service account key** so the server can verify purchases. Until it is saved, verification stays in a strict "cannot credit" state rather than a fake success.
- The four coin products created in Play Console with your chosen prices.
- Your child safety contact email and the legal entity details already used in your existing pages.

## Final report

At the end you get a written report split into: done in code, needs Play Console setup, needs your legal/business confirmation, needs manual testing on a device, and awaiting Google review. I will not claim full compliance because a build passes.
