import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Clock,
  Coins,
  UserSearch,
  ShieldAlert,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  reviewerStatus,
  reviewerResetTrial,
  reviewerGrantCoins,
  reviewerFindMatch,
  reviewerSimulateSOS,
} from "@/lib/reviewer.functions";

export const Route = createFileRoute("/_authenticated/reviewer")({
  head: () => ({
    meta: [
      { title: "Reviewer Mode — Talkora" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Admin-only shortcuts to test Talkora flows." },
    ],
  }),
  component: ReviewerPage,
});

function ReviewerPage() {
  const navigate = useNavigate();
  const statusFn = useServerFn(reviewerStatus);
  const resetFn = useServerFn(reviewerResetTrial);
  const grantFn = useServerFn(reviewerGrantCoins);
  const matchFn = useServerFn(reviewerFindMatch);
  const sosFn = useServerFn(reviewerSimulateSOS);

  const status = useQuery({
    queryKey: ["reviewer", "status"],
    queryFn: () => statusFn(),
    retry: false,
  });

  const resetMut = useMutation({
    mutationFn: () => resetFn(),
    onSuccess: (r) => {
      toast.success(`Free trial reset — ${Math.round(r.freeSeconds / 60)} min available`);
      status.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grantMut = useMutation({
    mutationFn: () => grantFn({ data: {} }),
    onSuccess: (r) => {
      toast.success(`+${r.granted} coins credited (balance: ${r.balance})`);
      status.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const matchMut = useMutation({
    mutationFn: () => matchFn(),
    onSuccess: (r) => {
      if (!r.match) {
        toast.error("No online users found to match with");
        return;
      }
      toast.success(`Matched with ${r.match.username ?? "user"} — opening call…`);
      navigate({
        to: "/call/$kind/$userId",
        params: { kind: "audio", userId: r.match.id },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sosMut = useMutation({
    mutationFn: () => sosFn({ data: {} }),
    onSuccess: () =>
      toast.success("SOS report filed — check Admin → Reports queue"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (status.isError) {
    return (
      <AppShell>
        <div className="p-6">
          <Card className="p-6 text-center">
            <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <p className="font-medium">Admin access required</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Reviewer Mode is admin-only. Ask an admin to grant your account
              the admin role from the Admin panel.
            </p>
          </Card>
        </div>
      </AppShell>
    );
  }

  const s = status.data;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Signed in as
              </p>
              <p className="font-semibold">{s?.username ?? "…"}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => status.refetch()}
              disabled={status.isFetching}
            >
              <RefreshCw
                className={`h-4 w-4 ${status.isFetching ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="secondary">
              <Clock className="mr-1 h-3 w-3" />
              {s ? Math.round((s.freeSeconds ?? 0) / 60) : 0} min free
            </Badge>
            <Badge variant="secondary">
              <Coins className="mr-1 h-3 w-3" />
              {s?.coinBalance ?? 0} coins
            </Badge>
            {s?.isCreator && <Badge>Creator</Badge>}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            These shortcuts write to real tables (wallets, transactions,
            reports). Use only on a test/reviewer account.
          </p>
        </Card>

        <ActionCard
          icon={<Clock className="h-5 w-5" />}
          title="Reset 5 free minutes"
          desc="Sets your free trial back to 300 seconds so you can test billing from zero."
          cta="Reset trial"
          loading={resetMut.isPending}
          onClick={() => resetMut.mutate()}
        />

        <ActionCard
          icon={<Coins className="h-5 w-5" />}
          title="Grant 500 test coins"
          desc="Credits your wallet without going through Razorpay. Logged as admin_credit."
          cta="Credit coins"
          loading={grantMut.isPending}
          onClick={() => grantMut.mutate()}
        />

        <ActionCard
          icon={<UserSearch className="h-5 w-5" />}
          title="Find & call a match"
          desc="Picks an online creator (falls back to any user) and opens an audio call."
          cta="Start match call"
          loading={matchMut.isPending}
          onClick={() => matchMut.mutate()}
        />

        <ActionCard
          icon={<ShieldAlert className="h-5 w-5" />}
          title="Simulate SOS report"
          desc="Files a tagged harassment report so the moderation queue and admin flow are exercised end-to-end."
          cta="Trigger SOS"
          destructive
          loading={sosMut.isPending}
          onClick={() => sosMut.mutate()}
        />

        <Card className="p-4">
          <p className="mb-2 text-sm font-medium">Manual verification</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate({ to: "/wallet" })}
            >
              Wallet <ExternalLink className="ml-1 h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate({ to: "/recharge" })}
            >
              Recharge <ExternalLink className="ml-1 h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate({ to: "/admin" })}
            >
              Admin panel <ExternalLink className="ml-1 h-3 w-3" />
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function ActionCard({
  icon,
  title,
  desc,
  cta,
  loading,
  destructive,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  cta: string;
  loading: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div
          className={`rounded-lg p-2 ${
            destructive
              ? "bg-destructive/10 text-destructive"
              : "bg-primary/10 text-primary"
          }`}
        >
          {icon}
        </div>
        <div className="flex-1">
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
          <Button
            className="mt-3"
            size="sm"
            variant={destructive ? "destructive" : "default"}
            disabled={loading}
            onClick={onClick}
          >
            {loading ? "Working…" : cta}
          </Button>
        </div>
      </div>
    </Card>
  );
}
