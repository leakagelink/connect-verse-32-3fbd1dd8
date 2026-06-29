import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppSettings = {
  connect_filters_visible: boolean;
};

const DEFAULTS: AppSettings = {
  connect_filters_visible: true,
};

export const getAppSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("app_settings")
      .select("key, value");
    const out: AppSettings = { ...DEFAULTS };
    for (const row of data ?? []) {
      if (row.key in out) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (out as any)[row.key] = row.value;
      }
    }
    return out;
  });

export const setAppSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { key: keyof AppSettings; value: unknown }) => input)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key: data.key, value: data.value as never, updated_by: userId, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
