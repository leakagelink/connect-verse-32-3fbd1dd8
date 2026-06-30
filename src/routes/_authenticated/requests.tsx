import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { UserPlus, Check, X, ChevronLeft, Inbox } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  listFollowRequests,
  respondFollowRequest,
} from "@/lib/follows.functions";

export const Route = createFileRoute("/_authenticated/requests")({
  component: RequestsPage,
  head: () => ({ meta: [{ title: "Friend requests — Talkora" }] }),
});

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function RequestsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listFollowRequests);
  const respondFn = useServerFn(respondFollowRequest);

  const { data: reqs = [], isLoading } = useQuery({
    queryKey: ["follow-requests"],
    queryFn: () => listFn(),
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const respond = useMutation({
    mutationFn: (vars: { userId: string; action: "accept" | "reject" }) =>
      respondFn({ data: vars }),
    onSuccess: (_d, vars) => {
      toast.success(vars.action === "accept" ? "Request accepted" : "Request removed");
      qc.invalidateQueries({ queryKey: ["follow-requests"] });
      qc.invalidateQueries({ queryKey: ["partner-profile"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Could not respond"),
  });

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Link
            to="/notifications"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" /> Notifications
          </Link>
        </div>

        <Card className="glass p-4">
          <div className="flex items-center gap-2">
            <UserPlus className="size-5 text-primary" />
            <h1 className="text-base font-semibold">Friend requests</h1>
            <span className="ml-auto text-xs text-muted-foreground">
              {reqs.length} pending
            </span>
          </div>
        </Card>

        {isLoading ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : reqs.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            <Inbox className="size-10 mx-auto mb-3 opacity-40" />
            No pending friend requests right now.
          </Card>
        ) : (
          <div className="space-y-2">
            {reqs.map((r) => {
              const p = r.profile as
                | { id: string; username: string | null; avatar_url: string | null }
                | undefined;
              if (!p) return null;
              const isBusy = respond.isPending && respond.variables?.userId === p.id;
              return (
                <Card key={p.id} className="glass flex items-center gap-3 p-3">
                  <Link
                    to="/u/$userId"
                    params={{ userId: p.id }}
                    className="flex items-center gap-3 min-w-0 flex-1"
                  >
                    <Avatar className="size-11 shrink-0">
                      {p.avatar_url ? <AvatarImage src={p.avatar_url} /> : null}
                      <AvatarFallback>
                        {(p.username ?? "?").slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {p.username ?? "User"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Wants to connect · {timeAgo(r.created_at)}
                      </p>
                    </div>
                  </Link>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={isBusy}
                      onClick={() => respond.mutate({ userId: p.id, action: "accept" })}
                    >
                      <Check className="mr-1 size-3.5" /> Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      disabled={isBusy}
                      onClick={() => respond.mutate({ userId: p.id, action: "reject" })}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
