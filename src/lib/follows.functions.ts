import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withAiAvatar, withAiAvatars } from "./ai-avatar";

const UserIdInput = z.object({ userId: z.string().uuid() });

export const getPartnerProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => UserIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: p, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, gender, country, state, avatar_url, ai_avatar_style, bio, is_creator, is_banned, onboarded, deleted_at, last_seen_at")
      .eq("id", data.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p || p.deleted_at || p.is_banned || !p.onboarded) throw new Error("User not found");

    // counts — show accepted followers + pending requests so the creator
    // sees an immediate "+1" when someone taps Follow (even before they
    // accept the friend request through the gate).
    const [
      { count: followersAccepted },
      { count: followersPending },
      { count: following },
    ] = await Promise.all([
      supabaseAdmin.from("follows").select("id", { count: "exact", head: true })
        .eq("following_id", data.userId).eq("status", "accepted"),
      supabaseAdmin.from("follows").select("id", { count: "exact", head: true })
        .eq("following_id", data.userId).eq("status", "pending"),
      supabaseAdmin.from("follows").select("id", { count: "exact", head: true })
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
    const { onboarded, deleted_at, ...safeProfile } = p as any;

    return {
      profile: withAiAvatar(safeProfile),
      followers: (followersAccepted ?? 0) + (followersPending ?? 0),
      followersAccepted: followersAccepted ?? 0,
      followersPending: followersPending ?? 0,
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
    const nowMs = Date.now();
    const freshExpiry = new Date(nowMs + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("follows")
      .insert({
        follower_id: userId,
        following_id: data.userId,
        status: "pending",
        expires_at: freshExpiry,
      });
    let inserted = !error;
    if (error && /duplicate/i.test(error.message)) {
      // Existing row — if it's a stale pending one, revive it with a fresh expiry
      // and clear the recipient's "seen" flag so it surfaces as unread again.
      const { data: revived } = await supabase
        .from("follows")
        .update({ expires_at: freshExpiry, seen_at: null })
        .eq("follower_id", userId)
        .eq("following_id", data.userId)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      inserted = !!revived;
    } else if (error) {
      throw new Error(error.message);
    }

    // Notify recipient (in-app bell + push). Best-effort — never fail the request.
    if (inserted) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: me } = await supabaseAdmin
          .from("profiles").select("username").eq("id", userId).maybeSingle();
        const name = (me as { username?: string | null } | null)?.username ?? "Someone";
        const { notifyUser } = await import("./push.functions");
        await notifyUser({
          userId: data.userId,
          kind: "follows",
          title: "New friend request",
          body: `${name} wants to connect with you on Talkora.`,
          deepLink: "/requests",
        });
      } catch (err) {
        // Best-effort — log so the issue is visible in server-fn logs
        // instead of disappearing into a swallowed catch.
        console.error("[sendFollowRequest] notifyUser failed", err);
      }
    }
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
    const nowIso = new Date().toISOString();
    const { data: reqs } = await supabase
      .from("follows")
      .select("follower_id, created_at, seen_at, expires_at")
      .eq("following_id", userId)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!reqs?.length) return [];
    const ids = reqs.map((r) => r.follower_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url, ai_avatar_style, gender, country, state, is_banned, onboarded, deleted_at")
      .in("id", ids)
      .eq("is_banned", false)
      .eq("onboarded", true)
      .is("deleted_at", null);
    const map = new Map(withAiAvatars(profiles ?? []).map((p) => [p.id, p]));
    return reqs.map((r) => ({ ...r, profile: map.get(r.follower_id) }));
  });

/** Mark all currently visible pending requests as read by the recipient. */
export const markFollowRequestsSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("follows")
      .update({ seen_at: new Date().toISOString() })
      .eq("following_id", userId)
      .eq("status", "pending")
      .is("seen_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Return follow status for a batch of users (me -> them).
 *  status: 'accepted' | 'pending' | null  */
export const getFollowStatusBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ userIds: z.array(z.string().uuid()).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.userIds.length) return {} as Record<string, "accepted" | "pending" | null>;
    const { data: rows } = await supabase
      .from("follows")
      .select("following_id, status")
      .eq("follower_id", userId)
      .in("following_id", data.userIds);
    const out: Record<string, "accepted" | "pending" | null> = {};
    for (const id of data.userIds) out[id] = null;
    for (const r of rows ?? []) {
      out[r.following_id] = (r.status as "accepted" | "pending") ?? null;
    }
    return out;
  });

