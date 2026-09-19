/**
 * Single source of truth for which payment rail the app may use.
 *
 * Google Play policy: digital goods (coins) bought inside the Android app MUST
 * use Google Play Billing. Alternative gateways (Razorpay etc.) and "buy in the
 * browser" hand-offs are not allowed from the Play build, so both are disabled
 * here rather than being reachable behind a runtime flag.
 */

export type PaymentProvider = "google_play" | "none";

/** Android (Play) build: Google Play Billing only. */
export const ANDROID_PAYMENT_PROVIDER: PaymentProvider = "google_play";

/**
 * Web build: no payment rail is enabled right now. Razorpay stays in the repo
 * but is fully disabled (see RAZORPAY_ENABLED) until it is approved AND the
 * web store is launched separately from the Play build.
 */
export const WEB_PAYMENT_PROVIDER: PaymentProvider = "none";

/** Hard kill-switch. Every Razorpay entry point checks this. */
export const RAZORPAY_ENABLED = false;

/**
 * Flip to `true` only after:
 *  1. Play Console has the in-app products created & active, and
 *  2. the GOOGLE_PLAY_SERVICE_ACCOUNT_JSON secret is configured so the server
 *     can verify every purchase token with the Play Developer API.
 * While false, the app shows "coming soon" and never credits coins.
 */
export const PLAY_BILLING_READY = false;

export const SUPPORT_EMAIL = "support@talkoraapp.com";
export const CHILD_SAFETY_EMAIL = "childsafety@talkoraapp.com";
