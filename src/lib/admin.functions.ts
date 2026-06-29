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

// Manually credit or debit coins to a user's wallet. Logged as a
// `admin_credit` / `admin_debit` transaction with the acting admin's id in
// metadata for the audit trail. Debit clamps to 0 — never goes negative.
export const adminAdjustWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    userId: z.string().uuid(),
    action: z.enum(["credit", "debit"]),
    coins: z.number().int().min(1).max(10_000_000),
    reason: z.string().trim().min(2).max(200),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: wallet, error: wErr } = await supabaseAdmin
      .from("wallets")
      .select("user_id, coin_balance")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (wErr) throw new Error(wErr.message);
    if (!wallet) throw new Error("Wallet not found for this user");

    const current = Number(wallet.coin_balance ?? 0);
    const delta = data.action === "credit" ? data.coins : -Math.min(data.coins, current);
    const newBalance = current + delta;

    const { error: uErr } = await supabaseAdmin
      .from("wallets")
      .update({ coin_balance: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", data.userId);
    if (uErr) throw new Error(uErr.message);

    const { error: tErr } = await supabaseAdmin.from("transactions").insert({
      user_id: data.userId,
      type: data.action === "credit" ? "admin_credit" : "admin_debit",
      coins_delta: delta,
      inr_amount: 0,
      metadata: {
        admin_id: context.userId,
        reason: data.reason,
        previous_balance: current,
        new_balance: newBalance,
        requested_coins: data.coins,
      },
    });
    if (tErr) throw new Error(tErr.message);

    return { ok: true, previous: current, balance: newBalance, delta };
  });

// List admin-initiated wallet adjustments (credit/debit) for a specific user.
// Returns most recent first; used by the per-user audit panel in admin UI.
export const adminListUserCoinAdjustments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    userId: z.string().uuid(),
    limit: z.number().int().min(1).max(200).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("transactions")
      .select("id, type, coins_delta, created_at, metadata")
      .eq("user_id", data.userId)
      .in("type", ["admin_credit", "admin_debit"])
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (error) throw new Error(error.message);

    const adminIds = Array.from(new Set(
      (rows ?? [])
        .map((r) => (r.metadata as any)?.admin_id)
        .filter((x): x is string => typeof x === "string"),
    ));
    let adminMap = new Map<string, string>();
    if (adminIds.length) {
      const { data: admins } = await supabaseAdmin
        .from("profiles").select("id, username").in("id", adminIds);
      adminMap = new Map((admins ?? []).map((p) => [p.id, p.username ?? "admin"]));
    }

    return (rows ?? []).map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, any>;
      return {
        id: r.id as string,
        type: r.type as "admin_credit" | "admin_debit",
        coinsDelta: Number(r.coins_delta ?? 0),
        createdAt: r.created_at as string,
        reason: typeof meta.reason === "string" ? meta.reason : null,
        adminId: typeof meta.admin_id === "string" ? meta.admin_id : null,
        adminUsername: typeof meta.admin_id === "string"
          ? (adminMap.get(meta.admin_id) ?? "admin")
          : null,
        previousBalance: typeof meta.previous_balance === "number" ? meta.previous_balance : null,
        newBalance: typeof meta.new_balance === "number" ? meta.new_balance : null,
      };
    });
  });
