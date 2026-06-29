import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

const KycInput = z.object({
  full_name: z.string().trim().min(2).max(100),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pan_number: z.string().trim().toUpperCase().regex(PAN_RE, "Invalid PAN"),
  aadhaar_last4: z.string().regex(/^\d{4}$/, "Last 4 digits only"),
  pan_doc_path: z.string().min(1),
  aadhaar_front_path: z.string().min(1),
  aadhaar_back_path: z.string().min(1),
  selfie_path: z.string().min(1),
  payout_method: z.enum(["bank", "upi"]),
  bank_account_name: z.string().trim().max(100).optional().nullable(),
  bank_account_number: z.string().trim().regex(/^\d{6,18}$/).optional().nullable(),
  bank_ifsc: z.string().trim().toUpperCase().regex(IFSC_RE).optional().nullable(),
  upi_id: z.string().trim().regex(UPI_RE).optional().nullable(),
}).superRefine((v, ctx) => {
  if (v.payout_method === "bank") {
    if (!v.bank_account_name || !v.bank_account_number || !v.bank_ifsc) {
      ctx.addIssue({ code: "custom", message: "Bank details required" });
    }
  } else {
    if (!v.upi_id) ctx.addIssue({ code: "custom", message: "UPI ID required" });
  }
  const age = (Date.now() - new Date(v.dob).getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 18) ctx.addIssue({ code: "custom", message: "Must be 18+" });
});

export const getMyKyc = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("kyc_requests")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  });

export const submitKyc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => KycInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Block resubmission if an approved or pending one exists
    const { data: existing } = await supabase
      .from("kyc_requests")
      .select("id, status")
      .eq("user_id", userId)
      .in("status", ["pending", "approved"])
      .limit(1);
    if (existing && existing.length > 0) {
      throw new Error(existing[0].status === "approved" ? "KYC already verified" : "KYC already submitted, awaiting review");
    }
    const { error } = await supabase.from("kyc_requests").insert({
      user_id: userId,
      full_name: data.full_name,
      dob: data.dob,
      pan_number: data.pan_number,
      aadhaar_last4: data.aadhaar_last4,
      pan_doc_path: data.pan_doc_path,
      aadhaar_front_path: data.aadhaar_front_path,
      aadhaar_back_path: data.aadhaar_back_path,
      selfie_path: data.selfie_path,
      payout_method: data.payout_method,
      bank_account_name: data.bank_account_name ?? null,
      bank_account_number: data.bank_account_number ?? null,
      bank_ifsc: data.bank_ifsc ?? null,
      upi_id: data.upi_id ?? null,
      status: "pending",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Withdrawal
const WithdrawInput = z.object({
  coins: z.number().int().positive(),
});

export const requestWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => WithdrawInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1) KYC must be approved
    const { data: kyc } = await supabase
      .from("kyc_requests")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "approved")
      .order("reviewed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!kyc) throw new Error("KYC not verified. Please complete KYC first.");

    // 2) Settings
    const { data: settings } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["min_withdrawal_coins", "coin_to_inr_rate"]);
    const map = new Map((settings ?? []).map(s => [s.key, s.value]));
    const minCoins = Number(map.get("min_withdrawal_coins") ?? 10000);
    const rate = Number(map.get("coin_to_inr_rate") ?? 0.05);

    if (data.coins < minCoins) {
      throw new Error(`Minimum withdrawal is ${minCoins} coins (₹${(minCoins * rate).toFixed(2)})`);
    }

    // 3) Balance check
    const { data: wallet } = await supabase
      .from("wallets")
      .select("coin_balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (!wallet || Number(wallet.coin_balance) < data.coins) {
      throw new Error("Insufficient balance");
    }

    // 4) Block if pending withdrawal exists
    const { data: pending } = await supabase
      .from("withdrawals")
      .select("id")
      .eq("user_id", userId)
      .in("status", ["pending", "processing"])
      .limit(1);
    if (pending && pending.length > 0) {
      throw new Error("You already have a pending withdrawal request");
    }

    const inr = Number((data.coins * rate).toFixed(2));
    const snapshot = kyc.payout_method === "bank"
      ? { method: "bank", account_name: kyc.bank_account_name, account_number: kyc.bank_account_number, ifsc: kyc.bank_ifsc }
      : { method: "upi", upi_id: kyc.upi_id };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Deduct coins (hold) — admin can refund on reject
    const { error: upErr } = await supabaseAdmin
      .from("wallets")
      .update({ coin_balance: Number(wallet.coin_balance) - data.coins, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (upErr) throw new Error(upErr.message);

    const { error: insErr, data: row } = await supabaseAdmin
      .from("withdrawals")
      .insert({
        user_id: userId,
        coins: data.coins,
        inr_amount: inr,
        payout_method: kyc.payout_method,
        payout_snapshot: snapshot,
        status: "pending",
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    await supabaseAdmin.from("transactions").insert({
      user_id: userId,
      type: "withdrawal_hold",
      coins_delta: -data.coins,
      inr_amount: inr,
      metadata: { withdrawal_id: row.id },
    });

    return { ok: true, withdrawal_id: row.id, inr };
  });

export const listMyWithdrawals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("withdrawals")
      .select("id, coins, inr_amount, payout_method, status, admin_notes, utr_reference, created_at, processed_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(30);
    return data ?? [];
  });

// Signed URL for uploaded KYC doc preview
export const getKycDocUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Only allow if owner OR admin
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    const folder = data.path.split("/")[0];
    if (folder !== context.userId && !isAdmin) throw new Error("Forbidden");
    const { data: signed, error } = await supabaseAdmin.storage.from("kyc-docs").createSignedUrl(data.path, 300);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

// Admin
export const adminListKyc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ status: z.enum(["pending","approved","rejected","all"]).default("pending") }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("kyc_requests").select("*").order("created_at", { ascending: false }).limit(100);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows } = await q;
    // Attach username
    const ids = Array.from(new Set((rows ?? []).map(r => r.user_id)));
    const { data: profs } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, username, gender").in("id", ids)
      : { data: [] as any[] };
    const map = new Map((profs ?? []).map(p => [p.id, p]));
    return (rows ?? []).map(r => ({ ...r, profile: map.get(r.user_id) ?? null }));
  });

export const adminReviewKyc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    id: z.string().uuid(),
    decision: z.enum(["approved","rejected"]),
    notes: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("kyc_requests").update({
      status: data.decision,
      review_notes: data.notes ?? null,
      reviewed_by: context.userId,
      reviewed_at: new Date().toISOString(),
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListWithdrawals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ status: z.enum(["pending","processing","paid","rejected","all"]).default("pending") }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("withdrawals").select("*").order("created_at", { ascending: false }).limit(100);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows } = await q;
    const ids = Array.from(new Set((rows ?? []).map(r => r.user_id)));
    const { data: profs } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, username").in("id", ids)
      : { data: [] as any[] };
    const map = new Map((profs ?? []).map(p => [p.id, p]));
    return (rows ?? []).map(r => ({ ...r, profile: map.get(r.user_id) ?? null }));
  });

export const adminProcessWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    id: z.string().uuid(),
    decision: z.enum(["processing","paid","rejected"]),
    utr_reference: z.string().max(64).optional(),
    notes: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: w } = await supabaseAdmin.from("withdrawals").select("*").eq("id", data.id).maybeSingle();
    if (!w) throw new Error("Not found");

    // If rejected and was pending/processing, refund the coins
    if (data.decision === "rejected" && (w.status === "pending" || w.status === "processing")) {
      const { data: wallet } = await supabaseAdmin.from("wallets").select("coin_balance").eq("user_id", w.user_id).maybeSingle();
      if (wallet) {
        await supabaseAdmin.from("wallets").update({
          coin_balance: Number(wallet.coin_balance) + w.coins,
          updated_at: new Date().toISOString(),
        }).eq("user_id", w.user_id);
        await supabaseAdmin.from("transactions").insert({
          user_id: w.user_id, type: "withdrawal_refund", coins_delta: w.coins, inr_amount: 0,
          metadata: { withdrawal_id: w.id, reason: data.notes ?? "rejected" },
        });
      }
    }
    if (data.decision === "paid") {
      await supabaseAdmin.from("transactions").insert({
        user_id: w.user_id, type: "withdrawal_paid", coins_delta: 0, inr_amount: w.inr_amount,
        metadata: { withdrawal_id: w.id, utr: data.utr_reference ?? null },
      });
    }

    const { error } = await supabaseAdmin.from("withdrawals").update({
      status: data.decision,
      utr_reference: data.utr_reference ?? null,
      admin_notes: data.notes ?? null,
      processed_by: context.userId,
      processed_at: new Date().toISOString(),
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Admin: KYC document purge audit log (retention compliance)
export const adminListKycPurgeLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    cron_run_id: z.string().uuid().optional(),
    kyc_request_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(500).default(200),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin.from("kyc_doc_purge_log")
      .select("*")
      .order("deleted_at", { ascending: false })
      .limit(data.limit);
    if (data.cron_run_id) q = q.eq("cron_run_id", data.cron_run_id);
    if (data.kyc_request_id) q = q.eq("kyc_request_id", data.kyc_request_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map(r => r.user_id)));
    const { data: profs } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, username").in("id", userIds)
      : { data: [] as any[] };
    const map = new Map((profs ?? []).map(p => [p.id, p]));
    return (rows ?? []).map(r => ({ ...r, profile: map.get(r.user_id) ?? null }));
  });

