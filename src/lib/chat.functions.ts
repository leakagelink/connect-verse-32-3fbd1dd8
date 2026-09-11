import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CHAT_COINS_PER_MINUTE, MESSAGE_COIN_COST_MALE, V1_FREE_MODE, containsBlockedContent, detectContactShare, contactShareWarning } from "./constants";
import { withAiAvatars } from "./ai-avatar";

async function assertNotBanned(supabase: any, userId: string) {
  const { data } = await supabase.from("profiles").select("is_banned, onboarded").eq("id", userId).maybeSingle();
  if (data?.is_banned) throw new Error("Account suspended");
  if (!data?.onboarded) throw new Error("Complete onboarding first");
}

/** Messaging is only allowed once a friend request has been accepted between the two users (either direction). */
async function assertFriends(supabase: any, userId: string, otherUserId: string) {
  const { data: rels } = await supabase
    .from("follows")
    .select("follower_id, following_id, status")
    .or(
      `and(follower_id.eq.${userId},following_id.eq.${otherUserId}),` +
      `and(follower_id.eq.${otherUserId},following_id.eq.${userId})`
    );
  const accepted = (rels ?? []).some((r: any) => r.status === "accepted");
  if (accepted) return;
  const outgoing = (rels ?? []).find(
    (r: any) => r.follower_id === userId && r.following_id === otherUserId,
  );
  if (outgoing?.status === "pending") {
    throw new Error("REQUEST_PENDING: Waiting for them to accept your friend request before you can message.");
  }
  throw new Error("NOT_FRIENDS: Send a friend request and wait for them to accept before messaging.");
}

export const getOrCreateConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ otherUserId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.otherUserId === userId) throw new Error("Cannot chat with yourself");
    await assertNotBanned(supabase, userId);

    // block check
    const { data: blockRow } = await supabase
      .from("blocks")
      .select("id")
      .or(`and(blocker_id.eq.${userId},blocked_id.eq.${data.otherUserId}),and(blocker_id.eq.${data.otherUserId},blocked_id.eq.${userId})`)
      .maybeSingle();
    if (blockRow) throw new Error("Unable to start chat");

    // Friendship gate: must have an accepted follow in either direction.
    await assertFriends(supabase, userId, data.otherUserId);

    const [a, b] = [userId, data.otherUserId].sort();
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_a", a)
      .eq("user_b", b)
      .maybeSingle();
    if (existing) return { id: existing.id };

    const { data: created, error } = await supabase
      .from("conversations")
      .insert({ user_a: a, user_b: b })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id };
  });

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, user_a, user_b, last_message_at, created_at")
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(50);
    if (!convs?.length) return [];

    const otherIds = convs.map((c) => (c.user_a === userId ? c.user_b : c.user_a));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url, ai_avatar_style, gender, is_creator, is_banned, onboarded, deleted_at")
      .in("id", otherIds)
      .eq("is_banned", false)
      .eq("onboarded", true)
      .is("deleted_at", null);
    const map = new Map(withAiAvatars(profiles ?? []).map((p) => [p.id, p]));
    return convs.map((c) => {
      const other = c.user_a === userId ? c.user_b : c.user_a;
      return { id: c.id, otherUserId: other, lastMessageAt: c.last_message_at, other: map.get(other) };
    });
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    conversationId: z.string().uuid(),
    body: z.string().trim().min(1).max(2000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotBanned(supabase, userId);

    // Friendship gate: resolve the other party from the conversation and verify accepted follow.
    const { data: conv } = await supabase
      .from("conversations")
      .select("user_a, user_b")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");
    const otherUserId = conv.user_a === userId ? conv.user_b : conv.user_a;
    if (!otherUserId || otherUserId === userId) throw new Error("Invalid conversation");
    await assertFriends(supabase, userId, otherUserId);

    const blocked = containsBlockedContent(data.body);
    if (blocked) throw new Error(`Message blocked: contains restricted content`);

    // Off-platform contact / PII share guard. Reject the message and record a
    // moderation event so admins can see repeat offenders (auto-ban kicks in
    // at 3 confirmed strikes via the existing apply_moderation_strike trigger).
    const contactCat = detectContactShare(data.body);
    if (contactCat) {
      try {
        await supabase.from("moderation_events").insert({
          user_id: userId,
          kind: "text",
          category: "contact_share",
          severity: 2,
          ai_label: contactCat,
          ai_model: "regex.contact_share.v1",
          evidence: { snippet: data.body.slice(0, 280), conversation_id: data.conversationId },
          status: "pending_review",
        });
      } catch { /* best-effort logging */ }
      const err: any = new Error(`CONTACT_SHARE_BLOCKED:${contactCat}:${contactShareWarning(contactCat)}`);
      err.code = "CONTACT_SHARE_BLOCKED";
      err.category = contactCat;
      throw err;
    }


    // Male senders pay coins per message; females are free
    const { data: senderProfile } = await supabase
      .from("profiles").select("gender").eq("id", userId).maybeSingle();
    const isMale = senderProfile?.gender === "male";
    let charged = 0;

    if (!V1_FREE_MODE && isMale && MESSAGE_COIN_COST_MALE > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: wallet } = await supabaseAdmin
        .from("wallets").select("coin_balance").eq("user_id", userId).single();
      const balance = Number(wallet?.coin_balance ?? 0);
      if (balance < MESSAGE_COIN_COST_MALE) {
        throw new Error("Not enough coins to send a message. Please recharge.");
      }
      const { error: wErr } = await supabaseAdmin.from("wallets").update({
        coin_balance: balance - MESSAGE_COIN_COST_MALE,
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId);
      if (wErr) throw new Error(wErr.message);
      charged = MESSAGE_COIN_COST_MALE;
    }

    const { data: msg, error } = await supabase
      .from("messages")
      .insert({ conversation_id: data.conversationId, sender_id: userId, body: data.body })
      .select("id, created_at")
      .single();
    if (error) {
      // refund if message insert failed after charge
      if (charged > 0) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: w } = await supabaseAdmin.from("wallets").select("coin_balance").eq("user_id", userId).single();
        await supabaseAdmin.from("wallets").update({
          coin_balance: Number(w?.coin_balance ?? 0) + charged,
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId);
      }
      throw new Error(error.message);
    }

    if (charged > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("transactions").insert({
        user_id: userId,
        type: "chat_spend",
        coins_delta: -charged,
        metadata: { kind: "message", conversation_id: data.conversationId, message_id: msg.id },
      });
    }

    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", data.conversationId);

    // Notify recipient (in-app bell + FCM push). Best-effort.
    try {
      const { data: sender } = await supabase
        .from("profiles").select("username").eq("id", userId).maybeSingle();
      const senderName = sender?.username || "Someone";
      const preview = data.body.length > 80 ? data.body.slice(0, 77) + "…" : data.body;
      const { notifyUser } = await import("./push.functions");
      await notifyUser({
        userId: otherUserId,
        kind: "chat",
        title: `New message from ${senderName}`,
        body: preview,
        deepLink: `/chat/${data.conversationId}`,
      });
    } catch (e) {
      console.error("[sendMessage] notifyUser failed", e);
    }

    return msg;
  });

export const startChatSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ conversationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotBanned(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // close any prior active session for this user+convo
    await supabaseAdmin
      .from("chat_sessions")
      .update({ is_active: false, ended_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("conversation_id", data.conversationId)
      .eq("is_active", true);

    const { data: created, error } = await supabaseAdmin
      .from("chat_sessions")
      .insert({ conversation_id: data.conversationId, user_id: userId })
      .select("id, started_at")
      .single();
    if (error) throw new Error(error.message);

    return { sessionId: created.id, ratePerMinute: CHAT_COINS_PER_MINUTE };
  });

export const tickChatBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    sessionId: z.string().uuid(),
    elapsedSeconds: z.number().int().min(1).max(120),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: session } = await supabaseAdmin
      .from("chat_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!session || !session.is_active) {
      return { ok: false, ended: true, reason: "Session not active" };
    }

    // v1: chat is free — never bill, never end a session for coins.
    if (V1_FREE_MODE) {
      return { ok: true, ended: false, reason: null, balance: 0, freeSeconds: 0 };
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("free_seconds_remaining, is_banned").eq("id", userId).single();
    if (profile?.is_banned) {
      await supabaseAdmin.from("chat_sessions").update({ is_active: false, ended_at: new Date().toISOString() }).eq("id", session.id);
      return { ok: false, ended: true, reason: "banned" };
    }

    const { data: wallet } = await supabaseAdmin
      .from("wallets").select("coin_balance").eq("user_id", userId).single();

    let secondsLeft = data.elapsedSeconds;
    let freeUsed = 0;
    const freeAvail = profile?.free_seconds_remaining ?? 0;
    if (freeAvail > 0) {
      freeUsed = Math.min(freeAvail, secondsLeft);
      secondsLeft -= freeUsed;
    }

    const coinsNeeded = Math.ceil((secondsLeft * CHAT_COINS_PER_MINUTE) / 60);
    const balance = Number(wallet?.coin_balance ?? 0);

    let coinsSpent = 0;
    let ended = false;
    let endReason: string | null = null;

    if (coinsNeeded > balance) {
      // spend whatever we can, then end
      coinsSpent = balance;
      const billableSeconds = Math.floor((balance * 60) / CHAT_COINS_PER_MINUTE);
      secondsLeft = billableSeconds;
      ended = true;
      endReason = "insufficient_coins";
    } else {
      coinsSpent = coinsNeeded;
    }

    const newBalance = balance - coinsSpent;
    const newFree = freeAvail - freeUsed;

    await supabaseAdmin.from("wallets").update({
      coin_balance: newBalance, updated_at: new Date().toISOString(),
    }).eq("user_id", userId);

    if (freeUsed > 0) {
      await supabaseAdmin.from("profiles").update({ free_seconds_remaining: newFree }).eq("id", userId);
    }

    await supabaseAdmin.from("chat_sessions").update({
      seconds_billed: session.seconds_billed + freeUsed + secondsLeft,
      free_seconds_used: session.free_seconds_used + freeUsed,
      coins_spent: Number(session.coins_spent) + coinsSpent,
      last_tick_at: new Date().toISOString(),
      ...(ended ? { is_active: false, ended_at: new Date().toISOString() } : {}),
    }).eq("id", session.id);

    if (coinsSpent > 0) {
      await supabaseAdmin.from("transactions").insert({
        user_id: userId,
        type: "chat_spend",
        coins_delta: -coinsSpent,
        metadata: { session_id: session.id, conversation_id: session.conversation_id },
      });
    }

    return { ok: true, ended, reason: endReason, balance: newBalance, freeSeconds: newFree };
  });

export const endChatSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("chat_sessions")
      .update({ is_active: false, ended_at: new Date().toISOString() })
      .eq("id", data.sessionId)
      .eq("user_id", userId);
    return { ok: true };
  });

export const loadMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ conversationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: msgs } = await context.supabase
      .from("messages")
      .select("id, sender_id, body, is_deleted, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true })
      .limit(200);
    return msgs ?? [];
  });
