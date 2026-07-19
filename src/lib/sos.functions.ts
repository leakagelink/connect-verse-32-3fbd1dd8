import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const REASONS = ["harassment", "nudity", "threat", "scam", "underage", "other"] as const;
const OUTCOMES = ["report_filed", "report_failed", "opened", "cancelled"] as const;

export const logSosEvent = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({
      partnerUserId: z.string().uuid().nullable().optional(),
      callLogId: z.string().uuid().nullable().optional(),
      reason: z.enum(REASONS),
      note: z.string().max(500).optional().nullable(),
      outcome: z.enum(OUTCOMES),
      error: z.string().max(500).optional().nullable(),
      durationMs: z.number().int().nonnegative().optional().nullable(),
      clientMeta: z.record(z.any()).optional().nullable(),
    }).parse(d)
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("sos_events")
      .insert({
        user_id: userId,
        partner_user_id: data.partnerUserId ?? null,
        call_log_id: data.callLogId ?? null,
        reason: data.reason,
        note: data.note ?? null,
        outcome: data.outcome,
        error: data.error ?? null,
        duration_ms: data.durationMs ?? null,
        client_meta: data.clientMeta ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id as string };
  });

export const adminListSosEvents = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({
      limit: z.number().int().min(1).max(200).default(100),
      outcome: z.enum(OUTCOMES).optional(),
      sinceHours: z.number().int().min(1).max(24 * 90).optional(),
    }).parse(d ?? {})
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("sos_events")
      .select("id, user_id, partner_user_id, call_log_id, reason, note, outcome, error, duration_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.outcome) q = q.eq("outcome", data.outcome);
    if (data.sinceHours) {
      const cutoff = new Date(Date.now() - data.sinceHours * 3600_000).toISOString();
      q = q.gte("created_at", cutoff);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const ids = Array.from(
      new Set(
        rows!.flatMap((r) => [r.user_id, r.partner_user_id]).filter((x): x is string => !!x)
      )
    );
    let profiles: Record<string, { username: string | null }> = {};
    if (ids.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles").select("id, username").in("id", ids);
      profiles = Object.fromEntries((profs ?? []).map((p: any) => [p.id, { username: p.username }]));
    }

    return {
      events: rows!.map((r) => ({
        ...r,
        user_username: profiles[r.user_id]?.username ?? null,
        partner_username: r.partner_user_id ? profiles[r.partner_user_id]?.username ?? null : null,
      })),
    };
  });
