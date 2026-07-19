import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { listMyNotifications } from "@/lib/notifications.functions";
import { supabase } from "@/integrations/supabase/client";

/** Sticky-header bell with unread badge. */
export function NotificationsBell({ active }: { active?: boolean }) {
  const fn = useServerFn(listMyNotifications);
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => fn(),
    staleTime: 45_000,
  });
  const unread = data?.unread ?? 0;

  const queryClient = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`rt-notifications-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "app_notifications", filter: `user_id=eq.${uid}` },
          () => { queryClient.invalidateQueries({ queryKey: ["notifications"] }); },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return (
    <Link
      to="/notifications"
      aria-label="Notifications"
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        active ? "bg-primary/15 text-primary" : "hover:bg-muted text-foreground/80",
      )}
      title="Notifications"
    >
      <Bell className="size-5" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
