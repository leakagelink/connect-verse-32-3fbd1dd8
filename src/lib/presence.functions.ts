import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const checkUserOnline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: row } = await supabase
      .from("profiles")
      .select("id, last_seen_at, is_banned, onboarded, availability, is_creator")
      .eq("id", data.userId)
      .maybeSingle();
    const recent = !!row?.last_seen_at && row.last_seen_at >= cutoff;
    const creatorAvailable = !!row?.is_creator && row?.availability === "online";
    const online =
      !!row && !row.is_banned && row.onboarded && (recent || creatorAvailable);
    return { online, last_seen_at: row?.last_seen_at ?? null };
  });

export const ONLINE_WINDOW_SECONDS = 300; // 5 minutes — tolerant of mobile sleep/background
export const CREATOR_STALE_WINDOW_SECONDS = 60 * 60 * 24; // 24h — creators who set availability=online recently

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
    const { supabase, userId } = context;
    const cutoff = new Date(Date.now() - ONLINE_WINDOW_SECONDS * 1000).toISOString();
    const { data } = await supabase
      .from("profiles")
      .select("id, username, gender, country, language, avatar_url, is_creator, last_seen_at")
      .eq("is_banned", false)
      .eq("onboarded", true)
      .neq("id", userId)
      .gte("last_seen_at", cutoff)
      .order("last_seen_at", { ascending: false })
      .limit(60);
    return data ?? [];
  });

export const listOnlineCreators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Creators are surfaced when EITHER they ping recently OR they explicitly
    // set availability=online (with a generous staleness window). This avoids
    // an empty Connect screen when creators have the app marked online but
    // the OS has paused their background heartbeats.
    const staleCutoff = new Date(Date.now() - CREATOR_STALE_WINDOW_SECONDS * 1000).toISOString();
    const [{ data: creators }, { data: me }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, gender, country, state, language, avatar_url, is_creator, last_seen_at, availability, blocked_countries, blocked_states")
        .eq("is_banned", false)
        .eq("onboarded", true)
        .eq("is_creator", true)
        .eq("availability", "online")
        .neq("id", userId)
        .gte("last_seen_at", staleCutoff)
        .order("last_seen_at", { ascending: false })
        .limit(120),
      supabase
        .from("profiles")
        .select("language, country, state")
        .eq("id", userId)
        .maybeSingle(),
    ]);
    // Filter out creators who have blocked my country/state.
    const myCountry = me?.country ?? null;
    const myState = me?.state ?? null;
    const filtered = (creators ?? []).filter((c: any) => {
      const bc: string[] = c.blocked_countries ?? [];
      const bs: string[] = c.blocked_states ?? [];
      if (myCountry && bc.includes(myCountry)) return false;
      if (myState && bs.includes(myState)) return false;
      return true;
    });
    return {
      creators: filtered,
      me: { language: me?.language ?? null, country: myCountry, state: myState },
    };
  });
