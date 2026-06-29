import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CreatorPreviewDialog } from "@/components/creator-preview-dialog";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyProfile } from "@/lib/onboarding.functions";
import { getOrCreateConversation } from "@/lib/chat.functions";
import { heartbeat, listOnlineUsers } from "@/lib/presence.functions";
import { listRooms } from "@/lib/rooms.functions";
import { getWallet } from "@/lib/wallet.functions";
import { AppShell } from "@/components/app-shell";
import { EngagementStrip } from "@/components/engagement-strip";
import { LiveCreatorsStrip } from "@/components/live-creators-strip";
import { QuickActionsGrid } from "@/components/quick-actions-grid";
import { RechargeOfferCard } from "@/components/recharge-offer-card";
import { MatchmakerRoomsSection } from "@/components/matchmaker-rooms-section";
import { TrendingNowSection } from "@/components/trending-now-section";
import { FanClubSpotlight } from "@/components/fan-club-spotlight";
import { RecentlyPlayedSection } from "@/components/recently-played-section";
import { ForYouSection } from "@/components/for-you-section";
import { TrustBadgesFooter } from "@/components/trust-badges-footer";

import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageCircle, Phone, Video, Sparkles, Users, Plus, Radio, Gamepad2, Mic, ChevronRight, Flame } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/home")({
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const getProfile = useServerFn(getMyProfile);
  const online = useServerFn(listOnlineUsers);
  const beat = useServerFn(heartbeat);
  const rooms = useServerFn(listRooms);
  const startChat = useServerFn(getOrCreateConversation);
  const wallet = useServerFn(getWallet);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => getProfile(), staleTime: 5 * 60_000 });
  const { data: walletData } = useQuery({ queryKey: ["wallet"], queryFn: () => wallet(), staleTime: 60_000 });
  const { data: onlineUsers, isLoading: loadingOnline, refetch: refetchOnline } = useQuery({
    queryKey: ["online"], queryFn: () => online(), staleTime: 30_000,
  });
  const { data: roomList, isLoading: loadingRooms } = useQuery({
    queryKey: ["rooms"], queryFn: () => rooms(), staleTime: 30_000,
  });

  const queryClient = useQueryClient();
  const [rtConnected, setRtConnected] = useState(true);
  // Trust the server-side online list as source of truth. Realtime presence is
  // used only as a refresh signal because mobile WebViews can reconnect with a
  // partial presence state and would otherwise hide valid online creators.
  const liveOnlineUsers = onlineUsers ?? [];

  // heartbeat every 60s
  useEffect(() => {
    beat().catch(() => {});
    const i = setInterval(() => beat().catch(() => {}), 60_000);
    return () => clearInterval(i);
  }, [beat]);

  // Realtime: rooms table changes invalidate the rooms list instantly
  useEffect(() => {
    const ch = supabase
      .channel("rt-rooms")
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, () => {
        queryClient.invalidateQueries({ queryKey: ["rooms"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

  // Realtime presence: refresh the online users list on join/leave.
  // On disconnect we keep last-known data visible (React Query cache);
  // on reconnect we invalidate so fresh data loads instantly.
  useEffect(() => {
    const uid = me?.profile?.id;
    if (!uid) return;
    const ch = supabase.channel("presence:online", { config: { presence: { key: uid } } });
    const syncPresence = () => {
      queryClient.invalidateQueries({ queryKey: ["online"] });
    };
    ch.on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setRtConnected(true);
          await ch.track({ uid, at: Date.now() });
          queryClient.invalidateQueries({ queryKey: ["online"] });
          queryClient.invalidateQueries({ queryKey: ["rooms"] });
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRtConnected(false);
        }
      });
    return () => { supabase.removeChannel(ch); };
  }, [me?.profile?.id, queryClient]);

  // Browser network reconnect → force refresh and re-heartbeat
  useEffect(() => {
    const onOnline = () => {
      setRtConnected(true);
      beat().catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["online"] });
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };
    const onOffline = () => setRtConnected(false);
    // Android WebView often skips the window 'focus' event when returning
    // from background, so visibilitychange is the reliable trigger to
    // re-beat presence and refresh the online lists.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      beat().catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["online"] });
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [beat, queryClient]);

  useEffect(() => {
    if (me?.profile?.is_banned) navigate({ to: "/banned", replace: true });
    else if (me?.profile && !me.profile.onboarded) navigate({ to: "/onboarding", replace: true });
  }, [me, navigate]);

  const [preview, setPreview] = useState<{ userId: string; kind: "voice" | "video" } | null>(null);

  async function openChat(otherId: string) {
    try {
      const { id } = await startChat({ data: { otherUserId: otherId } });
      navigate({ to: "/chat/$conversationId", params: { conversationId: id } });
    } catch (e: any) { toast.error(e.message); }
  }

  function startCall(uid: string, kind: "voice" | "video") {
    setPreview({ userId: uid, kind });
  }

  function autoMatchFree() {
    const candidates = (liveOnlineUsers).filter(
      (u: any) => u.gender === "female" && u.id !== me?.profile?.id,
    );
    if (candidates.length === 0) {
      toast.info("No female creators are online right now. Try again in a moment.");
      return;
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    setPreview({ userId: pick.id, kind: "voice" });
  }

  const freeMin = Math.floor((me?.profile?.free_seconds_remaining ?? 0) / 60);
  const freeSec = (me?.profile?.free_seconds_remaining ?? 0) % 60;

  return (
    <AppShell isAdmin={me?.isAdmin}>
      {/* Header */}
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Discover</h1>
          <p className="text-sm text-muted-foreground">Live creators · calls · rooms</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetchOnline()}>Refresh</Button>
      </div>

      {/* Free Minutes Hero Banner — sticky, top priority */}
      {(me?.profile?.free_seconds_remaining ?? 0) > 0 && (
        <Card className="relative overflow-hidden mb-4 p-4 border-emerald-500/40 bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-transparent">
          <div className="absolute -right-8 -top-8 size-28 rounded-full bg-emerald-400/15 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <div className="size-12 rounded-2xl bg-emerald-500/25 backdrop-blur flex items-center justify-center">
              <Flame className="size-6 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-extrabold tabular-nums text-emerald-300">
                  {freeMin}:{freeSec.toString().padStart(2, "0")}
                </span>
                <span className="text-xs text-muted-foreground">free min left</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Connect instantly — auto-match with a live creator.</p>
            </div>
            <Button size="sm" className="brand-gradient shadow-lg shadow-primary/30" onClick={autoMatchFree}>
              Use now
            </Button>
          </div>
        </Card>
      )}

      {/* Live Creators Strip */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${rtConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Live Now</h2>
            <Badge variant="secondary" className="text-[10px]">{(liveOnlineUsers).length}</Badge>
            {!rtConnected && (
              <span className="text-[10px] text-amber-500 font-medium">Reconnecting…</span>
            )}
          </div>
          <Link to="/connect" className="text-xs text-primary font-medium">See all →</Link>
        </div>
        <LiveCreatorsStrip users={liveOnlineUsers} loading={loadingOnline} onCall={startCall} />
      </div>

      {/* Quick Actions Grid 2x2 */}
      <div className="mb-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-2">Quick Actions</h2>
        <QuickActionsGrid />
      </div>

      {/* Recharge Offer — only if user still has a bonus tier */}
      <div className="mb-5">
        <RechargeOfferCard depositCount={walletData?.depositCount ?? 0} />
      </div>

      {/* Matchmaker Rooms */}
      <MatchmakerRoomsSection canHost={me?.profile?.gender === "female"} />

      {/* Trending Now — top gifted, hottest room, new joiners */}
      <TrendingNowSection />

      {/* Recently Played With — quick reconnect */}
      <RecentlyPlayedSection onCall={startCall} />

      {/* Fan Club Spotlight */}
      <FanClubSpotlight />

      {/* For You — personalized creators */}
      <ForYouSection onCall={startCall} />


      {/* Engagement (daily check-in streak) */}
      <EngagementStrip />

      {/* Creator dashboard shortcut for female users */}
      {me?.profile?.gender === "female" && (
        <Link to="/creator-dashboard" className="block mb-4">
          <Card className="glass p-3 flex items-center gap-3 border-coin/40 hover:border-coin transition">
            <div className="size-10 rounded-xl bg-coin/15 flex items-center justify-center">
              <Sparkles className="size-5 text-coin" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Creator Dashboard</p>
              <p className="text-[11px] text-muted-foreground">Earnings · schedule · fan club</p>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Card>
        </Link>
      )}






      <Tabs defaultValue="online" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="online"><Users className="size-4 mr-1" />Online</TabsTrigger>
          <TabsTrigger value="voice"><Phone className="size-4 mr-1" />Voice</TabsTrigger>
          <TabsTrigger value="video"><Video className="size-4 mr-1" />Video</TabsTrigger>
          <TabsTrigger value="rooms"><Radio className="size-4 mr-1" />Rooms</TabsTrigger>
        </TabsList>

        <TabsContent value="online" className="mt-4">
          <OnlineList
            users={liveOnlineUsers}
            loading={loadingOnline}
            renderActions={(u) => (
              <Button size="sm" onClick={() => openChat(u.id)}>
                <MessageCircle className="size-4" />
              </Button>
            )}
          />
        </TabsContent>

        <TabsContent value="voice" className="mt-4">
          <p className="text-xs text-muted-foreground mb-3">Tap to start a voice call. Coins are deducted per minute.</p>
          <OnlineList
            users={liveOnlineUsers}
            loading={loadingOnline}
            renderActions={(u) => (
              <Button size="sm" className="brand-gradient" onClick={() => setPreview({ userId: u.id, kind: "voice" })}>
                <Phone className="size-4 mr-1" /> Call
              </Button>
            )}
          />
        </TabsContent>

        <TabsContent value="video" className="mt-4">
          <p className="text-xs text-muted-foreground mb-3">HD video calls. Make sure your camera & mic permissions are allowed.</p>
          <OnlineList
            users={liveOnlineUsers}
            loading={loadingOnline}
            renderActions={(u) => (
              <Button size="sm" className="brand-gradient" onClick={() => setPreview({ userId: u.id, kind: "video" })}>
                <Video className="size-4 mr-1" /> Video
              </Button>
            )}
          />
        </TabsContent>

        <TabsContent value="rooms" className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Live rooms — voice, video, games & live shows.</p>
            <Link to="/rooms/new">
              <Button size="sm" variant="outline"><Plus className="size-4 mr-1" />Host</Button>
            </Link>
          </div>
          {loadingRooms ? (
            <div className="text-center text-muted-foreground py-8">Loading rooms…</div>
          ) : !roomList?.length ? (
            <Card className="glass p-8 text-center text-muted-foreground">No live rooms. Be the first to host!</Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {roomList.map((r: any) => (
                <Link key={r.id} to="/rooms/$id" params={{ id: r.id }}>
                  <Card className="glass p-4 hover:border-primary/40 transition-colors h-full">
                    <div className="flex items-start gap-3">
                      <div className="size-10 rounded-lg brand-gradient flex items-center justify-center">
                        <KindIcon kind={r.kind} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold truncate">{r.title}</p>
                          <Badge variant="secondary" className="text-[10px] uppercase">{r.kind}</Badge>
                        </div>
                        {r.topic && <p className="text-xs text-muted-foreground truncate">{r.topic}</p>}
                        <p className="text-xs text-muted-foreground mt-1">
                          Host: @{r.host?.username ?? "anon"} · {r.participants}/{r.max_seats} seats
                        </p>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <TrustBadgesFooter />



      <CreatorPreviewDialog
        userId={preview?.userId ?? null}
        kind={preview?.kind ?? "voice"}
        onOpenChange={(v) => { if (!v) setPreview(null); }}
        onConfirm={(uid) => {
          const kind = preview?.kind ?? "voice";
          setPreview(null);
          navigate({ to: "/call/$kind/$userId", params: { kind, userId: uid } });
        }}
        onFindAnother={async () => {
          const kind = preview?.kind ?? "voice";
          const prevId = preview?.userId;
          const fresh = await refetchOnline();
          const candidates = (fresh.data ?? []).filter(
            (u: any) => u.gender === "female" && u.id !== me?.profile?.id && u.id !== prevId,
          );
          if (candidates.length === 0) {
            toast.info("No other female creators are online right now.");
            setPreview(null);
            return;
          }
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          setPreview({ userId: pick.id, kind });
        }}
      />
    </AppShell>
  );
}

function formatLastSeen(ts?: string | null): string {
  if (!ts) return "online";
  const diff = Math.max(0, Date.now() - new Date(ts).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === "video") return <Video className="size-5 text-primary-foreground" />;
  if (kind === "game") return <Gamepad2 className="size-5 text-primary-foreground" />;
  if (kind === "live") return <Radio className="size-5 text-primary-foreground" />;
  return <Mic className="size-5 text-primary-foreground" />;
}

function OnlineList({
  users, loading, renderActions,
}: { users: any[]; loading: boolean; renderActions: (u: any) => React.ReactNode }) {
  if (loading) return <div className="text-center text-muted-foreground py-8">Loading…</div>;
  if (!users.length) return <Card className="glass p-8 text-center text-muted-foreground">No one is online right now. Check back soon.</Card>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {users.map((u) => (
        <Card key={u.id} className="glass p-4 flex items-center gap-3">
          <div className="relative">
            <Avatar className="size-12">
              {u.avatar_url && <AvatarImage src={u.avatar_url} />}
              <AvatarFallback className="brand-gradient text-primary-foreground font-semibold">
                {(u.username ?? "?").slice(0,2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-emerald-500 border-2 border-background" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium truncate">{u.username ?? "anon"}</p>
              {u.is_creator && <Badge variant="secondary" className="text-xs">Creator</Badge>}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto shrink-0" title={u.last_seen_at ?? ""}>
                <span className="size-1.5 rounded-full bg-emerald-500 mr-1 inline-block" />
                {formatLastSeen(u.last_seen_at)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {[u.gender, u.country, u.language].filter(Boolean).join(" · ") || "Online now"}
            </p>
          </div>
          {renderActions(u)}
        </Card>
      ))}
    </div>
  );
}
