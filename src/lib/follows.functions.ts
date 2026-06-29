import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UserIdInput = z.object({ userId: z.string().uuid() });

export const getPartnerProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => UserIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: p, error } = await supabase
      .from("profiles")
      .select("id, username, gender, country, state, avatar_url, bio, is_creator, is_banned, last_seen_at")
      .eq("id", data.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new Error("User not found");

    // counts (accepted only)
    const [{ count: followers }, { count: following }] = await Promise.all([
      supabase.from("follows").select("id", { count: "exact", head: true })
        .eq("following_id", data.userId).eq("status", "accepted"),
      supabase.from("follows").select("id", { count: "exact", head: true })
        .eq("follower_id", data.userId).eq("status", "accepted"),
    ]);

    // relationship: me -> them, them -> me
    const { data: rels } = await supabase
      .from("follows")
      .select("follower_id, following_id, status")
      .or(
        `and(follower_id.eq.${userId},following_id.eq.${data.userId}),` +
        `and(follower_id.eq.${data.userId},following_id.eq.${userId})`
      );

    const outgoing = rels?.find((r) => r.follower_id === userId && r.following_id === data.userId) ?? null;
    const incoming = rels?.find((r) => r.follower_id === data.userId && r.following_id === userId) ?? null;

    return {
      profile: p,
      followers: followers ?? 0,
      following: following ?? 0,
      outgoing: outgoing ? outgoing.status : null, // 'pending' | 'accepted' | null
      incoming: incoming ? incoming.status : null,
    };
  });

export const sendFollowRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => UserIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.userId === userId) throw new Error("Cannot follow yourself");
    const { error } = await supabase
      .from("follows")
      .insert({ follower_id: userId, following_id: data.userId, status: "pending" });
    if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
    return { ok: true };
  });

export const respondFollowRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    userId: z.string().uuid(), // the requester
    action: z.enum(["accept", "reject"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.action === "accept") {
      const { error } = await supabase
        .from("follows")
        .update({ status: "accepted" })
        .eq("follower_id", data.userId)
        .eq("following_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", data.userId)
        .eq("following_id", userId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const unfollowUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => UserIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower_id", userId)
      .eq("following_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listFollowRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: reqs } = await supabase
      .from("follows")
      .select("follower_id, created_at")
      .eq("following_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(100);
    if (!reqs?.length) return [];
    const ids = reqs.map((r) => r.follower_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, gender, country, state")
      .in("id", ids);
    const map = new Map((profiles ?? []).map((p) => [p.id, p]));
    return reqs.map((r) => ({ ...r, profile: map.get(r.follower_id) }));
  });
