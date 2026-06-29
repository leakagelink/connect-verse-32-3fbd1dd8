import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withAiAvatar, withAiAvatars } from "./ai-avatar";


const ONLINE_WINDOW_SECONDS = 60;

// =============================================================
// TRENDING NOW — top gifted creator (24h), hot room, new joiners (1h)
// =============================================================
export const getTrendingNow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
    const since1h = new Date(Date.now() - 3600_000).toISOString();

    const [{ data: gifts }, { data: rooms }, { count: newJoiners }] = await Promise.all([
      supabase
        .from("gift_sends")
        .select("receiver_id, coins_spent")
        .gte("created_at", since24h)
        .limit(500),

      supabase
        .from("matchmaker_rooms")
        .select("id, title, listener_count, host_id, started_at")
        .eq("status", "live")
        .order("listener_count", { ascending: false })
        .limit(1),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since1h)
        .eq("onboarded", true)
        .eq("is_banned", false),
    ]);

    // Aggregate top gifted creator
    const tally = new Map<string, number>();
    for (const g of gifts ?? []) {
      tally.set(g.receiver_id, (tally.get(g.receiver_id) ?? 0) + Number(g.coins_spent ?? 0));
    }
    let topGiftedId: string | null = null;
    let topGiftedCoins = 0;
    for (const [id, c] of tally) {
      if (c > topGiftedCoins) { topGiftedId = id; topGiftedCoins = c; }
    }

    let topGifted: any = null;
    const hot = rooms?.[0] ?? null;
    let hotHost: any = null;
    const profileIds = [topGiftedId, hot?.host_id].filter(Boolean) as string[];
    if (profileIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, ai_avatar_style, country, language, is_creator, gender, is_banned, onboarded, deleted_at")
        .in("id", profileIds)
        .eq("is_banned", false)
        .eq("onboarded", true)
        .is("deleted_at", null);
      const mapped = withAiAvatars(profs ?? []);
      const map = new Map(mapped.map((p) => [p.id, p]));
      if (topGiftedId) topGifted = { ...map.get(topGiftedId), coins_received: topGiftedCoins };
      if (hot) hotHost = map.get(hot.host_id);
    }

    return {
      topGifted,
      hotRoom: hot ? { ...hot, host: hotHost } : null,
      newJoinersLastHour: newJoiners ?? 0,
    };
  });


// =============================================================
// FEATURED FAN CLUBS — most members, open clubs
// =============================================================
export const listFeaturedFanClubs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: clubs } = await supabase
      .from("fan_clubs")
      .select("creator_id, name, tagline, perks, monthly_coins, is_open, created_at")
      .eq("is_open", true)
      .order("created_at", { ascending: false })
      .limit(20);
    const ids = (clubs ?? []).map((c) => c.creator_id);
    if (!ids.length) return [];
    const now = new Date().toISOString();
    const [{ data: members }, { data: profs }] = await Promise.all([
      supabase
        .from("fan_club_members")
        .select("creator_id, fan_id, expires_at")
        .in("creator_id", ids)
        .gt("expires_at", now),
      supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, ai_avatar_style, country, language, gender, is_banned, onboarded, deleted_at")
        .in("id", ids)
        .eq("is_banned", false)
        .eq("onboarded", true)
        .is("deleted_at", null),
    ]);
    const counts = new Map<string, number>();
    for (const m of members ?? []) {
      counts.set(m.creator_id, (counts.get(m.creator_id) ?? 0) + 1);
    }
    const profMap = new Map(withAiAvatars(profs ?? []).map((p) => [p.id, p]));
    return (clubs ?? [])
      .map((c) => ({
        ...c,
        creator: profMap.get(c.creator_id),
        member_count: counts.get(c.creator_id) ?? 0,
      }))
      .sort((a, b) => b.member_count - a.member_count)
      .slice(0, 8);
  });



// =============================================================
// RECENTLY PLAYED WITH — distinct partners from recent calls
// =============================================================
export const listRecentPartners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabase
      .from("call_logs")
      .select("caller_id, callee_id, started_at, kind")
      .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
      .order("started_at", { ascending: false })
      .limit(40);
    const seen = new Set<string>();
    const partners: { id: string; last_at: string; kind: string }[] = [];
    for (const r of data ?? []) {
      const pid = r.caller_id === userId ? r.callee_id : r.caller_id;
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      partners.push({ id: pid, last_at: r.started_at, kind: r.kind });
      if (partners.length >= 10) break;
    }
    if (!partners.length) return [];
    const ids = partners.map((p) => p.id);
    const cutoff = new Date(Date.now() - ONLINE_WINDOW_SECONDS * 1000).toISOString();
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url, ai_avatar_style, country, language, gender, is_creator, last_seen_at, availability")
      .in("id", ids)
      .eq("is_banned", false)
      .eq("onboarded", true)
      .is("deleted_at", null);
    const map = new Map(withAiAvatars(profs ?? []).map((p) => [p.id, p]));
    return partners
      .map((p) => {
        const prof = map.get(p.id);
        if (!prof) return null;
        return {
          ...prof,
          last_call_at: p.last_at,
          last_kind: p.kind,
          online: !!prof.last_seen_at && prof.last_seen_at >= cutoff,
        };
      })
      .filter(Boolean);
  });


// =============================================================
// FOR YOU — personalized creators by language/state
// =============================================================
export const listForYouCreators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: me } = await supabase
      .from("profiles")
      .select("language, country, state")
      .eq("id", userId)
      .maybeSingle();

    const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: creators } = await supabaseAdmin
      .from("profiles")
      .select("id, username, gender, country, state, language, avatar_url, ai_avatar_style, is_creator, last_seen_at, is_banned, onboarded, deleted_at")
      .eq("is_banned", false)
      .eq("onboarded", true)
      .eq("is_creator", true)
      .is("deleted_at", null)
      .gte("last_seen_at", cutoff)
      .limit(60);

    const onlineCutoff = new Date(Date.now() - ONLINE_WINDOW_SECONDS * 1000).toISOString();
    const scored = withAiAvatars((creators ?? []).filter((c: any) => c.id !== userId)).map((c) => {
      let score = 0;
      if (me?.language && c.language === me.language) score += 5;
      if (me?.state && c.state === me.state) score += 3;
      if (me?.country && c.country === me.country) score += 2;
      if (c.last_seen_at && c.last_seen_at >= onlineCutoff) score += 4;
      return { ...c, _score: score, online: c.last_seen_at && c.last_seen_at >= onlineCutoff };
    });
    scored.sort((a, b) => b._score - a._score);
    return scored.slice(0, 12);
  });


// =============================================================
// NEW JOINERS — recently onboarded users (last 24h)
// =============================================================
export const listNewJoiners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, username, gender, country, state, language, avatar_url, ai_avatar_style, is_creator, last_seen_at, created_at, is_banned, onboarded, deleted_at")
      .eq("is_banned", false)
      .eq("onboarded", true)
      .is("deleted_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(60);
    const onlineCutoff = new Date(Date.now() - ONLINE_WINDOW_SECONDS * 1000).toISOString();
    return withAiAvatars((data ?? []).filter((u: any) => u.id !== userId)).map((u) => ({
      ...u,
      online: !!u.last_seen_at && u.last_seen_at >= onlineCutoff,
    }));

  });

