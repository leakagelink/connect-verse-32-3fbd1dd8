import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Mode = "test" | "live";

async function loadSettings(): Promise<{
  mode: Mode;
  key_id: string;
  key_secret: string;
  webhook_secret: string;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "payment_mode",
      "razorpay_key_id",
      "razorpay_key_secret",
      "razorpay_webhook_secret",
    ]);
  const map: Record<string, unknown> = {};
  for (const r of data ?? []) map[r.key] = r.value;
  const unwrap = (v: unknown) => (typeof v === "string" ? v : "");
  let mode = unwrap(map.payment_mode) as Mode;
  if (mode !== "live") mode = "test";
  return {
    mode,
    key_id: unwrap(map.razorpay_key_id) || process.env.RAZORPAY_KEY_ID || "",
    key_secret: unwrap(map.razorpay_key_secret) || process.env.RAZORPAY_KEY_SECRET || "",
    webhook_secret:
      unwrap(map.razorpay_webhook_secret) || process.env.RAZORPAY_WEBHOOK_SECRET || "",
  };
}

export async function getPaymentSettings() {
  return loadSettings();
}

/** Public-to-user: what mode is checkout in, and (if live) the publishable key id. */
export const getPaymentConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const s = await loadSettings();
    const liveReady = s.mode === "live" && !!s.key_id && !!s.key_secret;
    return {
      mode: liveReady ? ("live" as const) : ("test" as const),
      keyId: liveReady ? s.key_id : "",
    };
  });

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data: isAdmin } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

function mask(v: string): string {
  if (!v) return "";
  if (v.length <= 8) return "•".repeat(v.length);
  return v.slice(0, 4) + "•".repeat(Math.max(4, v.length - 8)) + v.slice(-4);
}

export const adminGetPaymentConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const s = await loadSettings();
    return {
      mode: s.mode,
      key_id_masked: mask(s.key_id),
      key_secret_masked: mask(s.key_secret),
      webhook_secret_masked: mask(s.webhook_secret),
      has_key_id: !!s.key_id,
      has_key_secret: !!s.key_secret,
      has_webhook_secret: !!s.webhook_secret,
    };
  });

const SaveInput = z.object({
  mode: z.enum(["test", "live"]).optional(),
  key_id: z.string().max(120).optional(),
  key_secret: z.string().max(200).optional(),
  webhook_secret: z.string().max(200).optional(),
});

export const adminSavePaymentConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows: { key: string; value: unknown }[] = [];
    if (data.mode !== undefined) rows.push({ key: "payment_mode", value: data.mode });
    if (data.key_id !== undefined) rows.push({ key: "razorpay_key_id", value: data.key_id.trim() });
    if (data.key_secret !== undefined)
      rows.push({ key: "razorpay_key_secret", value: data.key_secret.trim() });
    if (data.webhook_secret !== undefined)
      rows.push({ key: "razorpay_webhook_secret", value: data.webhook_secret.trim() });
    if (rows.length === 0) return { ok: true };

    for (const r of rows) {
      const { error } = await supabaseAdmin
        .from("app_settings")
        .upsert(
          {
            key: r.key,
            value: r.value as never,
            updated_by: context.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" },
        );
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
