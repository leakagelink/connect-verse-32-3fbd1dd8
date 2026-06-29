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
    const { supabase, userId } = context;
    if (data.receiverId === userId) throw new Error("Cannot send a gift to yourself");

    const { data: gift, error: giftErr } = await supabase
      .from("gifts")
      .select("id, name, emoji, coin_cost, is_active")
      .eq("id", data.giftId)
      .maybeSingle();
    if (giftErr) throw new Error(giftErr.message);
    if (!gift || !gift.is_active) throw new Error("Gift unavailable");

    const cost = Number(gift.coin_cost);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Sender wallet
    const { data: senderWallet, error: swErr } = await supabaseAdmin
      .from("wallets")
      .select("coin_balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (swErr) throw new Error(swErr.message);
    if (!senderWallet) throw new Error("Wallet missing");
    const senderBal = Number(senderWallet.coin_balance);
    if (senderBal < cost) throw new Error(`Need ${cost} coins. You have ${senderBal}.`);

    // Receiver wallet (auto-row if missing)
    const { data: recvWallet } = await supabaseAdmin
      .from("wallets")
      .select("coin_balance")
      .eq("user_id", data.receiverId)
      .maybeSingle();
    const recvBal = Number(recvWallet?.coin_balance ?? 0);

    // Debit sender
    const { error: debitErr } = await supabaseAdmin
      .from("wallets")
      .update({ coin_balance: senderBal - cost, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (debitErr) throw new Error(debitErr.message);

    // Credit receiver
    if (recvWallet) {
      await supabaseAdmin
        .from("wallets")
        .update({ coin_balance: recvBal + cost, updated_at: new Date().toISOString() })
        .eq("user_id", data.receiverId);
    } else {
      await supabaseAdmin
        .from("wallets")
        .insert({ user_id: data.receiverId, coin_balance: cost });
    }

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
    if (sendErr) throw new Error(sendErr.message);

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

    return {
      ok: true,
      sendId: sendRow.id,
      newBalance: senderBal - cost,
      gift: { id: gift.id, name: gift.name, emoji: gift.emoji, coin_cost: cost },
    };
  });
