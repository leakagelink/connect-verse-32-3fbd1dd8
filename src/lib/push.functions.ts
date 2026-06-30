/**
 * Push notifications — server functions.
 *
 * Responsibilities:
 *   - `registerDeviceToken` / `unregisterDeviceToken` — multi-device token CRUD
 *     called from the Capacitor app shell on launch / logout.
 *   - `notifyUser` — internal helper (also exported) that inserts an
 *     `app_notifications` row AND fans the same payload out to all of
 *     the user's FCM tokens, respecting their `notification_prefs`.
 *   - `adminBroadcast` — admin-only system announcement to all (or a
 *     filtered subset of) users. Logged to `push_broadcasts` for audit.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* FCM service-account JSON — managed from admin panel                */
/* ------------------------------------------------------------------ */

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data: isAdmin } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!isAdmin) throw new Error("Forbidden");
}

export const adminGetFcmConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "fcm_service_account_json").maybeSingle();
    const raw = typeof data?.value === "string" ? data.value : "";
    let projectId = "";
    let clientEmail = "";
    let valid = false;
    if (raw) {
      try {
        const j = JSON.parse(raw);
        projectId = j.project_id ?? "";
        clientEmail = j.client_email ?? "";
        valid = !!(projectId && clientEmail && j.private_key);
      } catch { /* invalid json */ }
    }
    const envConfigured = !!process.env.FCM_SERVICE_ACCOUNT_JSON;
    return { configured: valid || envConfigured, source: valid ? "db" : envConfigured ? "env" : "none", projectId, clientEmail };
  });

const FcmSaveSchema = z.object({ serviceAccountJson: z.string().min(20).max(20000) });

export const adminSaveFcmConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: z.infer<typeof FcmSaveSchema>) => FcmSaveSchema.parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    let parsed: any;
    try { parsed = JSON.parse(data.serviceAccountJson); }
    catch { throw new Error("Not valid JSON — paste the entire service account file contents."); }
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error("Missing required fields (project_id / client_email / private_key). Use the Firebase service account JSON.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "fcm_service_account_json", value: data.serviceAccountJson as never, updated_by: context.userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return { ok: true, projectId: parsed.project_id };
  });

export const adminClearFcmConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("app_settings").delete().eq("key", "fcm_service_account_json");
    return { ok: true };
  });

export const adminSendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const res = await notifyUser({
      userId: context.userId,
      kind: "system",
      title: "Test push from Talkora",
      body: "If you see this as a system banner, FCM is wired correctly.",
      deepLink: "/notifications",
    });
    return { pushed: res.pushed };
  });


const TokenSchema = z.object({
  token: z.string().min(10).max(4096),
  platform: z.enum(["android", "ios", "web"]),
});

export const registerDeviceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: z.infer<typeof TokenSchema>) => TokenSchema.parse(d))
  .handler(async ({ context, data }) => {
    const now = new Date().toISOString();
    // upsert by unique token; reassign owner if token rotated between accounts on the device.
    const { error } = await context.supabase
      .from("device_tokens")
      .upsert(
        { user_id: context.userId, token: data.token, platform: data.platform, last_seen_at: now },
        { onConflict: "token" },
      );
    if (error) throw new Error(error.message);
    // also mirror onto profiles for backwards-compat with phase-10 column.
    await context.supabase
      .from("profiles")
      .update({ push_token: data.token, push_platform: data.platform })
      .eq("id", context.userId);
    return { ok: true };
  });

export const unregisterDeviceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { token: string }) => z.object({ token: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    await context.supabase.from("device_tokens").delete().eq("token", data.token).eq("user_id", context.userId);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Internal helper — call this from other server functions.           */
/* ------------------------------------------------------------------ */

type NotifyKind = "chat" | "calls" | "gifts" | "follows" | "system" | "marketing";

const PREF_DEFAULTS: Record<NotifyKind, boolean> = {
  chat: true, calls: true, gifts: true, follows: true, system: true, marketing: false,
};

/**
 * Insert an in-app notification row AND attempt an FCM push to every
 * device the user has registered. Honours the user's `notification_prefs`
 * for the given kind. Uses the admin client so it can be called from
 * any signed-in server function regardless of who is acting.
 */
export async function notifyUser(opts: {
  userId: string;
  kind: NotifyKind;
  title: string;
  body?: string | null;
  deepLink?: string | null;
}): Promise<{ pushed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1) prefs gate
  const { data: prefs } = await supabaseAdmin
    .from("notification_prefs")
    .select("chat, calls, gifts, follows, system, marketing")
    .eq("user_id", opts.userId)
    .maybeSingle();
  const allow = (prefs as Record<NotifyKind, boolean> | null)?.[opts.kind] ?? PREF_DEFAULTS[opts.kind];

  // 2) Create the in-app row (visible in the bell), even if push is muted —
  // EXCEPT for friend-request style "follows" alerts: those have a dedicated
  // user-facing toggle ("Follows & friend requests"), and turning it OFF
  // should silence both the bell AND the push so creators aren't pinged at
  // all. Other kinds keep the bell row so the user can audit history.
  const silenceBellToo = opts.kind === "follows" && !allow;
  if (!silenceBellToo) {
    await supabaseAdmin.from("app_notifications").insert({
      user_id: opts.userId,
      kind: opts.kind,
      title: opts.title,
      body: opts.body ?? null,
      deep_link: opts.deepLink ?? null,
    });
  }

  if (!allow) return { pushed: 0 };


  // 3) FCM fanout
  const { data: tokens } = await supabaseAdmin
    .from("device_tokens")
    .select("token")
    .eq("user_id", opts.userId);
  const tokenList = (tokens ?? []).map((r: { token: string }) => r.token);
  if (tokenList.length === 0) return { pushed: 0 };

  // Map notification kind → Android channel ID. Channels are registered
  // natively in NotificationChannels.java; sending an unknown ID drops the
  // notification onto the default channel and loses heads-up routing.
  // Note: "calls" via notifyUser is always a *missed* call alert —
  // live ring invites go through sendDataOnlyFcm + IncomingCallActivity.
  const channelId: "incoming_calls" | "missed_calls" | "messages" | "general" =
    opts.kind === "calls" ? "missed_calls"
    : opts.kind === "chat" || opts.kind === "gifts" || opts.kind === "follows" ? "messages"
    : "general";

  const { sendFcmToTokens } = await import("./push.server");
  const result = await sendFcmToTokens(tokenList, {
    title: opts.title, body: opts.body ?? null, deepLink: opts.deepLink ?? null,
    data: { kind: opts.kind },
    channelId,
  });
  if (result.invalidTokens.length > 0) {
    await supabaseAdmin.from("device_tokens").delete().in("token", result.invalidTokens);
  }
  return { pushed: result.sent };
}

/* ------------------------------------------------------------------ */
/* Incoming call — high-priority data-only FCM that wakes the device  */
/* and triggers the full-screen IncomingCallActivity on Android even  */
/* when the app is swiped away.                                        */
/* ------------------------------------------------------------------ */

export async function notifyIncomingCall(opts: {
  calleeId: string;
  callerId: string;
  callerName: string;
  callerAvatar?: string | null;
  inviteId: string;
  kind: "voice" | "video";
}): Promise<{ pushed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // honour the callee's "calls" preference
  const { data: prefs } = await supabaseAdmin
    .from("notification_prefs")
    .select("calls")
    .eq("user_id", opts.calleeId)
    .maybeSingle();
  const allow = (prefs as { calls?: boolean } | null)?.calls ?? true;
  if (!allow) return { pushed: 0 };

  const { data: tokens } = await supabaseAdmin
    .from("device_tokens")
    .select("token")
    .eq("user_id", opts.calleeId);
  const tokenList = (tokens ?? []).map((r: { token: string }) => r.token);
  if (tokenList.length === 0) return { pushed: 0 };

  const { sendDataOnlyFcm } = await import("./push.server");
  const res = await sendDataOnlyFcm(tokenList, {
    type: "incoming_call",
    invite_id: opts.inviteId,
    caller_id: opts.callerId,
    caller_name: opts.callerName.slice(0, 64),
    caller_avatar: (opts.callerAvatar ?? "").slice(0, 512),
    call_kind: opts.kind,
  });
  if (res.invalidTokens.length > 0) {
    await supabaseAdmin.from("device_tokens").delete().in("token", res.invalidTokens);
  }
  return { pushed: res.sent };
}

export async function notifyCallEnded(opts: {
  calleeId: string;
  inviteId: string;
}): Promise<{ pushed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: tokens } = await supabaseAdmin
    .from("device_tokens")
    .select("token")
    .eq("user_id", opts.calleeId);
  const tokenList = (tokens ?? []).map((r: { token: string }) => r.token);
  if (tokenList.length === 0) return { pushed: 0 };

  const { sendDataOnlyFcm } = await import("./push.server");
  const res = await sendDataOnlyFcm(tokenList, {
    type: "cancel_call",
    invite_id: opts.inviteId,
  });
  return { pushed: res.sent };
}



/* ------------------------------------------------------------------ */
/* Admin broadcast                                                     */
/* ------------------------------------------------------------------ */

const BroadcastSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(500).optional().nullable(),
  deepLink: z.string().max(200).optional().nullable(),
  audience: z.enum(["all", "creators", "users"]).default("all"),
});

export const adminBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: z.infer<typeof BroadcastSchema>) => BroadcastSchema.parse(d))
  .handler(async ({ context, data }) => {
    // admin check
    const { data: roleRow } = await context.supabase
      .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (!roleRow) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // resolve audience
    let query = supabaseAdmin.from("profiles").select("id, gender, is_banned");
    const { data: profiles, error } = await query;
    if (error) throw new Error(error.message);
    const recipients = (profiles ?? []).filter((p: { id: string; gender: string | null; is_banned: boolean | null }) => {
      if (p.is_banned) return false;
      if (data.audience === "creators") return p.gender === "female";
      if (data.audience === "users") return p.gender !== "female";
      return true;
    });

    let pushed = 0;
    // sequential to avoid hammering FCM with thousands of parallel fetches.
    for (const r of recipients) {
      const out = await notifyUser({
        userId: r.id,
        kind: "system",
        title: data.title,
        body: data.body ?? null,
        deepLink: data.deepLink ?? null,
      });
      pushed += out.pushed;
    }

    await supabaseAdmin.from("push_broadcasts").insert({
      sender_id: context.userId,
      title: data.title,
      body: data.body ?? null,
      deep_link: data.deepLink ?? null,
      audience: data.audience,
      recipients_count: recipients.length,
      push_sent_count: pushed,
    });

    return { recipients: recipients.length, pushed };
  });

export const adminListBroadcasts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roleRow } = await context.supabase
      .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (!roleRow) throw new Error("Forbidden");
    const { data } = await context.supabase
      .from("push_broadcasts")
      .select("id, title, body, audience, recipients_count, push_sent_count, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    return data ?? [];
  });
