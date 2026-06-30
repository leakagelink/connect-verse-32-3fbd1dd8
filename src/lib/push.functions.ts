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

/* ------------------------------------------------------------------ */
/* Follow-request push diagnostics                                     */
/* Lets an admin inspect whether a `sendFollowRequest` push actually   */
/* lands on the recipient device — prefs, tokens, FCM config, and an   */
/* optional live test send through the same `notifyUser` path.         */
/* ------------------------------------------------------------------ */

const DiagFollowSchema = z.object({
  // recipient identifier — accepts a UUID or a username (with or without @)
  target: z.string().min(1).max(120),
  send: z.boolean().optional().default(false),
});

export const adminDiagnoseFollowPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: z.infer<typeof DiagFollowSchema>) => DiagFollowSchema.parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve recipient (UUID or username)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.target.trim());
    const handle = data.target.trim().replace(/^@/, "");
    let profileQuery = supabaseAdmin.from("profiles").select("id, username, full_name, is_banned");
    profileQuery = isUuid ? profileQuery.eq("id", handle) : profileQuery.eq("username", handle);
    const { data: profile } = await profileQuery.maybeSingle();
    if (!profile) throw new Error("Recipient not found");

    // Notification prefs
    const { data: prefsRow } = await supabaseAdmin
      .from("notification_prefs")
      .select("chat, calls, gifts, follows, system, marketing")
      .eq("user_id", profile.id)
      .maybeSingle();
    const followsAllowed = (prefsRow as { follows?: boolean } | null)?.follows ?? true;

    // Device tokens
    const { data: tokens } = await supabaseAdmin
      .from("device_tokens")
      .select("token, platform, last_seen_at, created_at")
      .eq("user_id", profile.id)
      .order("last_seen_at", { ascending: false });
    const tokenRows = (tokens ?? []).map((t: any) => ({
      platform: t.platform,
      tokenMasked: `${String(t.token).slice(0, 12)}…${String(t.token).slice(-6)}`,
      lastSeenAt: t.last_seen_at,
      createdAt: t.created_at,
    }));

    // FCM config status
    const { data: cfgRow } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "fcm_service_account_json").maybeSingle();
    const rawCfg = typeof cfgRow?.value === "string" ? cfgRow.value : "";
    let fcmProjectId = "";
    let fcmValid = false;
    if (rawCfg) {
      try {
        const j = JSON.parse(rawCfg);
        fcmProjectId = j.project_id ?? "";
        fcmValid = !!(j.project_id && j.client_email && j.private_key);
      } catch { /* ignore */ }
    }
    const fcmConfigured = fcmValid || !!process.env.FCM_SERVICE_ACCOUNT_JSON;

    // Recent follow-kind notifications in last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("app_notifications")
      .select("id, title, body, created_at, deep_link")
      .eq("user_id", profile.id)
      .eq("kind", "follows")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10);

    // Optional live test send through the exact same path
    let liveSend: {
      attempted: boolean;
      pushed: number;
      bellInserted: boolean;
      reason?: string;
    } = { attempted: false, pushed: 0, bellInserted: false };

    if (data.send) {
      liveSend.attempted = true;
      if (profile.is_banned) {
        liveSend.reason = "Recipient is banned";
      } else if (tokenRows.length === 0) {
        liveSend.reason = "No device tokens registered for recipient";
      } else if (!fcmConfigured) {
        liveSend.reason = "FCM service account not configured";
      }
      const out = await notifyUser({
        userId: profile.id,
        kind: "follows",
        title: "Diagnostic: friend request push",
        body: "If you see this notification, follow-request pushes are reaching this device.",
        deepLink: "/requests",
      });
      liveSend.pushed = out.pushed;
      // notifyUser inserts a bell row unless silenceBellToo (follows + !allow)
      liveSend.bellInserted = !(!followsAllowed);
    }

    // Build a verdict
    const issues: string[] = [];
    if (profile.is_banned) issues.push("Recipient is banned");
    if (!followsAllowed) issues.push("Recipient disabled 'Follows & friend requests' in notification prefs — both bell and FCM are skipped");
    if (tokenRows.length === 0) issues.push("Recipient has no registered device tokens (push will never deliver)");
    if (!fcmConfigured) issues.push("FCM service account not configured in admin");

    return {
      recipient: {
        id: profile.id,
        username: profile.username,
        displayName: profile.full_name,
        isBanned: !!profile.is_banned,
      },
      prefs: {
        hasRow: !!prefsRow,
        followsAllowed,
        all: prefsRow ?? null,
      },
      tokens: { count: tokenRows.length, rows: tokenRows },
      fcm: { configured: fcmConfigured, projectId: fcmProjectId },
      recentFollowNotifications: recent ?? [],
      liveSend,
      verdict: issues.length === 0 ? "ok" : "issues",
      issues,
    };
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
