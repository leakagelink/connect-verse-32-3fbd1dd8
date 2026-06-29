import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { NotificationPrefsCard } from "@/components/notification-prefs-card";

export const Route = createFileRoute("/_authenticated/notification-preferences")({
  component: NotificationPreferencesPage,
  errorComponent: ({ error }) => (
    <div className="p-4 text-sm text-destructive">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-4 text-sm">Not found</div>,
});

function NotificationPreferencesPage() {
  return (
    <div className="mx-auto max-w-xl p-4 pb-24">
      <div className="mb-3 flex items-center gap-2">
        <Link
          to="/settings"
          className="inline-flex size-9 items-center justify-center rounded-full hover:bg-muted"
          aria-label="Back to settings"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-lg font-semibold">Notification preferences</h1>
      </div>
      <p className="mb-2 px-1 text-xs text-muted-foreground">
        Pick exactly which alerts you want. “Online aa gaya” pings can be turned
        on or off separately for users you follow and creators you follow.
      </p>
      <NotificationPrefsCard />
    </div>
  );
}
