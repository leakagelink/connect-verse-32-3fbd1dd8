import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiAvatarUrl } from "@/lib/ai-avatar";
import { safeAvatarStyle, safeGender } from "@/lib/avatar-coercion";


const ProfileRowSchema = z
  .object({
    id: z.string().uuid(),
    username: z.string().nullable().optional(),
    avatar_url: z.string().nullable().optional(),
    ai_avatar_style: z.unknown().optional(),
    gender: z.unknown().optional(),
  })
  .passthrough();

type BlockedProfile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  ai_avatar_style: string;
  gender: string | null;
};

/** List users the current user has blocked (for management in Settings). */
export const listBlockedUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("blocks")
      .select("blocked_id, created_at")
      .eq("blocker_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r: any) => r.blocked_id as string);
    const profilesById = new Map<string, BlockedProfile>();
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, username, avatar_url, ai_avatar_style, gender")
        .in("id", ids);
      for (const raw of (profs ?? []) as unknown[]) {
        const parsed = ProfileRowSchema.safeParse(raw);
        if (!parsed.success) continue;
        const p = parsed.data;
        const gender = safeGender(p.gender);
        profilesById.set(p.id, {
          id: p.id,
          username: p.username ?? null,
          avatar_url: p.avatar_url ?? null,
          ai_avatar_style: safeAvatarStyle(p.ai_avatar_style, gender),
          gender,
        });
      }
    }
    return (rows ?? []).map((r: any) => {
      const p = profilesById.get(r.blocked_id);
      const avatar = p?.avatar_url
        ? p.avatar_url
        : aiAvatarUrl(r.blocked_id, p?.ai_avatar_style ?? null, p?.gender ?? null);
      return {
        userId: r.blocked_id as string,
        username: p?.username ?? "—",
        avatarUrl: avatar,
        blockedAt: r.created_at as string,
      };
    });
  });

/**
 * Permanently delete the signed-in user's account.
 * Required by Google Play User Data policy: users must be able to request
 * account & data deletion from within the app.
 * Confirmation phrase ("DELETE") must be typed by the user.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ confirm: z.literal("DELETE") }).parse(d),
  )
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Mark profile as deleted (audit trail; FK cascades will clean owned rows on auth user delete)
    await supabaseAdmin
      .from("profiles")
      .update({
        username: `deleted_${userId.slice(0, 8)}`,
        avatar_url: null,
        bio: null,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", userId);

    // Hard-delete the auth user — cascades to dependent rows via FKs.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
