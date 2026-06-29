import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Number of calls a brand-new male account is allowed in its first 24h. */
export const NEW_MALE_DAILY_CALL_CAP = 10;
/** How long an account is considered "new" for cap purposes. */
export const NEW_ACCOUNT_WINDOW_HOURS = 24;

const AvailabilityInput = z.object({
  availability: z.enum(["online", "busy", "dnd"]),
});

export const updateAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => AvailabilityInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({ availability: data.availability })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const LocationBlocksInput = z.object({
  blocked_countries: z.array(z.string().min(1).max(60)).max(50),
  blocked_states: z.array(z.string().min(1).max(80)).max(80),
});

export const updateLocationBlocks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => LocationBlocksInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({
        blocked_countries: data.blocked_countries,
        blocked_states: data.blocked_states,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Hash an IP address with SHA-256. We never store the raw IP — only the hash —
 * so the shadow list can match repeat offenders without holding PII.
 */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SignalsInput = z.object({
  /** Client-computed device fingerprint (UA + screen + tz + canvas hash). */
  deviceFp: z.string().min(8).max(120).optional(),
});

/**
 * Record device fingerprint + hashed IP on the user's profile, and check
 * both against the ban_signals shadow list. If either matches a previously
 * banned signal, the current user is auto-banned with reason "ban_evasion".
 *
 * Called once per session from AppShell on mount.
 */
export const recordDeviceSignals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => SignalsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const h = request?.headers;
    const rawIp =
      h?.get("cf-connecting-ip") ??
      h?.get("x-real-ip") ??
      (h?.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ??
      null;
    const ipHash = rawIp ? await sha256(rawIp) : null;
    const deviceFp = data.deviceFp ?? null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Persist fingerprints on profile (used by record_ban_signals trigger).
    const update: { device_fp?: string; ip_hash?: string } = {};
    if (deviceFp) update.device_fp = deviceFp;
    if (ipHash) update.ip_hash = ipHash;
    if (Object.keys(update).length > 0) {
      await supabaseAdmin.from("profiles").update(update).eq("id", userId);
    }

    // Check shadow list. Either signal hit → ban this account.
    let banned = false;
    let matchedOn: "device" | "ip_hash" | null = null;
    if (deviceFp) {
      const { data: hit } = await supabaseAdmin
        .from("ban_signals")
        .select("id")
        .eq("signal_type", "device")
        .eq("signal_value", deviceFp)
        .maybeSingle();
      if (hit) { banned = true; matchedOn = "device"; }
    }
    if (!banned && ipHash) {
      const { data: hit } = await supabaseAdmin
        .from("ban_signals")
        .select("id")
        .eq("signal_type", "ip_hash")
        .eq("signal_value", ipHash)
        .maybeSingle();
      if (hit) { banned = true; matchedOn = "ip_hash"; }
    }

    if (banned) {
      // Auto-suspend. The record_ban_signals trigger will copy these new
      // signals into ban_signals so subsequent evasion attempts are caught.
      await supabaseAdmin
        .from("profiles")
        .update({
          is_banned: true,
          ban_reason: `ban_evasion (matched ${matchedOn})`,
        })
        .eq("id", userId);
      return { ok: true, banned: true, matchedOn };
    }

    return { ok: true, banned: false, matchedOn: null };
  });
