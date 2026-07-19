import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Shared helper: build the export payload using an authenticated Supabase
 * client (RLS applies as the current user).
 */
export async function collectUserExportPayload(
  supabase: any,
  userId: string,
): Promise<any> {
  const run = async (q: any) => {
    try {
      const { data, error } = await q;
      if (error) return [];
      return data ?? [];
    } catch {
      return [];
    }
  };

  const profileRes = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  const walletRes = await supabase.from("wallets").select("*").eq("user_id", userId).maybeSingle();

  const [
    transactions,
    callsOutgoing,
    callsIncoming,
    messagesSent,
    following,
    followers,
    reportsFiled,
    giftsSent,
    giftsReceived,
    kycRequests,
    withdrawals,
    blockedUsers,
  ] = await Promise.all([
    run(supabase.from("transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false })),
    run(supabase.from("call_logs").select("*").eq("caller_id", userId)),
    run(supabase.from("call_logs").select("*").eq("callee_id", userId)),
    run(supabase.from("messages").select("id, conversation_id, content, created_at").eq("sender_id", userId).order("created_at", { ascending: false }).limit(5000)),
    run(supabase.from("follows").select("following_id, created_at").eq("follower_id", userId)),
    run(supabase.from("follows").select("follower_id, created_at").eq("following_id", userId)),
    run(supabase.from("reports").select("id, reported_user_id, reason, details, status, created_at").eq("reporter_id", userId)),
    run(supabase.from("gift_sends").select("*").eq("sender_id", userId)),
    run(supabase.from("gift_sends").select("*").eq("receiver_id", userId)),
    run(supabase.from("kyc_requests").select("id, status, created_at, reviewed_at, docs_retention_until, docs_deleted_at").eq("user_id", userId)),
    run(supabase.from("withdrawals").select("*").eq("user_id", userId)),
    run(supabase.from("blocks").select("blocked_id, created_at").eq("blocker_id", userId)),
  ]);

  return {
    meta: {
      app: "Talkora",
      exportedAt: new Date().toISOString(),
      userId,
      notice:
        "This export contains personal data associated with your Talkora account. Other users' private data is not included. KYC documents are not embedded here; they live in encrypted storage subject to our retention policy.",
    },
    profile: profileRes.data ?? null,
    wallet: walletRes.data ?? null,
    transactions,
    calls: { outgoing: callsOutgoing, incoming: callsIncoming },
    messagesSent,
    follows: { following, followers },
    reportsFiled,
    gifts: { sent: giftsSent, received: giftsReceived },
    kycRequests,
    withdrawals,
    blockedUsers,
  };
}

/**
 * Export all data the signed-in user has in Talkora.
 * Required by Google Play User Data policy: users must be able to
 * request and download their personal data from within the app.
 */
export const exportMyData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<any> => {
    return collectUserExportPayload(context.supabase, context.userId);
  });
