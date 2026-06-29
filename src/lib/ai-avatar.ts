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

// Photoreal-style portrait service (avatar.iran.liara.run) gives much more
// attractive, modern, gender-aware portraits than DiceBear's illustrated
// styles. Pool: 100 girls + 100 boys, deterministic by user id.
function premiumCreatorPortrait(seed: string, gender?: string | null): string {
  const h = seedHash(seed || "talkora");
  if (gender === "male") {
    const n = (h % 100) + 1;
    return `https://avatar.iran.liara.run/public/boy?id=${n}`;
  }
  // Default to "girl" pool for female + unspecified creators since the
  // platform skews female-creator. Still deterministic per user id.
  const n = (h % 100) + 1;
  return `https://avatar.iran.liara.run/public/girl?id=${n}`;
}

export function aiAvatarUrl(
  seed: string,
  style?: string | null,
  gender?: string | null,
  isCreator?: boolean | null,
): string {
  // Creators get premium photoreal-style portraits unless they've explicitly
  // picked an illustrated DiceBear style from Settings.
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

// Server-side helper: backfill `avatar_url` on a profile-like row when the
// user hasn't uploaded a photo. Safe to use on arrays of profiles too.
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
  return {
    ...row,
    avatar_url: aiAvatarUrl(
      row.id,
      row.ai_avatar_style ?? null,
      row.gender ?? null,
      row.is_creator ?? null,
    ),
  };
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
