import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Bell } from "lucide-react";
import {
  getNotificationPrefs, saveNotificationPrefs, type NotificationPrefs,
} from "@/lib/notifications.functions";
import { registerDeviceToken } from "@/lib/push.functions";
import { registerPushNotifications, isNative } from "@/lib/native";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const ROWS: Array<{ key: keyof NotificationPrefs; tKey: string; fallback: string }> = [
  { key: "chat", tKey: "notif.prefs.chat", fallback: "Chat messages" },
  { key: "calls", tKey: "notif.prefs.calls", fallback: "Calls" },
  { key: "gifts", tKey: "notif.prefs.gifts", fallback: "Gifts" },
  { key: "follows", tKey: "notif.prefs.follows", fallback: "Follows & friend requests" },
  { key: "online_followers", tKey: "notif.prefs.online_followers", fallback: "“Online aa gaya” — users I follow" },
  { key: "online_creators", tKey: "notif.prefs.online_creators", fallback: "“Online aa gaya” — creators I follow" },
  { key: "system", tKey: "notif.prefs.system", fallback: "System updates" },
  { key: "marketing", tKey: "notif.prefs.marketing", fallback: "Promotions & marketing" },
];

export function NotificationPrefsCard() {
  const { t } = useT();
  const qc = useQueryClient();
  const [enabling, setEnabling] = useState(false);
  const getFn = useServerFn(getNotificationPrefs);
  const saveFn = useServerFn(saveNotificationPrefs);
  const { data: prefs } = useQuery({ queryKey: ["notif-prefs"], queryFn: () => getFn() });

  const saveMut = useMutation({
    mutationFn: (next: NotificationPrefs) => saveFn({ data: next }),
    onMutate: (next) => {
      qc.setQueryData(["notif-prefs"], next);
    },
    onSuccess: () => toast.success("Preferences saved"),
    onError: (e: any) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["notif-prefs"] });
    },
  });

  if (!prefs) return null;

  function toggle(key: keyof NotificationPrefs, value: boolean) {
    saveMut.mutate({ ...prefs!, [key]: value });
  }

  async function enableDeviceNotifications() {
    setEnabling(true);
    try {
      const reg = await registerPushNotifications();
      if (!reg) {
        toast.error("Notification permission not granted or Firebase setup missing.");
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Please sign in again.");
        return;
      }
      await registerDeviceToken({ data: { token: reg.token, platform: reg.platform } });
      toast.success("Device notifications enabled");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not enable notifications");
    } finally {
      setEnabling(false);
    }
  }

  return (
    <Card className="glass mt-4 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Bell className="size-4 text-primary" />
        <p className="text-sm font-semibold">{t("settings.notifications")}</p>
      </div>
      <div className="space-y-3">
        {isNative() && (
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-start gap-2"
            disabled={enabling}
            onClick={enableDeviceNotifications}
          >
            <Bell className="size-4" />
            {enabling ? "Enabling..." : "Enable device notifications"}
          </Button>
        )}
        {ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between">
            <span className="text-sm">{t(row.tKey)}</span>
            <Switch
              checked={prefs[row.key]}
              onCheckedChange={(v) => toggle(row.key, v)}
              disabled={saveMut.isPending}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
