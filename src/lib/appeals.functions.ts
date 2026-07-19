import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const APPEAL_COOLDOWN_HOURS = 24;

export const submitBanAppeal = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({
      message: z.string().trim().min(20, "Please write at least 20 characters explaining your appeal").max(2000),
      banId: z.string().uuid().optional().nullable(),
      reportId: z.string().uuid().optional().nullable(),
    }).parse(d)
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Cooldown: one pending appeal at a time, and rate-limit new submissions.
    const cutoff = new Date(Date.now() - APPEAL_COOLDOWN_HOURS * 3600_000).toISOString();
    const { data: recent, error: recentErr } = await supabase
      .from("ban_appeals")
      .select("id, status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (recentErr) throw new Error(recentErr.message);

    const last = recent?.[0];
    if (last?.status === "pending") {
      throw new Error("You already have a pending appeal — please wait for our team to review it.");
    }
    if (last && last.created_at > cutoff) {
      throw new Error(`Please wait ${APPEAL_COOLDOWN_HOURS}h between appeals.`);
    }

    const { data: row, error } = await supabase
      .from("ban_appeals")
      .insert({
        user_id: userId,
        ban_id: data.banId ?? null,
        report_id: data.reportId ?? null,
        message: data.message,
      })
      .select("id, status, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, appeal: row };
  });

export const listMyAppeals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("ban_appeals")
      .select("id, status, message, admin_notes, created_at, reviewed_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminListAppeals = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({
      status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
      limit: z.number().int().min(1).max(200).default(100),
    }).parse(d ?? {})
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("ban_appeals")
      .select("id, user_id, ban_id, report_id, message, status, admin_notes, reviewed_by, reviewed_at, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    let profiles: Record<string, { username: string | null; is_banned: boolean; ban_reason: string | null }> = {};
    if (ids.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles").select("id, username, is_banned, ban_reason").in("id", ids);
      profiles = Object.fromEntries((profs ?? []).map((p: any) => [p.id, {
        username: p.username, is_banned: p.is_banned, ban_reason: p.ban_reason,
      }]));
    }

    return (rows ?? []).map((r) => ({
      ...r,
      username: profiles[r.user_id]?.username ?? null,
      is_banned: profiles[r.user_id]?.is_banned ?? false,
      ban_reason: profiles[r.user_id]?.ban_reason ?? null,
    }));
  });

export const adminReviewAppeal = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({
      appealId: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
      notes: z.string().trim().max(1000).optional().nullable(),
      unban: z.boolean().default(false),
    }).parse(d)
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: appeal, error: fetchErr } = await supabaseAdmin
      .from("ban_appeals").select("id, user_id, status").eq("id", data.appealId).single();
    if (fetchErr) throw new Error(fetchErr.message);
    if (appeal.status !== "pending") throw new Error("Appeal already reviewed");

    const { error: updErr } = await supabaseAdmin
      .from("ban_appeals")
      .update({
        status: data.decision,
        admin_notes: data.notes ?? null,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.appealId);
    if (updErr) throw new Error(updErr.message);

    let unbanned = false;
    if (data.decision === "approved" && data.unban) {
      await supabaseAdmin.from("bans")
        .update({ is_active: false }).eq("user_id", appeal.user_id).eq("is_active", true);
      await supabaseAdmin.from("profiles")
        .update({ is_banned: false, ban_reason: null }).eq("id", appeal.user_id);
      unbanned = true;
    }

    // Notify user in-app (best effort)
    try {
      await supabaseAdmin.from("app_notifications").insert({
        user_id: appeal.user_id,
        kind: "appeal_result",
        title: data.decision === "approved"
          ? (unbanned ? "Appeal approved — account restored" : "Appeal approved")
          : "Appeal declined",
        body: data.notes || (data.decision === "approved"
          ? "Our team has approved your appeal."
          : "Our team has reviewed your appeal and it was not approved."),
        deep_link: unbanned ? "/home" : "/banned",
      });
    } catch { /* non-blocking */ }

    return { ok: true, unbanned };
  });
