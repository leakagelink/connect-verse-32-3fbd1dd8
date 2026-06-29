// AI Avatar helper — deterministic, no-API-key fallback avatars for users
// who haven't uploaded a profile photo. Uses DiceBear's open SVG service.
// Deterministic seed (user id) means every viewer sees the same avatar
// for the same user, and the image is cacheable + free.

export const DICEBEAR_BASE = "https://api.dicebear.com/9.x";

// Curated set of AI avatar styles users can pick from in Settings.
export const AI_AVATAR_STYLES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "lorelei", label: "Lorelei" },
  { id: "notionists", label: "Notion" },
  { id: "personas", label: "Personas" },
  { id: "micah", label: "Micah" },
  { id: "adventurer", label: "Adventurer" },
  { id: "avataaars", label: "Cartoon" },
  { id: "fun-emoji", label: "Fun Emoji" },
  { id: "bottts", label: "Robot" },
  { id: "thumbs", label: "Thumbs" },
  { id: "pixel-art", label: "Pixel" },
  { id: "shapes", label: "Shapes" },
  { id: "initials", label: "Initials" },
];

const STYLE_IDS = new Set(AI_AVATAR_STYLES.map((s) => s.id));

const DEFAULT_STYLE_BY_GENDER: Record<string, string> = {
  female: "lorelei",
  male: "avataaars",
  other: "personas",
};

// Polished, portrait-leaning styles reserved for creators so their cards
// look premium in discovery, recents, and call screens.
const CREATOR_STYLE_BY_GENDER: Record<string, string> = {
  female: "lorelei",
  male: "notionists",
  other: "personas",
};

// Hand-picked gradient pairs (DiceBear takes two hex colors w/o `#`).
const CREATOR_GRADIENTS: ReadonlyArray<[string, string]> = [
  ["ffd1dc", "c084fc"], // blush → violet
  ["fde68a", "fb7185"], // butter → coral
  ["a5f3fc", "818cf8"], // sky → indigo
  ["fbcfe8", "8b5cf6"], // pink → purple
  ["fcd34d", "f97316"], // amber → orange
  ["bbf7d0", "06b6d4"], // mint → cyan
  ["fecaca", "ec4899"], // rose → magenta
  ["ddd6fe", "6366f1"], // lavender → indigo
];

function gradientFor(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return CREATOR_GRADIENTS[hash % CREATOR_GRADIENTS.length];
}

export function pickDefaultStyle(
  gender?: string | null,
  isCreator?: boolean | null,
): string {
  if (isCreator) {
    if (gender && CREATOR_STYLE_BY_GENDER[gender]) return CREATOR_STYLE_BY_GENDER[gender];
    return "lorelei";
  }
  if (gender && DEFAULT_STYLE_BY_GENDER[gender]) return DEFAULT_STYLE_BY_GENDER[gender];
  return "avataaars";
}

function seedHash(seed: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

// Photoreal portraits via randomuser.me CDN — reliable, deterministic,
// gender-aware. Pool: 100 women + 100 men per gender.
function premiumCreatorPortrait(seed: string, gender?: string | null): string {
  const h = seedHash(seed || "talkora");
  const n = h % 100;
  const bucket = gender === "male" ? "men" : "women";
  return `https://randomuser.me/api/portraits/${bucket}/${n}.jpg`;
}

// Memoize URL computation per (seed|style|gender|isCreator). Avatar URLs
// are pure functions of these inputs, so the cache is safe across renders
// and stops <img src> from churning when parents re-render.
const URL_CACHE = new Map<string, string>();

function computeAvatarUrl(
  seed: string,
  style: string | null,
  gender: string | null,
  isCreator: boolean,
): string {
  if (isCreator && (!style || !STYLE_IDS.has(style))) {
    return premiumCreatorPortrait(seed, gender);
  }
  const safeStyle = style && STYLE_IDS.has(style) ? style : pickDefaultStyle(gender, isCreator);
  const safeSeed = encodeURIComponent(seed || "talkora");
  const params = new URLSearchParams({ seed: safeSeed, radius: "50" });
  if (isCreator) {
    const [a, b] = gradientFor(seed);
    params.set("backgroundType", "gradientLinear");
    params.set("backgroundColor", `${a},${b}`);
    params.set("backgroundRotation", "0,360");
    params.set("scale", "110");
  } else {
    params.set("backgroundType", "gradientLinear");
  }
  return `${DICEBEAR_BASE}/${safeStyle}/svg?${params.toString()}`;
}

export function aiAvatarUrl(
  seed: string,
  style?: string | null,
  gender?: string | null,
  isCreator?: boolean | null,
): string {
  const key = `${seed || ""}|${style || ""}|${gender || ""}|${isCreator ? 1 : 0}`;
  let cached = URL_CACHE.get(key);
  if (cached) return cached;
  cached = computeAvatarUrl(seed, style ?? null, gender ?? null, !!isCreator);
  // Soft cap to keep memory bounded; LRU not needed at this scale.
  if (URL_CACHE.size > 5000) URL_CACHE.clear();
  URL_CACHE.set(key, cached);
  return cached;
}

// Server-side helper: backfill `avatar_url` on a profile-like row when the
// user hasn't uploaded a photo. Safe to use on arrays of profiles too.
// Keep stable object references so React doesn't see a new prop each render.
const ROW_CACHE = new WeakMap<object, unknown>();

export function withAiAvatar<T extends {
  id?: string | null;
  avatar_url?: string | null;
  ai_avatar_style?: string | null;
  gender?: string | null;
  is_creator?: boolean | null;
} | null | undefined>(row: T): T {
  if (!row) return row;
  if (row.avatar_url) return row;
  if (!row.id) return row;
  const cached = ROW_CACHE.get(row as object);
  if (cached) return cached as T;
  const out = {
    ...row,
    avatar_url: aiAvatarUrl(
      row.id,
      row.ai_avatar_style ?? null,
      row.gender ?? null,
      row.is_creator ?? null,
    ),
  };
  ROW_CACHE.set(row as object, out);
  return out as T;
}

export function withAiAvatars<T extends {
  id?: string | null;
  avatar_url?: string | null;
  ai_avatar_style?: string | null;
  gender?: string | null;
  is_creator?: boolean | null;
}>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).map((r) => withAiAvatar(r) as T);
}
