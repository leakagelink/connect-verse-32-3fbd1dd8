import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PhoneIncoming, PhoneOutgoing, PhoneMissed, Video as VideoIcon,
  Mic, Coins, Clock, History, Phone, UserPlus, UserCheck, Loader2,
} from "lucide-react";
import { listRecentCalls } from "@/lib/calls.functions";
import { getFollowStatusBatch, sendFollowRequest, unfollowUser } from "@/lib/follows.functions";
import { InCallPeerProfileSheet } from "@/components/in-call-peer-profile-sheet";
import { CallInviteDialog } from "@/components/call-invite-dialog";
import { requestCallPermissions } from "@/lib/native";

export const Route = createFileRoute("/_authenticated/recents")({
  component: RecentsScreen,
});

function fmtDuration(s: number) {
  if (!s) return "0s";
  const m = Math.floor(s / 60);
  const ss = s % 60;
  if (m === 0) return `${ss}s`;
  return `${m}m ${ss}s`;
}

function fmtWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  if (isYest) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}, ${time}`;
}

function RecentsScreen() {
  const fn = useServerFn(listRecentCalls);
  const followBatchFn = useServerFn(getFollowStatusBatch);
  const { data, isLoading } = useQuery({
    queryKey: ["recent-calls"],
    queryFn: () => fn(),
  });
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [callInvite, setCallInvite] = useState<{ kind: "voice" | "video"; userId: string } | null>(null);

  const all = data ?? [];
  const voice = all.filter((c) => c.kind === "voice");
  const video = all.filter((c) => c.kind === "video");

  // Latest call for the partner whose profile is open — drives the
  // "call available nahi" notice inside the sheet. Always the most-recent
  // row because `all` is already sorted DESC by started_at.
  const lastCallForProfile = useMemo(() => {
    if (!profileUserId) return null;
    const row = all.find((c) => c.partner.id === profileUserId);
    if (!row) return null;
    return {
      status: row.status,
      missedReason: row.missed_reason ?? null,
      kind: row.kind,
    };
  }, [profileUserId, all]);

  // Unique partner ids for follow-status lookup.
  const partnerIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of all) if (c.partner.id) set.add(c.partner.id);
    return [...set];
  }, [all]);

  const { data: followMap } = useQuery({
    queryKey: ["recents-follow-status", partnerIds.join(",")],
    queryFn: () => followBatchFn({ data: { userIds: partnerIds } }),
    enabled: partnerIds.length > 0,
    staleTime: 30_000,
  });

  async function startCall(kind: "voice" | "video", userId: string) {
    try { await requestCallPermissions(kind); } catch { /* surfaced by call screen */ }
    setCallInvite({ kind, userId });
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <History className="size-5 text-primary" />
          <h1 className="text-xl font-bold">Recents</h1>
          <Badge variant="secondary" className="ml-auto">{all.length}</Badge>
        </div>

        <Tabs
          all={all}
          voice={voice}
          video={video}
          loading={isLoading}
          onOpenProfile={setProfileUserId}
          onCall={startCall}
          followMap={followMap ?? {}}
        />
      </div>
      <InCallPeerProfileSheet
        userId={profileUserId}
        open={!!profileUserId}
        onOpenChange={(v) => { if (!v) setProfileUserId(null); }}
      />
      <CallInviteDialog pendingCall={callInvite} onClose={() => setCallInvite(null)} />
    </AppShell>
  );
}

import { Tabs as UITabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RecentCall } from "@/lib/calls.functions";

type FollowStatus = "accepted" | "pending" | null;

type ListProps = {
  all: RecentCall[];
  voice: RecentCall[];
  video: RecentCall[];
  loading: boolean;
  onOpenProfile: (id: string) => void;
  onCall: (kind: "voice" | "video", userId: string) => void;
  followMap: Record<string, FollowStatus>;
};

function Tabs({ all, voice, video, loading, onOpenProfile, onCall, followMap }: ListProps) {
  return (
    <UITabs defaultValue="all">
      <TabsList className="w-full">
        <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
        <TabsTrigger value="voice" className="flex-1">Voice</TabsTrigger>
        <TabsTrigger value="video" className="flex-1">Video</TabsTrigger>
      </TabsList>
      <TabsContent value="all"><CallList items={all} loading={loading} onOpenProfile={onOpenProfile} onCall={onCall} followMap={followMap} /></TabsContent>
      <TabsContent value="voice"><CallList items={voice} loading={loading} onOpenProfile={onOpenProfile} onCall={onCall} followMap={followMap} /></TabsContent>
      <TabsContent value="video"><CallList items={video} loading={loading} onOpenProfile={onOpenProfile} onCall={onCall} followMap={followMap} /></TabsContent>
    </UITabs>
  );
}

function CallList({
  items, loading, onOpenProfile, onCall, followMap,
}: {
  items: RecentCall[];
  loading: boolean;
  onOpenProfile: (id: string) => void;
  onCall: (kind: "voice" | "video", userId: string) => void;
  followMap: Record<string, FollowStatus>;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading history…</p>;
  }
  if (!items.length) {
    return (
      <Card className="glass p-8 text-center">
        <History className="size-8 mx-auto text-muted-foreground mb-2" />
        <p className="font-semibold">No call history yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Your voice & video calls will appear here with date, time and duration.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((c) => (
        <CallRow
          key={c.id}
          call={c}
          onOpenProfile={onOpenProfile}
          onCall={onCall}
          followStatus={c.partner.id ? followMap[c.partner.id] ?? null : null}
        />
      ))}
    </div>
  );
}

function missedReasonLabel(call: RecentCall): string | null {
  if (call.status !== "missed") return null;
  const outgoing = call.direction === "outgoing";
  switch (call.missed_reason) {
    case "expired":
      return outgoing ? "No answer" : "Missed — rang out";
    case "caller_cancelled":
      return outgoing ? "You cancelled" : "Caller cancelled";
    case "callee_rejected":
      return outgoing ? "Declined" : "You declined";
    default:
      return outgoing ? "No answer" : "Missed";
  }
}

function FollowButton({ userId, status }: { userId: string; status: FollowStatus }) {
  const qc = useQueryClient();
  const followFn = useServerFn(sendFollowRequest);
  const unfollowFn = useServerFn(unfollowUser);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["recents-follow-status"] });

  const follow = useMutation({
    mutationFn: () => followFn({ data: { userId } }),
    onSuccess: () => { toast.success("Request sent"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Could not send request"),
  });
  const unfollow = useMutation({
    mutationFn: () => unfollowFn({ data: { userId } }),
    onSuccess: () => { toast.success("Unfollowed"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Could not unfollow"),
  });

  const busy = follow.isPending || unfollow.isPending;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (status === "accepted") {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-[11px] gap-1"
        onClick={(e) => { stop(e); unfollow.mutate(); }}
        disabled={busy}
        aria-label="Unfollow"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <UserCheck className="size-3" />}
        Following
      </Button>
    );
  }
  if (status === "pending") {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-[11px] gap-1"
        onClick={(e) => { stop(e); unfollow.mutate(); }}
        disabled={busy}
        aria-label="Cancel follow request"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Clock className="size-3" />}
        Requested
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      className="h-7 px-2 text-[11px] gap-1"
      onClick={(e) => { stop(e); follow.mutate(); }}
      disabled={busy}
      aria-label="Follow"
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <UserPlus className="size-3" />}
      Follow
    </Button>
  );
}

function CallRow({
  call, onOpenProfile, onCall, followStatus,
}: {
  call: RecentCall;
  onOpenProfile: (id: string) => void;
  onCall: (kind: "voice" | "video", userId: string) => void;
  followStatus: FollowStatus;
}) {
  const KindIcon = call.kind === "video" ? VideoIcon : Mic;
  const isMissed = call.status === "missed";
  const DirIcon = isMissed ? PhoneMissed : call.direction === "outgoing" ? PhoneOutgoing : PhoneIncoming;
  const dirColor = isMissed
    ? "text-destructive"
    : call.direction === "outgoing"
    ? "text-primary"
    : "text-emerald-500";
  const reason = missedReasonLabel(call);
  const primaryLabel = isMissed
    ? reason ?? "Missed"
    : call.direction === "outgoing"
    ? "Outgoing"
    : "Incoming";
  const openProfile = () => {
    if (call.partner.id) onOpenProfile(call.partner.id);
  };
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={openProfile}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openProfile();
        }
      }}
      aria-label={`Open ${call.partner.username ?? "user"}'s profile`}
      className={`glass p-3 cursor-pointer hover:bg-accent/30 transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${isMissed ? "border-destructive/30" : ""}`}
    >
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-full brand-gradient flex items-center justify-center text-primary-foreground font-bold shrink-0 overflow-hidden">
          {call.partner.avatar_url ? (
            <img src={call.partner.avatar_url} alt="" className="size-full object-cover" />
          ) : (
            (call.partner.username ?? "U").slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className={`font-semibold truncate ${isMissed ? "text-destructive" : ""}`}>
              {call.partner.username ?? "Unknown"}
            </p>
            <Badge variant="secondary" className="text-[10px] py-0 px-1.5 gap-1 shrink-0">
              <KindIcon className="size-3" />
              {call.kind === "video" ? "Video" : "Voice"}
            </Badge>
            {(() => {
              const status =
                call.status === "missed"
                  ? { label: "Missed", cls: "border-destructive/40 text-destructive" }
                  : call.status === "cancelled"
                  ? { label: "Cancelled", cls: "border-amber-500/40 text-amber-500" }
                  : call.duration_seconds > 0
                  ? { label: "Connected", cls: "border-emerald-500/40 text-emerald-500" }
                  : { label: "Ended", cls: "border-muted-foreground/40 text-muted-foreground" };
              return (
                <Badge variant="outline" className={`text-[10px] py-0 px-1.5 shrink-0 ${status.cls}`}>
                  {status.label}
                </Badge>
              );
            })()}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
            <DirIcon className={`size-3.5 ${dirColor}`} />
            <span className={isMissed ? "text-destructive font-medium" : ""}>{primaryLabel}</span>
            <span>·</span>
            <span title={new Date(call.started_at).toLocaleString()}>{fmtWhen(call.started_at)}</span>
          </div>
        </div>

        <div className="text-right shrink-0">
          {isMissed ? (
            <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px] py-0 px-1.5">
              Missed
            </Badge>
          ) : (
            <div className="flex items-center justify-end gap-1 text-xs font-medium">
              <Clock className="size-3" /> {fmtDuration(call.duration_seconds)}
            </div>
          )}
          {call.coins_spent > 0 && (
            <div className="flex items-center justify-end gap-1 text-[11px] text-coin mt-0.5">
              <Coins className="size-3" /> {call.coins_spent}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      {call.partner.id && (
        <div className="mt-3 flex items-center gap-2 pl-14">
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-[11px] gap-1"
            onClick={(e) => { stop(e); onCall("voice", call.partner.id!); }}
            aria-label="Voice call"
          >
            <Phone className="size-3" /> Voice
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-[11px] gap-1"
            onClick={(e) => { stop(e); onCall("video", call.partner.id!); }}
            aria-label="Video call"
          >
            <VideoIcon className="size-3" /> Video
          </Button>
          <div className="ml-auto" onClick={stop}>
            <FollowButton userId={call.partner.id} status={followStatus} />
          </div>
        </div>
      )}
    </Card>
  );
}
