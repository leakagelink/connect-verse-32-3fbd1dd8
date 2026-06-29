import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

export const adminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date(); today.setHours(0,0,0,0);
    const [users, openReports, activeBans, todayRecharges, activeSessions] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("reports").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabaseAdmin.from("bans").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabaseAdmin.from("transactions").select("id", { count: "exact", head: true }).eq("type", "recharge").gte("created_at", today.toISOString()),
      supabaseAdmin.from("chat_sessions").select("id", { count: "exact", head: true }).eq("is_active", true),
    ]);
    return {
      users: users.count ?? 0,
      openReports: openReports.count ?? 0,
      activeBans: activeBans.count ?? 0,
      todayRecharges: todayRecharges.count ?? 0,
      activeSessions: activeSessions.count ?? 0,
    };
  });

export const adminListUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    q: z.string().optional(),
    filter: z.enum(["all","banned","creators"]).default("all"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("profiles")
      .select("id, username, gender, country, is_banned, is_creator, ban_reason, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.filter === "banned") q = q.eq("is_banned", true);
    if (data.filter === "creators") q = q.eq("is_creator", true);
    if (data.q) q = q.ilike("username", `%${data.q}%`);
    const { data: rows } = await q;
    if (!rows?.length) return [];
    // Fetch emails from auth.users via Admin API (paginate to cover up to 1000 users)
    const emailMap = new Map<string, string>();
    try {
      let page = 1;
      while (page <= 10) {
        const { data: usersPage } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
        const list = usersPage?.users ?? [];
        list.forEach((u: any) => { if (u.id && u.email) emailMap.set(u.id, u.email); });
        if (list.length < 1000) break;
        page++;
      }
    } catch (e) {
      console.error("[admin] listUsers email fetch failed", e);
    }
    return rows.map((r) => ({ ...r, email: emailMap.get(r.id) ?? null }));
  });

export const adminListReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (!data?.length) return [];
    const ids = Array.from(new Set(data.flatMap((r) => [r.reporter_id, r.target_user_id])));
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, username").in("id", ids);
    const m = new Map((profs ?? []).map((p) => [p.id, p.username]));
    return data.map((r) => ({
      ...r,
      reporter_username: m.get(r.reporter_id) ?? "—",
      target_username: m.get(r.target_user_id) ?? "—",
    }));
  });

export const adminBanUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    userId: z.string().uuid(),
    reason: z.string().min(2).max(200),
    type: z.enum(["temp","perm"]).default("perm"),
    days: z.number().int().min(1).max(365).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const expires = data.type === "temp" && data.days
      ? new Date(Date.now() + data.days * 86400000).toISOString()
      : null;
    await supabaseAdmin.from("bans").insert({
      user_id: data.userId, banned_by: context.userId, reason: data.reason,
      type: data.type, expires_at: expires,
    });
    await supabaseAdmin.from("profiles")
      .update({ is_banned: true, ban_reason: data.reason })
      .eq("id", data.userId);
    return { ok: true };
  });

export const adminUnbanUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("bans").update({ is_active: false }).eq("user_id", data.userId).eq("is_active", true);
    await supabaseAdmin.from("profiles").update({ is_banned: false, ban_reason: null }).eq("id", data.userId);
    return { ok: true };
  });

export const adminUpdateReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    reportId: z.string().uuid(),
    status: z.enum(["reviewed","actioned","dismissed"]),
    notes: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("reports").update({
      status: data.status,
      admin_notes: data.notes ?? null,
      reviewed_at: new Date().toISOString(),
    }).eq("id", data.reportId);
    return { ok: true };
  });

export const adminListTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!data?.length) return [];
    const ids = Array.from(new Set(data.map((t) => t.user_id)));
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, username").in("id", ids);
    const m = new Map((profs ?? []).map((p) => [p.id, p.username]));
    return data.map((t) => ({ ...t, username: m.get(t.user_id) ?? "—" }));
  });
