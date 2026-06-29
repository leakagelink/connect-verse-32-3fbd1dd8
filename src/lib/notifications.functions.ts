import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  deep_link: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationPrefs = {
  chat: boolean;
  calls: boolean;
  gifts: boolean;
  follows: boolean;
  system: boolean;
  marketing: boolean;
  online_followers: boolean;
  online_creators: boolean;
};

const DEFAULT_PREFS: NotificationPrefs = {
  chat: true, calls: true, gifts: true, follows: true, system: true, marketing: false,
  online_followers: true, online_creators: true,
};

export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("app_notifications")
      .select("id, kind, title, body, deep_link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const unread = (data ?? []).filter((n) => !n.read_at).length;
    return { items: (data ?? []) as AppNotification[], unread };
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("app_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("app_notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("app_notifications").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getNotificationPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("notification_prefs")
      .select("chat, calls, gifts, follows, system, marketing")
      .eq("user_id", context.userId)
      .maybeSingle();
    return (data ?? DEFAULT_PREFS) as NotificationPrefs;
  });

const PrefsSchema = z.object({
  chat: z.boolean(), calls: z.boolean(), gifts: z.boolean(),
  follows: z.boolean(), system: z.boolean(), marketing: z.boolean(),
});

export const saveNotificationPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: NotificationPrefs) => PrefsSchema.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("notification_prefs")
      .upsert({ user_id: context.userId, ...data, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
