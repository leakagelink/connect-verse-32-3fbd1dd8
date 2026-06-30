import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, Check, Trash2 } from "lucide-react";
import {
  listMyNotifications, markNotificationRead, markAllNotificationsRead,
  deleteNotification, type AppNotification,
} from "@/lib/notifications.functions";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationsPage,
});

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function NotificationsPage() {
  const { t } = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const listFn = useServerFn(listMyNotifications);
  const readFn = useServerFn(markNotificationRead);
  const readAllFn = useServerFn(markAllNotificationsRead);
  const delFn = useServerFn(deleteNotification);

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listFn(),
  });

  const readAllMut = useMutation({
    mutationFn: () => readAllFn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("All marked as read");
    },
  });

  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  async function open(n: AppNotification) {
    if (!n.read_at) {
      await readFn({ data: { id: n.id } });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    }
    if (n.deep_link) router.navigate({ to: n.deep_link });
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Bell className="size-5 text-primary" />
            {t("notif.title")}
          </h1>
          {(data?.unread ?? 0) > 0 && (
            <Button size="sm" variant="ghost" onClick={() => readAllMut.mutate()}>
              <Check className="size-4 mr-1" /> {t("notif.markAll")}
            </Button>
          )}
        </div>

        {/* Quick link to incoming friend requests */}
        <Link
          to="/requests"
          className="block rounded-xl border border-primary/30 bg-primary/5 p-3 transition hover:bg-primary/10"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Bell className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Friend requests</p>
              <p className="text-xs text-muted-foreground">See and accept people who want to connect with you.</p>
            </div>
            <span className="text-xs text-primary">Open →</span>
          </div>
        </Link>


        {isLoading ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">{t("common.loading")}</Card>
        ) : (data?.items.length ?? 0) === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            <Bell className="size-10 mx-auto mb-3 opacity-40" />
            {t("notif.empty")}
          </Card>
        ) : (
          <div className="space-y-2">
            {data!.items.map((n) => (
              <Card
                key={n.id}
                className={`p-3 flex items-start gap-3 cursor-pointer transition hover:bg-muted/40 ${
                  !n.read_at ? "border-primary/40 bg-primary/5" : ""
                }`}
                onClick={() => open(n)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{n.title}</span>
                    <Badge variant="outline" className="text-[10px] py-0 h-4">{n.kind}</Badge>
                    {!n.read_at && <span className="size-2 rounded-full bg-primary" />}
                  </div>
                  {n.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.created_at)}</p>
                </div>
                <button
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); delMut.mutate(n.id); }}
                  aria-label="Delete"
                >
                  <Trash2 className="size-4" />
                </button>
              </Card>
            ))}
          </div>
        )}

        <Card className="p-4">
          <div className="text-sm font-semibold mb-1">{t("settings.notifications")}</div>
          <p className="text-xs text-muted-foreground mb-2">
            Choose which notifications you want to receive.
          </p>
          <Link to="/settings" className="text-xs text-primary underline">Manage preferences →</Link>
        </Card>
      </div>
    </AppShell>
  );
}
