# Talkora v1 — Sirf Chat, Sab Kuch Free

Aap chahte hain: app puri tarah free, voice/video calling "Coming Soon", rewards/coins earning "Coming Soon", v1 me sirf chat.

## Kya karenge

**1. Ek master switch**
`src/lib/constants.ts` me naye flags:
- `V1_FREE_MODE = true` — coins ki charging band, sab chat free
- `CALLING_ENABLED = false` — audio/video calling Coming Soon
- `REWARDS_ENABLED = false` — earning/withdraw/leaderboard/refer Coming Soon

Baad me calling ya coins wapas chalu karna ho to sirf flag `true` karna hoga — code dobara likhna nahi padega.

**2. Chat free**
- Message bhejne par koi coin nahi katega (male/female dono free)
- Chat screen se coin balance warning, "recharge karo" prompts hat jaayenge
- Safety checks (abuse filter, contact-share block, report/block, friendship gate) jaise the waise rahenge

**3. Calling — Coming Soon**
- Chat header, profile cards, Discover/Home ke call buttons: ya to hide, ya "Coming Soon" label ke saath disabled
- `/call/...` page par seedha jaane par ek saaf "Voice & video calling coming soon" screen
- Incoming-call popup band (koi call aa hi nahi sakti)
- Backend call-start function bhi flag off hone par mana kar dega, taaki purana app version bhi call na jod sake

**4. Coins / Rewards — Coming Soon**
- Header ka coin pill hat jaayega
- Wallet, Recharge, Withdraw, Receipts, Leaderboard, Refer pages: single "Coming soon" card
- Gift panel, creator earnings dashboard: Coming Soon state
- Purana data (balance, transactions) delete nahi hoga — sirf chhupa rahega

**5. Store listing text app ke andar**
Jahan-jahan app me likha hai "coins kharido / earning karo / 5 free minutes", woh text hata denge taaki app jo dikhaye wahi kare.

## Play Store policy — jawab

Haan, aisa karna zyada safe hai, kam nahi. Wajah:
- Koi payment nahi = digital-goods billing wali sabse badi risk hi khatam
- Screenshots aur description me sirf chat dikhega, jo app asal me karta hai — "misleading" wala risk khatam
- Aapko yeh karna zaroori rahega: Play listing ki description aur screenshots dobara update karein (coins/calling wale hata dein), warna listing app se match nahi karegi
- 18+ rating, account deletion, privacy policy, report/block, moderation — sab pehle se hai aur bana rahega

Ek dhyan: "Coming Soon" features ke screenshots listing me na dein. App ke andar Coming Soon batana theek hai.

## Technical notes

- Flags `src/lib/constants.ts` me; server functions bhi wahi import karenge (client-safe module).
- `startCall` / `createCallInvite` server functions me guard: flag off → friendly error, DB write nahi.
- Coin debit ka code delete nahi karenge, sirf flag ke peeche `if (!V1_FREE_MODE)` guard.
- Coming Soon ke liye ek chhota shared component `src/components/coming-soon.tsx`.
- Routes delete nahi karenge (deep links/purane push crash na karein) — component swap karenge.
