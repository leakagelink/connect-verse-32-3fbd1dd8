/**
 * Talkora release flags — SINGLE SOURCE OF TRUTH.
 *
 * This release ships Talkora as a FREE social communication app:
 * chat and voice/video calling work for everyone, and every monetization
 * surface (coins, paid chat, paid calls, gifts, creator earnings, payouts,
 * KYC-for-payout, Razorpay, Google Play Billing) is disabled.
 *
 * Rules:
 *  - These are SERVER-SIDE constants compiled into the build. Nothing the
 *    client sends can flip them, and no admin toggle may bypass payment
 *    verification when monetization is later switched on.
 *  - The monetization architecture (tables, ledger, RPCs, billing modules)
 *    stays in the codebase, unreachable, so Google Play Billing can be
 *    enabled later without rebuilding the product.
 */

/** Master switch for this release. */
export const FREE_MODE = true;

/** Nothing costs money or coins while this is false. */
export const MONETIZATION_ENABLED = false;

// --- Payment rails (both must stay false in the Play release) ---
export const GOOGLE_PLAY_BILLING_ENABLED = false;
export const RAZORPAY_ENABLED = false;

// --- Coin economy ---
export const COINS_ENABLED = MONETIZATION_ENABLED;
export const COIN_PURCHASES_ENABLED = MONETIZATION_ENABLED && GOOGLE_PLAY_BILLING_ENABLED;

// --- Paid product surfaces ---
export const PAID_CHAT_ENABLED = MONETIZATION_ENABLED;
export const PAID_CALLS_ENABLED = MONETIZATION_ENABLED;
/** Calling stays fully available; only the billing layer is bypassed. */
export const CALL_BILLING_ENABLED = PAID_CALLS_ENABLED;
export const GIFTS_ENABLED = MONETIZATION_ENABLED;

// --- Creator money ---
export const CREATOR_EARNINGS_ENABLED = MONETIZATION_ENABLED;
export const WITHDRAWALS_ENABLED = MONETIZATION_ENABLED;
export const KYC_FOR_PAYOUTS_ENABLED = MONETIZATION_ENABLED;

/** Coin-priced extras (mystery cases, fan clubs) ride on the coin economy. */
export const COIN_REWARDS_ENABLED = COINS_ENABLED;
export const PAID_EXTRAS_ENABLED = COINS_ENABLED;

/** Read-only view used by the admin Monetization Settings panel. */
export const MONETIZATION_FLAGS: Array<{ label: string; enabled: boolean }> = [
  { label: "Monetization Enabled", enabled: MONETIZATION_ENABLED },
  { label: "Coin Purchases", enabled: COIN_PURCHASES_ENABLED },
  { label: "Paid Chat", enabled: PAID_CHAT_ENABLED },
  { label: "Paid Calls", enabled: PAID_CALLS_ENABLED },
  { label: "Gifts", enabled: GIFTS_ENABLED },
  { label: "Creator Earnings", enabled: CREATOR_EARNINGS_ENABLED },
  { label: "Withdrawals", enabled: WITHDRAWALS_ENABLED },
  { label: "Payout KYC", enabled: KYC_FOR_PAYOUTS_ENABLED },
  { label: "Google Play Billing", enabled: GOOGLE_PLAY_BILLING_ENABLED },
  { label: "Razorpay", enabled: RAZORPAY_ENABLED },
];

/**
 * Server-side guard. Call at the top of any server function that moves money
 * or coins so a direct API call cannot reach a disabled feature.
 */
export function assertFeatureEnabled(enabled: boolean, message: string): void {
  if (!enabled) throw new Error(message);
}

export const FEATURE_OFF_MESSAGES = {
  coins: "Coins are not available in this version of Talkora.",
  gifts: "Gifts are temporarily unavailable.",
  purchases: "Coin purchases are not available in this version of Talkora.",
  withdrawals: "Payouts are not available in this version of Talkora.",
  kyc: "Payout verification is not available in this version of Talkora.",
  extras: "This feature is coming soon.",
} as const;
