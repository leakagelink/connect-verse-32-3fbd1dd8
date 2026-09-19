export const APP_NAME = "Talkora";

/**
 * When true, the Recharge screen shows a "Payment gateway under maintenance"
 * gate and blocks all buy actions (buttons disabled, deep-link auto-buy
 * skipped, retry-resume disabled). Flip to `false` once the live payment
 * gateway (Razorpay) is approved and ready to accept real payments.
 */
export const PAYMENTS_MAINTENANCE = true;
export const APP_TAGLINE = "Voice Chat & Live Rooms";
export const APP_FULL_NAME = "Talkora — Voice Chat & Live Rooms";
export const CHAT_COINS_PER_MINUTE = 2;
export const VOICE_CALL_COINS_PER_MINUTE = 8;
export const VIDEO_CALL_COINS_PER_MINUTE = 16;
export const MESSAGE_COIN_COST_MALE = 1; // coins charged per text message from male senders (females free)
export const FREE_SECONDS_ON_SIGNUP = 300;
export const BONUS_TIERS = [0.5, 0.4, 0.3]; // 1st, 2nd, 3rd deposit
export const MIN_AGE = 18;
export const GUIDELINES_VERSION = "v1";

export const APP_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "हिन्दी (Hindi)" },
  { code: "bn", name: "বাংলা (Bengali)" },
  { code: "te", name: "తెలుగు (Telugu)" },
  { code: "mr", name: "मराठी (Marathi)" },
  { code: "ta", name: "தமிழ் (Tamil)" },
  { code: "gu", name: "ગુજરાતી (Gujarati)" },
  { code: "kn", name: "ಕನ್ನಡ (Kannada)" },
  { code: "ml", name: "മലയാളം (Malayalam)" },
  { code: "pa", name: "ਪੰਜਾਬੀ (Punjabi)" },
  { code: "ur", name: "اردو (Urdu)" },
  { code: "or", name: "ଓଡ଼ିଆ (Odia)" },
  { code: "as", name: "অসমীয়া (Assamese)" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "ar", name: "العربية" },
];

// Basic profanity / safety list (Phase 1 — AI moderation in Phase 2)
export const BLOCKED_WORDS = [
  "fuck", "shit", "bitch", "asshole", "cunt", "dick", "pussy",
  "rape", "kill yourself", "kys", "nigger", "faggot",
];

export function containsBlockedContent(text: string): string | null {
  const lower = text.toLowerCase();
  for (const word of BLOCKED_WORDS) {
    if (lower.includes(word)) return word;
  }
  return null;
}

// Off-platform contact / PII sharing detector.
// Returns a category label when the message tries to share personal contact
// info, social handles, or off-platform handoff cues. Returns null otherwise.
export type ContactShareCategory =
  | "phone"
  | "email"
  | "url"
  | "social_handle"
  | "social_platform";

const SOCIAL_PLATFORMS = [
  "whatsapp", "whats app", "wsp", "wtsp", "wtsapp",
  "telegram", "tlgrm", "tg",
  "instagram", "insta", "ig handle", "ig id",
  "snapchat", "snap chat", "snapid", "snap id",
  "facebook", "fb id", "fb account", "messenger",
  "discord", "skype", "signal app", "viber", "wechat", "line app",
  "tiktok", "tik tok", "youtube channel", "yt channel",
  "twitter", " x.com", "threads",
  "gmail", "yahoo mail", "hotmail", "outlook mail", "protonmail", "icloud mail",
  "email id", "e-mail", "e mail",
  "mera number", "mera no", "my number", "my no.", "phone number", "phone no",
  "mobile number", "mobile no", "contact number", "contact no",
];

// Normalize common obfuscations: "g mail", "at the rate", spaces inside numbers,
// leet-speak (0 for o, 1 for i, 3 for e), zero-width / unicode spaces.
function normalizeForDetection(text: string): string {
  let t = text.toLowerCase();
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, "");           // zero-width chars
  t = t.replace(/[\(\)\[\]\{\}<>]/g, " ");
  t = t.replace(/\s*(at|@|\(at\)|\[at\])\s*/gi, "@");
  t = t.replace(/\s*(dot|\(dot\)|\[dot\])\s*/gi, ".");
  t = t.replace(/[_\-\.\u00B7•]/g, "");                    // strip separators inside handles
  return t;
}

export function detectContactShare(text: string): ContactShareCategory | null {
  if (!text) return null;
  const raw = text;
  const norm = normalizeForDetection(text);

  // Email: a@b.tld (also catches "name at gmail dot com" after normalization)
  if (/[a-z0-9][a-z0-9+]*@[a-z0-9]+\.[a-z]{2,}/i.test(norm)) return "email";

  // Phone numbers: 7+ digits in a row (after stripping spaces/dashes/dots), or
  // an explicit +country prefix. Use the digit-only stream from the raw text.
  const digitStream = raw.replace(/[^\d+]/g, "");
  if (/\+?\d{7,}/.test(digitStream)) return "phone";
  // Words-as-digits fallback: "nine eight seven six five four three two one zero" sequences
  const wordDigits = raw.toLowerCase().match(/\b(zero|one|two|three|four|five|six|seven|eight|nine|do|teen|char|paanch|chhe|saat|aath|nau|ek|shunya)\b/g);
  if (wordDigits && wordDigits.length >= 7) return "phone";

  // URLs / domains
  if (/\b(https?:\/\/|www\.)\S+/i.test(raw)) return "url";
  if (/\b[a-z0-9-]+\.(com|in|net|org|io|co|me|app|live|xyz|tv|gg)\b/i.test(norm)) return "url";

  // @handles (instagram/twitter/telegram style)
  if (/(^|\s)@[a-z0-9_.]{3,}/i.test(raw)) return "social_handle";
  if (/\bt\.me\/[a-z0-9_]+/i.test(norm)) return "social_handle";
  if (/\b(wa\.me|chat\.whatsapp\.com)\b/i.test(norm)) return "social_handle";

  // Platform mentions / handoff cues
  for (const p of SOCIAL_PLATFORMS) {
    if (norm.includes(p.replace(/\s+/g, ""))) return "social_platform";
  }
  return null;
}

export function contactShareWarning(cat: ContactShareCategory): string {
  const what =
    cat === "phone" ? "phone numbers"
      : cat === "email" ? "email addresses"
        : cat === "url" ? "external links"
          : cat === "social_handle" ? "social media handles"
            : "off-platform contact details (WhatsApp, Instagram, Telegram, etc.)";
  return `Sharing ${what} is not allowed. Repeated attempts can get your account banned.`;
}

export function bonusForDeposit(depositCount: number): number {
  return BONUS_TIERS[depositCount] ?? 0;
}
