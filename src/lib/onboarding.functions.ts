import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { differenceInYears, parseISO } from "date-fns";
import { GUIDELINES_VERSION, MIN_AGE } from "./constants";
import { AI_AVATAR_STYLES, withAiAvatar, withAiAvatars } from "./ai-avatar";

const AI_STYLE_IDS = AI_AVATAR_STYLES.map((s) => s.id) as [string, ...string[]];


const OnboardingInput = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers, underscore only"),
  gender: z.enum(["male", "female", "other"]),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  country: z.string().min(2).max(60),
  state: z.string().min(2).max(80).optional().nullable(),
  language: z.string().min(2).max(40),
  acceptGuidelines: z.literal(true),
  asCreator: z.boolean().optional(),
});

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => OnboardingInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const age = differenceInYears(new Date(), parseISO(data.dob));
    if (age < MIN_AGE) throw new Error("You must be 18+ to use Talkora");

    // username uniqueness
    const { data: existing } = await supabase
      .from("profiles").select("id").eq("username", data.username).maybeSingle();
    if (existing && existing.id !== userId) throw new Error("Username taken");

    const { error } = await supabase
      .from("profiles")
      .update({
        username: data.username,
        gender: data.gender,
        dob: data.dob,
        country: data.country,
        state: data.state ?? null,
        language: data.language,
        is_creator: !!data.asCreator,
        onboarded: true,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);

    await supabase
      .from("community_guidelines_acceptance")
      .upsert({ user_id: userId, version: GUIDELINES_VERSION, accepted_at: new Date().toISOString() });

    return { ok: true };
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [
      { data: profile },
      { data: roles },
      { data: wallet },
      { count: followerCount },
      { count: followingCount },
      { data: convs },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("wallets").select("coin_balance").eq("user_id", userId).maybeSingle(),
      supabase.from("follows").select("id", { count: "exact", head: true }).eq("following_id", userId).eq("status", "accepted"),
      supabase.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", userId).eq("status", "accepted"),
      supabase.from("conversations").select("id").or(`user_a.eq.${userId},user_b.eq.${userId}`),
    ]);

    // unread = messages from others in last 24h within my conversations
    let unread = 0;
    const convIds = (convs ?? []).map((c) => c.id);
    if (convIds.length) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .in("conversation_id", convIds)
        .neq("sender_id", userId)
        .gte("created_at", since);
      unread = count ?? 0;
    }

    return {
      profile: withAiAvatar(profile as any),
      roles: (roles ?? []).map((r) => r.role),
      isAdmin: (roles ?? []).some((r) => r.role === "admin"),
      walletBalance: Number(wallet?.coin_balance ?? 0),
      followerCount: followerCount ?? 0,
      followingCount: followingCount ?? 0,
      unreadCount: unread,
    };
  });

export const updateMyLanguage = createServerFn({ method: "POST" })

  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ language: z.string().min(2).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ language: data.language })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Creators can list additional spoken languages so they're matched
// to users who prefer those languages.
export const updateMySpokenLanguages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({
      languages: z.array(z.string().min(2).max(40)).max(10),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Dedupe + normalize
    const langs = Array.from(new Set(data.languages.map((l) => l.trim()).filter(Boolean)));
    const { error } = await context.supabase
      .from("profiles")
      .update({ languages: langs })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, languages: langs };
  });

// Save uploaded avatar — generates a long-lived signed URL and persists it.
// Old object is deleted to avoid orphan files.
export const setMyAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ objectPath: z.string().min(3).max(300) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // path must start with the user's own folder
    if (!data.objectPath.startsWith(`${userId}/`)) {
      throw new Error("Invalid path");
    }
    const { data: signed, error: signErr } = await supabase.storage
      .from("avatars")
      .createSignedUrl(data.objectPath, 60 * 60 * 24 * 365);
    if (signErr || !signed) throw new Error(signErr?.message ?? "Could not create URL");

    // delete previous file (best effort)
    const { data: old } = await supabase
      .from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
    if (old?.avatar_path && old.avatar_path !== data.objectPath) {
      await supabase.storage.from("avatars").remove([old.avatar_path]);
    }

    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: signed.signedUrl, avatar_path: data.objectPath })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true, url: signed.signedUrl };
  });

export const clearMyAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: old } = await supabase
      .from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
    if (old?.avatar_path) {
      await supabase.storage.from("avatars").remove([old.avatar_path]);
    }
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: null, avatar_path: null })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setMyAiAvatarStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ style: z.enum(AI_STYLE_IDS) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ ai_avatar_style: data.style })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, style: data.style };
  });

export const discoverUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("profiles")
      .select("id, username, gender, country, language, avatar_url, ai_avatar_style, is_creator")
      .eq("is_banned", false)
      .eq("onboarded", true)
      .neq("id", userId)
      .limit(60);
    return withAiAvatars(data ?? []);
  });

