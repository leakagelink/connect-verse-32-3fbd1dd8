import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PhoneIncoming, PhoneOutgoing, PhoneMissed, Video as VideoIcon,
  Mic, Coins, Clock, History,
} from "lucide-react";
import { listRecentCalls } from "@/lib/calls.functions";
import { InCallPeerProfileSheet } from "@/components/in-call-peer-profile-sheet";

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
  const { data, isLoading } = useQuery({
    queryKey: ["recent-calls"],
    queryFn: () => fn(),
  });
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  const all = data ?? [];
  const voice = all.filter((c) => c.kind === "voice");
  const video = all.filter((c) => c.kind === "video");

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <History className="size-5 text-primary" />
          <h1 className="text-xl font-bold">Recents</h1>
          <Badge variant="secondary" className="ml-auto">{all.length}</Badge>
        </div>

        <Tabs all={all} voice={voice} video={video} loading={isLoading} onOpenProfile={setProfileUserId} />
      </div>
      <InCallPeerProfileSheet
        userId={profileUserId}
        open={!!profileUserId}
        onOpenChange={(v) => { if (!v) setProfileUserId(null); }}
      />
    </AppShell>
  );
}

import { Tabs as UITabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RecentCall } from "@/lib/calls.functions";

function Tabs({ all, voice, video, loading }: { all: RecentCall[]; voice: RecentCall[]; video: RecentCall[]; loading: boolean }) {
  return (
    <UITabs defaultValue="all">
      <TabsList className="w-full">
        <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
        <TabsTrigger value="voice" className="flex-1">Voice</TabsTrigger>
        <TabsTrigger value="video" className="flex-1">Video</TabsTrigger>
      </TabsList>
      <TabsContent value="all"><CallList items={all} loading={loading} /></TabsContent>
      <TabsContent value="voice"><CallList items={voice} loading={loading} /></TabsContent>
      <TabsContent value="video"><CallList items={video} loading={loading} /></TabsContent>
    </UITabs>
  );
}

function CallList({ items, loading }: { items: RecentCall[]; loading: boolean }) {
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
      {items.map((c) => <CallRow key={c.id} call={c} />)}
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

function CallRow({ call }: { call: RecentCall }) {
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

  return (
    <Card className={`glass p-3 flex items-center gap-3 ${isMissed ? "border-destructive/30" : ""}`}>
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
          <KindIcon className="size-3.5 text-muted-foreground shrink-0" />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
          <DirIcon className={`size-3.5 ${dirColor}`} />
          <span className={isMissed ? "text-destructive font-medium" : ""}>{primaryLabel}</span>
          <span>·</span>
          <span>{fmtWhen(call.started_at)}</span>
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
        <Link
          to="/connect"
          className="text-[11px] text-primary hover:underline"
        >
          Call again
        </Link>
      </div>
    </Card>
  );
}
