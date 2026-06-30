import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { UserPlus, Check, X, ChevronLeft, Inbox } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import {
  listFollowRequests,
  markFollowRequestsSeen,
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

function expiresIn(iso: string): { label: string; urgent: boolean } | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { label: "Expired", urgent: true };
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days >= 2) return { label: `Expires in ${days}d`, urgent: false };
  if (hours >= 1) return { label: `Expires in ${hours}h`, urgent: hours < 12 };
  return { label: `Expires in ${Math.max(1, mins)}m`, urgent: true };
}

function RequestsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listFollowRequests);
  const respondFn = useServerFn(respondFollowRequest);

  const { data: reqs = [], isLoading } = useQuery({
    queryKey: ["follow-requests"],
    queryFn: () => listFn(),
    refetchOnWindowFocus: true,
    // Realtime drives instant updates; keep a slow safety-net poll only.
    refetchInterval: 120_000,
  });

  // Subscribe to incoming follow rows targeted at the signed-in user so the
  // list refreshes the instant someone sends, cancels, or updates a request —
  // no 30s polling lag.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;

      const invalidate = () => {
        qc.invalidateQueries({ queryKey: ["follow-requests"] });
      };

      channel = supabase
        .channel(`follow-requests:${uid}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "follows",
            filter: `following_id=eq.${uid}`,
          },
          invalidate,
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);



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
                  <div className="flex items-center gap-3 min-w-0 flex-1">
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
                  </div>

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
