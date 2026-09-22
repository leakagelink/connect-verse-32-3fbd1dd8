import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withAiAvatar, withAiAvatars } from "./ai-avatar";
import {
  RANDOM_MATCHMAKING_ENABLED,
  FEATURE_OFF_MESSAGES,
  assertFeatureEnabled,
} from "./feature-flags";

/**
 * Matchmaking is disabled for this release. Every server function below calls
 * this first so a direct API call cannot reach the disabled feature. The
 * implementation stays in place as future architecture.
 */
function assertMatchmakingEnabled(): void {
  assertFeatureEnabled(RANDOM_MATCHMAKING_ENABLED, FEATURE_OFF_MESSAGES.matchmaking);
}

/** Generate a unique short Agora channel name for a matchmaker room. */
function makeChannel(): string {
  return "mm_" + Math.random().toString(36).slice(2, 12);
}

/** Create a new matchmaker room. Female creators only (enforced by RLS + here). */
export const createMatchmakerRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({
      title: z.string().min(3).max(60),
      topic: z.string().max(120).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertMatchmakingEnabled();
    const { supabase, userId } = context;
    const { data: me } = await supabase
      .from("profiles")
      .select("gender, is_banned, onboarded")
      .eq("id", userId)
      .maybeSingle();
    if (!me || me.is_banned || !me.onboarded) throw new Error("Account not eligible");
    if (me.gender !== "female") throw new Error("Only female creators can host a Matchmaker room");

    const { data: room, error } = await supabase
      .from("matchmaker_rooms")
      .insert({
        host_id: userId,
        title: data.title,
        topic: data.topic ?? null,
        agora_channel: makeChannel(),
        status: "live",
      })
      .select("*")
      .single();
    if (error) throw error;
    return { room };
  });

/** Public list of live rooms with host profile + candidates summary. */
export const listLiveMatchmakerRooms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!RANDOM_MATCHMAKING_ENABLED) return [];
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rooms } = await supabase
      .from("matchmaker_rooms")
      .select("id, title, topic, agora_channel, listener_count, candidate_count, started_at, host_id")
      .eq("status", "live")
      .order("started_at", { ascending: false })
      .limit(30);
    if (!rooms?.length) return [];
    const hostIds = rooms.map((r) => r.host_id);
    const { data: hosts } = await supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url, ai_avatar_style, gender, country, language, is_banned, onboarded, deleted_at")
      .in("id", hostIds)
      .eq("is_banned", false)
      .eq("onboarded", true)
      .is("deleted_at", null);
    const hostMap = new Map(withAiAvatars(hosts ?? []).map((h) => [h.id, h]));
    return rooms.map((r) => ({ ...r, host: hostMap.get(r.host_id) ?? null }));
  });

/** Get room details + candidates + my vote. */
export const getMatchmakerRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ roomId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertMatchmakingEnabled();
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: room } = await supabase
      .from("matchmaker_rooms")
      .select("*")
      .eq("id", data.roomId)
      .maybeSingle();
    if (!room) throw new Error("Room not found");

    const [{ data: candidates }, { data: myVote }, { data: host }] = await Promise.all([
      supabase
        .from("matchmaker_candidates")
        .select("id, user_id, seat, vote_score, gift_score, joined_at")
        .eq("room_id", data.roomId)
        .order("seat"),
      supabase
        .from("matchmaker_votes")
        .select("id, candidate_id")
        .eq("room_id", data.roomId)
        .eq("voter_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, ai_avatar_style, gender, country, language, is_banned, onboarded, deleted_at")
        .eq("id", room.host_id)
        .eq("is_banned", false)
        .eq("onboarded", true)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);

    let candidateProfiles: any[] = [];
    if (candidates?.length) {
      const ids = candidates.map((c) => c.user_id);
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, ai_avatar_style, gender, country, language, is_banned, onboarded, deleted_at")
        .in("id", ids)
        .eq("is_banned", false)
        .eq("onboarded", true)
        .is("deleted_at", null);
      const pmap = new Map(withAiAvatars(profs ?? []).map((p) => [p.id, p]));
      candidateProfiles = candidates.map((c) => ({ ...c, profile: pmap.get(c.user_id) ?? null }));
    }

    return {
      room,
      host: withAiAvatar(host),
      candidates: candidateProfiles,
      myVote: myVote ?? null,
      isHost: room.host_id === userId,
      iAmCandidate: candidateProfiles.find((c: any) => c.user_id === userId) ?? null,
    };
  });

/** Male users join as candidate on a specific seat (1 or 2). */
export const joinAsCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ roomId: z.string().uuid(), seat: z.number().int().min(1).max(2) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertMatchmakingEnabled();
    const { supabase, userId } = context;
    const { data: me } = await supabase
      .from("profiles")
      .select("gender, is_banned")
      .eq("id", userId)
      .maybeSingle();
    if (!me || me.is_banned) throw new Error("Account not eligible");
    if (me.gender !== "female" ? false : true) {
      // female cannot be candidate
      if (me.gender === "female") throw new Error("Only male users can be candidates");
    }
    const { data: room } = await supabase
      .from("matchmaker_rooms")
      .select("status, host_id")
      .eq("id", data.roomId)
      .maybeSingle();
    if (!room || room.status !== "live") throw new Error("Room is not live");
    if (room.host_id === userId) throw new Error("Host cannot be a candidate");

    const { error } = await supabase.from("matchmaker_candidates").insert({
      room_id: data.roomId,
      user_id: userId,
      seat: data.seat,
    });
    if (error) {
      if (error.code === "23505") throw new Error("Seat already taken");
      throw error;
    }
    // (no-op placeholder removed)
    // bump candidate count
    await supabase
      .from("matchmaker_rooms")
      .update({ candidate_count: (await getCount(supabase, "matchmaker_candidates", "room_id", data.roomId)) })
      .eq("id", data.roomId);
    return { ok: true };
  });

async function getCount(supabase: any, table: string, col: string, val: string): Promise<number> {
  const { count } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(col, val);
  return count ?? 0;
}

/** Leave candidate seat. */
export const leaveCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ roomId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertMatchmakingEnabled();
    const { supabase, userId } = context;
    await supabase
      .from("matchmaker_candidates")
      .delete()
      .eq("room_id", data.roomId)
      .eq("user_id", userId);
    await supabase
      .from("matchmaker_rooms")
      .update({ candidate_count: await getCount(supabase, "matchmaker_candidates", "room_id", data.roomId) })
      .eq("id", data.roomId);
    return { ok: true };
  });

/** Cast or change a vote. One per voter per room. */
export const castVote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ roomId: z.string().uuid(), candidateId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertMatchmakingEnabled();
    const { supabase, userId } = context;
    // Candidates and host cannot vote
    const { data: room } = await supabase
      .from("matchmaker_rooms")
      .select("host_id, status")
      .eq("id", data.roomId)
      .maybeSingle();
    if (!room || room.status !== "live") throw new Error("Room not live");
    if (room.host_id === userId) throw new Error("Host cannot vote");

    const { data: amCand } = await supabase
      .from("matchmaker_candidates")
      .select("id")
      .eq("room_id", data.roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (amCand) throw new Error("Candidates cannot vote");

    const { data: existing } = await supabase
      .from("matchmaker_votes")
      .select("id, candidate_id")
      .eq("room_id", data.roomId)
      .eq("voter_id", userId)
      .maybeSingle();

    if (existing) {
      if (existing.candidate_id === data.candidateId) return { ok: true, action: "noop" };
      await supabase
        .from("matchmaker_votes")
        .update({ candidate_id: data.candidateId })
        .eq("id", existing.id);
      return { ok: true, action: "changed" };
    }
    const { error } = await supabase.from("matchmaker_votes").insert({
      room_id: data.roomId,
      voter_id: userId,
      candidate_id: data.candidateId,
    });
    if (error) throw error;
    return { ok: true, action: "cast" };
  });

/** Host ends the room, declares winner = highest (vote_score+gift_score). */
export const endMatchmakerRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ roomId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertMatchmakingEnabled();
    const { supabase, userId } = context;
    const { data: room } = await supabase
      .from("matchmaker_rooms")
      .select("host_id, status")
      .eq("id", data.roomId)
      .maybeSingle();
    if (!room) throw new Error("Room not found");

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (room.host_id !== userId && !isAdmin) throw new Error("Forbidden");
    if (room.status === "ended") return { ok: true, alreadyEnded: true };

    const { data: cands } = await supabase
      .from("matchmaker_candidates")
      .select("id, user_id, vote_score, gift_score")
      .eq("room_id", data.roomId);
    let winnerId: string | null = null;
    if (cands?.length) {
      const sorted = [...cands].sort(
        (a, b) => (b.vote_score + b.gift_score) - (a.vote_score + a.gift_score),
      );
      if (sorted[0] && (sorted[0].vote_score + sorted[0].gift_score) > 0) {
        winnerId = sorted[0].user_id;
      }
    }
    await supabase
      .from("matchmaker_rooms")
      .update({ status: "ended", ended_at: new Date().toISOString(), winner_user_id: winnerId })
      .eq("id", data.roomId);
    return { ok: true, winnerId };
  });

/** Lightweight listener heartbeat — bumps listener_count occasionally. */
export const matchmakerHeartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ roomId: z.string().uuid(), listenerCount: z.number().int().min(0).max(10000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertMatchmakingEnabled();
    await context.supabase
      .from("matchmaker_rooms")
      .update({ listener_count: data.listenerCount })
      .eq("id", data.roomId)
      .eq("status", "live");
    return { ok: true };
  });
