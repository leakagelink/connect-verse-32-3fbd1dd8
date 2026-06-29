/**
 * Calling provider pool with automatic failover.
 *
 * Admins add multiple credential sets (Agora and/or 100ms) via the admin
 * panel. Every call requests `getCallingConfig` which returns the highest-
 * priority healthy credential. If that credential errors mid-setup, the
 * client calls `reportCallFailure` and re-requests with the failed
 * credential excluded — automatic switch to the next provider in the pool.
 *
 * Per-month soft quota: when `minutes_used_current_month` reaches
 * `monthly_quota_minutes`, the credential is auto-flagged `exhausted` and
 * excluded from selection until the monthly reset cron runs.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Provider = "agora" | "100ms";

// --- helpers ---------------------------------------------------------------

function mask(v: string): string {
  if (!v) return "";
  if (v.length <= 8) return "•".repeat(v.length);
  return v.slice(0, 4) + "•".repeat(Math.max(4, v.length - 8)) + v.slice(-4);
}

function maskCredentials(provider: Provider, c: Record<string, unknown>) {
  if (provider === "agora") {
    return {
      app_id_masked: mask(String(c.app_id ?? "")),
      app_certificate_masked: mask(String(c.app_certificate ?? "")),
      has_app_id: !!c.app_id,
      has_app_certificate: !!c.app_certificate,
    };
  }
  return {
    access_key_masked: mask(String(c.access_key ?? "")),
    app_secret_masked: mask(String(c.app_secret ?? "")),
    template_id_masked: mask(String(c.template_id ?? "")),
    has_access_key: !!c.access_key,
    has_app_secret: !!c.app_secret,
    has_template_id: !!c.template_id,
  };
}

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data: isAdmin } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

async function pickCredentialServer(
  preferredProvider: Provider | null,
  excludeIds: string[],
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  async function tryStatus(status: "healthy" | "degraded") {
    let q = supabaseAdmin
      .from("calling_credentials")
      .select("*")
      .eq("is_active", true)
      .eq("status", status)
      .order("priority", { ascending: true })
      .order("consecutive_failures", { ascending: true })
      .order("last_used_at", { ascending: true, nullsFirst: true })
      .limit(1);
    if (preferredProvider) q = q.eq("provider", preferredProvider);
    if (excludeIds.length > 0) {
      q = q.not("id", "in", `(${excludeIds.join(",")})`);
    }
    const { data } = await q;
    return data && data.length > 0 ? data[0] : null;
  }

  const cred = (await tryStatus("healthy")) ?? (await tryStatus("degraded"));
  if (cred) {
    await supabaseAdmin
      .from("calling_credentials")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", cred.id);
  }
  return cred;
}

// --- public: get config + tokens ------------------------------------------

const GetCfgInput = z.object({
  preferredProvider: z.enum(["agora", "100ms"]).optional(),
  excludeCredentialIds: z.array(z.string().uuid()).max(20).optional(),
}).optional();

/**
 * Returns the next healthy credential to try. Client passes
 * `excludeCredentialIds` of any creds that already failed in this attempt
 * to drive failover.
 */
export const getCallingConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => GetCfgInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    // Reject banned users upfront
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("is_banned")
      .eq("id", context.userId)
      .maybeSingle();
    if (prof?.is_banned) throw new Error("Account suspended");

    const cred = await pickCredentialServer(
      data?.preferredProvider ?? null,
      data?.excludeCredentialIds ?? [],
    );
    if (!cred) {
      // No provider available — caller falls back to mock / disabled state
      return { provider: "mock" as const, appId: "", credentialId: null };
    }
    const c = (cred.credentials ?? {}) as Record<string, unknown>;
    if (cred.provider === "agora") {
      return {
        provider: "agora" as const,
        appId: String(c.app_id ?? ""),
        credentialId: cred.id,
      };
    }
    return {
      provider: "100ms" as const,
      appId: "", // n/a for 100ms
      credentialId: cred.id,
    };
  });

const AgoraTokenInput = z.object({
  channel: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  role: z.enum(["publisher", "subscriber"]).default("publisher"),
  credentialId: z.string().uuid().optional(),
});

export const issueAgoraToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => AgoraTokenInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("is_banned").eq("id", context.userId).maybeSingle();
    if (prof?.is_banned) throw new Error("Account suspended");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let cred: any = null;
    if (data.credentialId) {
      const { data: row } = await supabaseAdmin
        .from("calling_credentials").select("*").eq("id", data.credentialId).maybeSingle();
      cred = row;
    } else {
      cred = await pickCredentialServer("agora", []);
    }
    if (!cred || cred.provider !== "agora") {
      throw new Error("No Agora credential available");
    }
    const c = cred.credentials as Record<string, string>;
    if (!c.app_id || !c.app_certificate) throw new Error("Agora credential incomplete");

    const agoraMod: any = await import("agora-token");
    const RtcTokenBuilder =
      agoraMod.RtcTokenBuilder ??
      agoraMod.default?.RtcTokenBuilder ??
      agoraMod.default?.default?.RtcTokenBuilder;
    const RtcRole =
      agoraMod.RtcRole ??
      agoraMod.default?.RtcRole ??
      agoraMod.default?.default?.RtcRole;
    if (!RtcTokenBuilder || typeof RtcTokenBuilder.buildTokenWithUserAccount !== "function") {
      throw new Error(
        `agora-token module shape unexpected. top=[${Object.keys(agoraMod).join(",")}] default=[${agoraMod.default ? Object.keys(agoraMod.default).join(",") : "none"}]`,
      );
    }


    const role = data.role === "publisher" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const privilegeExpire = Math.floor(Date.now() / 1000) + 60 * 60;
    const token = RtcTokenBuilder.buildTokenWithUserAccount(
      c.app_id,
      c.app_certificate,
      data.channel,
      context.userId,
      role,
      privilegeExpire,
      privilegeExpire,
    );
    return {
      appId: c.app_id,
      channel: data.channel,
      account: context.userId,
      token,
      expiresAt: privilegeExpire,
      credentialId: cred.id,
    };
  });

const HmsTokenInput = z.object({
  channel: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  role: z.string().min(1).max(40).default("guest"),
  credentialId: z.string().uuid().optional(),
});

/**
 * Issues a 100ms room-join JWT. Idempotently creates the room on first
 * call (POST /v2/rooms) and falls back to GET-by-name if it already
 * exists.
 */
export const issueHmsToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => HmsTokenInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("is_banned").eq("id", context.userId).maybeSingle();
    if (prof?.is_banned) throw new Error("Account suspended");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let cred: any = null;
    if (data.credentialId) {
      const { data: row } = await supabaseAdmin
        .from("calling_credentials").select("*").eq("id", data.credentialId).maybeSingle();
      cred = row;
    } else {
      cred = await pickCredentialServer("100ms", []);
    }
    if (!cred || cred.provider !== "100ms") {
      throw new Error("No 100ms credential available");
    }
    const c = cred.credentials as Record<string, string>;
    if (!c.access_key || !c.app_secret || !c.template_id) {
      throw new Error("100ms credential incomplete");
    }

    const jwt = (await import("jsonwebtoken")).default;
    const now = Math.floor(Date.now() / 1000);

    // 1) Management token to call 100ms REST API
    const mgmtToken = jwt.sign(
      {
        access_key: c.access_key,
        type: "management",
        version: 2,
        iat: now,
        nbf: now,
      },
      c.app_secret,
      { algorithm: "HS256", expiresIn: "24h", jwtid: crypto.randomUUID() },
    );

    // 2) Ensure room exists. POST first; on conflict, GET by name.
    let roomId: string | null = null;
    const createRes = await fetch("https://api.100ms.live/v2/rooms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mgmtToken}`,
      },
      body: JSON.stringify({
        name: data.channel,
        template_id: c.template_id,
        description: `Talkora ${data.channel}`,
      }),
    });
    if (createRes.ok) {
      const j = await createRes.json() as { id: string };
      roomId = j.id;
    } else {
      // Look up by name
      const listRes = await fetch(
        `https://api.100ms.live/v2/rooms?name=${encodeURIComponent(data.channel)}`,
        { headers: { Authorization: `Bearer ${mgmtToken}` } },
      );
      if (!listRes.ok) {
        const txt = await createRes.text().catch(() => "");
        throw new Error(`100ms room setup failed (${createRes.status}): ${txt}`);
      }
      const j = await listRes.json() as { data?: { id: string; name: string }[] };
      const match = j.data?.find((r) => r.name === data.channel);
      if (!match) throw new Error("100ms room not found after create-conflict");
      roomId = match.id;
    }

    // 3) Room auth token
    const authToken = jwt.sign(
      {
        access_key: c.access_key,
        room_id: roomId,
        user_id: context.userId,
        role: data.role,
        type: "app",
        version: 2,
        iat: now,
        nbf: now,
      },
      c.app_secret,
      { algorithm: "HS256", expiresIn: "24h", jwtid: crypto.randomUUID() },
    );

    return {
      roomId,
      channel: data.channel,
      account: context.userId,
      token: authToken,
      expiresAt: now + 24 * 60 * 60,
      credentialId: cred.id,
    };
  });

// --- failure / success reporters -------------------------------------------

const FailureInput = z.object({
  credentialId: z.string().uuid(),
  errorMessage: z.string().max(500).optional(),
});

export const reportCallFailure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => FailureInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.rpc("report_credential_failure", {
      _id: data.credentialId,
      _error: data.errorMessage ?? "client-reported failure",
    });
    return { ok: true };
  });

// --- call metrics + minutes ------------------------------------------------

const MetricsInput = z.object({
  callLogId: z.string().uuid(),
  provider: z.enum(["mock", "agora", "100ms"]),
  credentialId: z.string().uuid().optional(),
  channelName: z.string().max(128).optional(),
  qualityAvg: z.number().min(0).max(6).optional(),
  disconnects: z.number().int().min(0).max(500).optional(),
  failoverChain: z.array(z.object({
    credentialId: z.string().uuid(),
    provider: z.string(),
    error: z.string().optional(),
  })).max(10).optional(),
  durationSeconds: z.number().int().min(0).max(24 * 60 * 60).optional(),
});

export const recordCallMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => MetricsInput.parse(d))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { provider: data.provider };
    if (data.channelName) patch.channel_name = data.channelName;
    if (typeof data.qualityAvg === "number") patch.quality_avg = data.qualityAvg;
    if (typeof data.disconnects === "number") patch.disconnects = data.disconnects;
    if (data.credentialId) patch.credential_id = data.credentialId;
    if (data.failoverChain) patch.failover_chain = data.failoverChain;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Verify ownership before admin-context update.
    const { data: log } = await supabaseAdmin
      .from("call_logs")
      .select("caller_id, callee_id")
      .eq("id", data.callLogId)
      .maybeSingle();
    if (!log || (log.caller_id !== context.userId && log.callee_id !== context.userId)) {
      throw new Error("Not authorized for this call.");
    }
    const { error } = await (supabaseAdmin as any)
      .from("call_logs")
      .update(patch)
      .eq("id", data.callLogId);

    if (error) throw new Error(error.message);


    // Credit successful minutes against the credential quota + mark success
    if (data.credentialId && data.durationSeconds && data.durationSeconds > 0) {
      const minutes = Math.ceil(data.durationSeconds / 60);
      await supabaseAdmin.rpc("add_credential_minutes", { _id: data.credentialId, _minutes: minutes });
      await supabaseAdmin.rpc("report_credential_success", { _id: data.credentialId });
    }

    return { ok: true };
  });

// --- admin CRUD ------------------------------------------------------------

export const adminListCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("calling_credentials")
      .select("id, provider, label, priority, is_active, status, credentials, monthly_quota_minutes, minutes_used_current_month, quota_reset_at, consecutive_failures, last_error, last_error_at, last_used_at, created_at")
      .order("provider", { ascending: true })
      .order("priority", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => {
      const c = (r.credentials ?? {}) as Record<string, unknown>;
      const { credentials: _omit, ...rest } = r;
      return { ...rest, ...maskCredentials(r.provider as Provider, c) };
    });
  });

const CreateInput = z.object({
  provider: z.enum(["agora", "100ms"]),
  label: z.string().min(2).max(80),
  priority: z.number().int().min(1).max(1000).default(100),
  monthly_quota_minutes: z.number().int().min(0).max(10_000_000).nullable().optional(),
  // Agora fields
  app_id: z.string().max(120).optional(),
  app_certificate: z.string().max(200).optional(),
  // 100ms fields
  access_key: z.string().max(120).optional(),
  app_secret: z.string().max(200).optional(),
  template_id: z.string().max(120).optional(),
  subdomain: z.string().max(120).optional(),
});

export const adminCreateCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const creds: Record<string, string> = {};
    if (data.provider === "agora") {
      if (!data.app_id || !data.app_certificate) {
        throw new Error("Agora needs both App ID and App Certificate");
      }
      creds.app_id = data.app_id.trim();
      creds.app_certificate = data.app_certificate.trim();
    } else {
      if (!data.access_key || !data.app_secret || !data.template_id) {
        throw new Error("100ms needs Access Key, App Secret, and Template ID");
      }
      creds.access_key = data.access_key.trim();
      creds.app_secret = data.app_secret.trim();
      creds.template_id = data.template_id.trim();
      if (data.subdomain) creds.subdomain = data.subdomain.trim();
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("calling_credentials")
      .insert({
        provider: data.provider,
        label: data.label,
        priority: data.priority ?? 100,
        monthly_quota_minutes: data.monthly_quota_minutes ?? null,
        credentials: creds,
        status: "healthy",
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  label: z.string().min(2).max(80).optional(),
  priority: z.number().int().min(1).max(1000).optional(),
  is_active: z.boolean().optional(),
  monthly_quota_minutes: z.number().int().min(0).max(10_000_000).nullable().optional(),
  // Optional credential field updates (any provided replace prior value)
  app_id: z.string().max(120).optional(),
  app_certificate: z.string().max(200).optional(),
  access_key: z.string().max(120).optional(),
  app_secret: z.string().max(200).optional(),
  template_id: z.string().max(120).optional(),
  subdomain: z.string().max(120).optional(),
});

export const adminUpdateCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => UpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing, error: e1 } = await supabaseAdmin
      .from("calling_credentials").select("*").eq("id", data.id).maybeSingle();
    if (e1 || !existing) throw new Error("Credential not found");

    const patch: Record<string, unknown> = {};
    if (data.label !== undefined) patch.label = data.label;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    if (data.monthly_quota_minutes !== undefined) patch.monthly_quota_minutes = data.monthly_quota_minutes;

    const creds = { ...(existing.credentials as Record<string, string>) };
    if (existing.provider === "agora") {
      if (data.app_id) creds.app_id = data.app_id.trim();
      if (data.app_certificate) creds.app_certificate = data.app_certificate.trim();
    } else {
      if (data.access_key) creds.access_key = data.access_key.trim();
      if (data.app_secret) creds.app_secret = data.app_secret.trim();
      if (data.template_id) creds.template_id = data.template_id.trim();
      if (data.subdomain) creds.subdomain = data.subdomain.trim();
    }
    patch.credentials = creds;

    const { error } = await (supabaseAdmin as any)
      .from("calling_credentials").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

const IdInput = z.object({ id: z.string().uuid() });

export const adminDeleteCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("calling_credentials").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminResetCredentialStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("calling_credentials")
      .update({
        status: "healthy",
        consecutive_failures: 0,
        last_error: null,
        last_error_at: null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSeedAgoraFromEnv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const appId = process.env.AGORA_APP_ID?.trim();
    const appCert = process.env.AGORA_APP_CERTIFICATE?.trim();
    if (!appId || !appCert) throw new Error("AGORA_APP_ID / AGORA_APP_CERTIFICATE not set");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Skip if an Agora credential with same app_id already exists
    const { data: existing } = await supabaseAdmin
      .from("calling_credentials")
      .select("id, credentials")
      .eq("provider", "agora");
    const dup = (existing ?? []).find(
      (r: any) => (r.credentials as any)?.app_id === appId,
    );
    if (dup) return { ok: true, id: dup.id, already: true };
    const { data: row, error } = await supabaseAdmin
      .from("calling_credentials")
      .insert({
        provider: "agora",
        label: "Agora (env)",
        priority: 1,
        monthly_quota_minutes: 10000,
        credentials: { app_id: appId, app_certificate: appCert },
        status: "healthy",
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id, already: false };
  });

const TestInput = z.object({ credentialId: z.string().uuid().optional() });

export const adminTestCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => TestInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const diagnostics: Record<string, any> = {
      env: {
        AGORA_APP_ID: process.env.AGORA_APP_ID ? `set(len=${process.env.AGORA_APP_ID.length})` : "MISSING",
        AGORA_APP_CERTIFICATE: process.env.AGORA_APP_CERTIFICATE ? `set(len=${process.env.AGORA_APP_CERTIFICATE.length})` : "MISSING",
      },
    };

    let cred: any = null;
    if (data.credentialId) {
      const { data: row, error } = await supabaseAdmin
        .from("calling_credentials").select("*").eq("id", data.credentialId).maybeSingle();
      if (error) diagnostics.lookupError = error.message;
      cred = row;
    } else {
      cred = await pickCredentialServer(null, []);
      diagnostics.pickedFromPool = !!cred;
    }
    if (!cred) return { ok: false, error: "No credential available in pool", diagnostics };

    const c = (cred.credentials ?? {}) as Record<string, string>;
    diagnostics.credentialId = cred.id;
    diagnostics.label = cred.label;
    diagnostics.provider = cred.provider;
    diagnostics.status = cred.status;
    diagnostics.is_active = cred.is_active;
    diagnostics.fieldsPresent = Object.fromEntries(
      Object.entries(c).map(([k, v]) => [k, v ? `set(len=${String(v).length})` : "MISSING"]),
    );

    const started = Date.now();
    const channel = `test_${Math.random().toString(36).slice(2, 10)}`;

    try {
      if (cred.provider === "agora") {
        const missing: string[] = [];
        if (!c.app_id) missing.push("app_id");
        if (!c.app_certificate) missing.push("app_certificate");
        if (missing.length) {
          throw new Error(`Missing required Agora field(s): ${missing.join(", ")}`);
        }
        if (c.app_id.length !== 32) {
          diagnostics.warnings = [...(diagnostics.warnings ?? []), `app_id length=${c.app_id.length} (expected 32 hex chars)`];
        }
        if (c.app_certificate.length !== 32) {
          diagnostics.warnings = [...(diagnostics.warnings ?? []), `app_certificate length=${c.app_certificate.length} (expected 32 hex chars)`];
        }

        let agoraMod: any;
        try {
          agoraMod = await import("agora-token");
        } catch (impErr: any) {
          throw new Error(`Failed to import 'agora-token' module: ${impErr?.message ?? impErr}`);
        }
        const RtcTokenBuilder =
          agoraMod.RtcTokenBuilder ??
          agoraMod.default?.RtcTokenBuilder ??
          agoraMod.default?.default?.RtcTokenBuilder;
        const RtcRole =
          agoraMod.RtcRole ??
          agoraMod.default?.RtcRole ??
          agoraMod.default?.default?.RtcRole;
        diagnostics.agoraModule = {
          topLevelKeys: Object.keys(agoraMod).slice(0, 20),
          hasDefault: !!agoraMod.default,
          defaultKeys: agoraMod.default ? Object.keys(agoraMod.default).slice(0, 20) : [],
          resolvedRtcTokenBuilder: !!RtcTokenBuilder,
          resolvedRtcRole: !!RtcRole,
        };

        if (!RtcTokenBuilder) {
          throw new Error(`RtcTokenBuilder missing. top=[${diagnostics.agoraModule.topLevelKeys.join(",")}] default=[${diagnostics.agoraModule.defaultKeys.join(",")}]`);
        }

        if (typeof RtcTokenBuilder.buildTokenWithUserAccount !== "function") {
          throw new Error(`RtcTokenBuilder.buildTokenWithUserAccount is not a function. Available methods: [${Object.keys(RtcTokenBuilder).join(", ")}]`);
        }
        if (!RtcRole || typeof RtcRole.PUBLISHER === "undefined") {
          throw new Error(`RtcRole.PUBLISHER missing. RtcRole keys: [${RtcRole ? Object.keys(RtcRole).join(", ") : "null"}]`);
        }

        const exp = Math.floor(Date.now() / 1000) + 300;
        let token: string;
        try {
          token = RtcTokenBuilder.buildTokenWithUserAccount(
            c.app_id, c.app_certificate, channel, "admin-test", RtcRole.PUBLISHER, exp, exp,
          );
        } catch (tErr: any) {
          throw new Error(`buildTokenWithUserAccount threw: ${tErr?.message ?? tErr}`);
        }
        if (!token || token.length < 20) throw new Error(`Token builder returned empty/short token (len=${token?.length ?? 0})`);

        diagnostics.tokenLength = token.length;
        diagnostics.channel = channel;
        await supabaseAdmin.rpc("report_credential_success", { _id: cred.id });
        return {
          ok: true, provider: "agora", credentialId: cred.id, label: cred.label,
          latencyMs: Date.now() - started,
          detail: `Token issued (${token.length} chars). Agora app_id verified.`,
          diagnostics,
        };
      }
      if (cred.provider === "100ms") {
        const missing: string[] = [];
        if (!c.access_key) missing.push("access_key");
        if (!c.app_secret) missing.push("app_secret");
        if (!c.template_id) missing.push("template_id");
        if (missing.length) throw new Error(`Missing required 100ms field(s): ${missing.join(", ")}`);

        const jwt = (await import("jsonwebtoken")).default;
        const now = Math.floor(Date.now() / 1000);
        const mgmt = jwt.sign(
          { access_key: c.access_key, type: "management", version: 2, iat: now, nbf: now },
          c.app_secret,
          { algorithm: "HS256", expiresIn: "5m", jwtid: crypto.randomUUID() },
        );
        const res = await fetch("https://api.100ms.live/v2/rooms?limit=1", {
          headers: { Authorization: `Bearer ${mgmt}` },
        });
        diagnostics.httpStatus = res.status;
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`100ms API ${res.status}: ${txt.slice(0, 300)}`);
        }
        await supabaseAdmin.rpc("report_credential_success", { _id: cred.id });
        return {
          ok: true, provider: "100ms", credentialId: cred.id, label: cred.label,
          latencyMs: Date.now() - started,
          detail: "Management token accepted by 100ms API.",
          diagnostics,
        };
      }
      throw new Error(`Unknown provider: ${cred.provider}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      const stack = typeof e?.stack === "string" ? e.stack.split("\n").slice(0, 5).join("\n") : null;
      await supabaseAdmin.rpc("report_credential_failure", { _id: cred.id, _error: msg });
      return {
        ok: false, provider: cred.provider, credentialId: cred.id, label: cred.label,
        latencyMs: Date.now() - started, error: msg, stack, diagnostics,
      };
    }
  });


