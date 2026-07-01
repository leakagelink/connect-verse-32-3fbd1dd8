import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listGifts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("gifts")
      .select("id, code, name, emoji, coin_cost, sort_order")
      .eq("is_active", true)
      .order("sort_order");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const SendInput = z.object({
  giftId: z.string().uuid(),
  receiverId: z.string().uuid(),
  callLogId: z.string().uuid().nullable().optional(),
});

export const sendGift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => SendInput.parse(d))
  .handler(async ({ data, context }) => {
    const t0 = Date.now();
    const { supabase, userId } = context;
    const log = (stage: string, extra: Record<string, unknown> = {}) => {
      // Structured server-side trace for end-to-end gift testing.
      console.log(`[gift-send] ${stage}`, {
        t: Date.now() - t0,
        userId,
        receiverId: data.receiverId,
        giftId: data.giftId,
        callLogId: data.callLogId ?? null,
        ...extra,
      });
    };
    log("start");
    if (data.receiverId === userId) {
      log("error.self");
      throw new Error("Cannot send a gift to yourself");
    }

    const { data: gift, error: giftErr } = await supabase
      .from("gifts")
      .select("id, name, emoji, coin_cost, is_active")
      .eq("id", data.giftId)
      .maybeSingle();
    if (giftErr) { log("error.gift_lookup", { msg: giftErr.message }); throw new Error(giftErr.message); }
    if (!gift || !gift.is_active) { log("error.gift_unavailable"); throw new Error("Gift unavailable"); }

    const cost = Number(gift.coin_cost);
    log("gift_loaded", { name: gift.name, cost });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Sender wallet
    const { data: senderWallet, error: swErr } = await supabaseAdmin
      .from("wallets")
      .select("coin_balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (swErr) { log("error.sender_wallet", { msg: swErr.message }); throw new Error(swErr.message); }
    if (!senderWallet) { log("error.wallet_missing"); throw new Error("Wallet missing"); }
    const senderBal = Number(senderWallet.coin_balance);
    log("sender_balance", { senderBal });
    if (senderBal < cost) {
      log("error.insufficient", { senderBal, cost });
      throw new Error(`Need ${cost} coins. You have ${senderBal}.`);
    }

    // Receiver wallet (auto-row if missing)
    const { data: recvWallet } = await supabaseAdmin
      .from("wallets")
      .select("coin_balance")
      .eq("user_id", data.receiverId)
      .maybeSingle();
    const recvBal = Number(recvWallet?.coin_balance ?? 0);
    log("receiver_balance", { recvBal, exists: !!recvWallet });

    // Debit sender
    const newSenderBal = senderBal - cost;
    const { error: debitErr } = await supabaseAdmin
      .from("wallets")
      .update({ coin_balance: newSenderBal, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (debitErr) { log("error.debit", { msg: debitErr.message }); throw new Error(debitErr.message); }
    log("debited", { newSenderBal });

    // Credit receiver
    const newRecvBal = recvBal + cost;
    if (recvWallet) {
      await supabaseAdmin
        .from("wallets")
        .update({ coin_balance: newRecvBal, updated_at: new Date().toISOString() })
        .eq("user_id", data.receiverId);
    } else {
      await supabaseAdmin
        .from("wallets")
        .insert({ user_id: data.receiverId, coin_balance: cost });
    }
    log("credited", { newRecvBal });

    // Insert log row
    const { data: sendRow, error: sendErr } = await supabaseAdmin
      .from("gift_sends")
      .insert({
        sender_id: userId,
        receiver_id: data.receiverId,
        gift_id: gift.id,
        call_log_id: data.callLogId ?? null,
        coins_spent: cost,
      })
      .select("id")
      .single();
    if (sendErr) { log("error.send_log", { msg: sendErr.message }); throw new Error(sendErr.message); }

    // Transactions for both sides
    await supabaseAdmin.from("transactions").insert([
      {
        user_id: userId,
        type: "gift_spend",
        coins_delta: -cost,
        inr_amount: 0,
        metadata: { gift_id: gift.id, gift_code: gift.name, receiver_id: data.receiverId, send_id: sendRow.id },
      },
      {
        user_id: data.receiverId,
        type: "gift_received",
        coins_delta: cost,
        inr_amount: 0,
        metadata: { gift_id: gift.id, gift_code: gift.name, sender_id: userId, send_id: sendRow.id },
      },
    ]);

    const elapsedMs = Date.now() - t0;
    log("done", { elapsedMs, newSenderBal });

    // Notify receiver (in-app bell + FCM push). Best-effort — never fail the send.
    try {
      const { data: sender } = await supabase
        .from("profiles").select("username").eq("id", userId).maybeSingle();
      const senderName = sender?.username || "Someone";
      const { notifyUser } = await import("./push.functions");
      await notifyUser({
        userId: data.receiverId,
        kind: "gifts",
        title: `${gift.emoji ?? "🎁"} Gift from ${senderName}`,
        body: `You received ${gift.name} (${cost} coins)`,
        deepLink: "/wallet",
      });
    } catch (e) {
      console.error("[gift-send] notifyUser failed", e);
    }

    return {
      ok: true,
      sendId: sendRow.id,
      newBalance: newSenderBal,
      preBalance: senderBal,
      receiverPreBalance: recvBal,
      receiverNewBalance: newRecvBal,
      serverProcessedMs: elapsedMs,
      gift: { id: gift.id, name: gift.name, emoji: gift.emoji, coin_cost: cost },
    };
  });

