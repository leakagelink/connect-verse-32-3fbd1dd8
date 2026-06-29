import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withAiAvatars, withAiAvatar } from "./ai-avatar";

export const checkUserOnline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: row } = await supabaseAdmin
      .from("profiles")
      .select("id, last_seen_at, is_banned, onboarded, availability, is_creator")
      .eq("id", data.userId)
      .is("deleted_at", null)
      .maybeSingle();
    const recent = !!row?.last_seen_at && row.last_seen_at >= cutoff;
    const creatorAvailable = !!row?.is_creator && row?.availability === "online";
    const online =
      !!row && !row.is_banned && row.onboarded && (recent || creatorAvailable);
    return { online, last_seen_at: row?.last_seen_at ?? null };
  });

export const ONLINE_WINDOW_SECONDS = 300; // 5 minutes — tolerant of mobile sleep/background
export const CREATOR_STALE_WINDOW_SECONDS = 60 * 60 * 24 * 7; // 7d — creators who explicitly set availability=online

const SAFE_PROFILE_FIELDS =
  "id, username, gender, country, state, language, avatar_url, ai_avatar_style, is_creator, last_seen_at, availability";

async function getHiddenAdminIds(supabaseAdmin: any): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");
  return new Set((data ?? []).map((r: any) => r.user_id));
}

export const heartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await supabase
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", userId);
    return { ok: true };
  });

export const listOnlineUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cutoff = new Date(Date.now() - ONLINE_WINDOW_SECONDS * 1000).toISOString();
    const [{ data }, hiddenAdminIds] = await Promise.all([
      supabaseAdmin
      .from("profiles")
        .select(SAFE_PROFILE_FIELDS)
      .eq("is_banned", false)
      .eq("onboarded", true)
        .is("deleted_at", null)
      .gte("last_seen_at", cutoff)
      .order("last_seen_at", { ascending: false })
        .limit(80),
      getHiddenAdminIds(supabaseAdmin),
    ]);
    return withAiAvatars(
      (data ?? []).filter((u: any) => u.id !== userId && !hiddenAdminIds.has(u.id)),
    );
  });

export const listOnlineCreators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Creators are surfaced when EITHER they ping recently OR they explicitly
    // set availability=online (with a generous staleness window). This avoids
    // an empty Connect screen when creators have the app marked online but
    // the OS has paused their background heartbeats.
    const staleCutoff = new Date(Date.now() - CREATOR_STALE_WINDOW_SECONDS * 1000).toISOString();
    const [{ data: creators }, { data: me }, hiddenAdminIds] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select(`${SAFE_PROFILE_FIELDS}, blocked_countries, blocked_states`)
        .eq("is_banned", false)
        .eq("onboarded", true)
        .eq("is_creator", true)
        .eq("availability", "online")
        .is("deleted_at", null)
        .gte("last_seen_at", staleCutoff)
        .order("last_seen_at", { ascending: false })
        .limit(120),
      supabaseAdmin
        .from("profiles")
        .select("language, country, state")
        .eq("id", userId)
        .maybeSingle(),
      getHiddenAdminIds(supabaseAdmin),
    ]);
    // Filter out creators who have blocked my country/state.
    const myCountry = me?.country ?? null;
    const myState = me?.state ?? null;
    const filtered = (creators ?? []).filter((c: any) => {
      if (c.id === userId || hiddenAdminIds.has(c.id)) return false;
      const bc: string[] = c.blocked_countries ?? [];
      const bs: string[] = c.blocked_states ?? [];
      if (myCountry && bc.includes(myCountry)) return false;
      if (myState && bs.includes(myState)) return false;
      return true;
    }).map((c: any) => {
      const { blocked_countries, blocked_states, ...safe } = c;
      return safe;
    });
    return {
      creators: withAiAvatars(filtered),
      me: { language: me?.language ?? null, country: myCountry, state: myState },
    };
  });
