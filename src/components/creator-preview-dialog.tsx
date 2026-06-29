import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getPartnerProfile } from "@/lib/follows.functions";
import { checkUserOnline } from "@/lib/presence.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, BadgeCheck, Camera, Sparkles, Phone, Video, Lock, AlertTriangle, Loader2, RefreshCw, Radio, Trophy, Crown } from "lucide-react";
import { getFanClubFor, joinFanClub } from "@/lib/creator.functions";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { requestCallPermissions } from "@/lib/native";


type Props = {
  userId: string | null;
  kind: "voice" | "video";
  onOpenChange: (v: boolean) => void;
  onConfirm: (userId: string) => void;
  onFindAnother?: () => void;
};

function formatAgo(ts: number | null) {
  if (!ts) return "just now";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}

export function CreatorPreviewDialog({ userId, kind, onOpenChange, onConfirm, onFindAnother }: Props) {
  const fetchProfile = useServerFn(getPartnerProfile);
  const checkOnline = useServerFn(checkUserOnline);
  const getClub = useServerFn(getFanClubFor);
  const joinClub = useServerFn(joinFanClub);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["partner-preview", userId],
    queryFn: () => fetchProfile({ data: { userId: userId! } }),
    enabled: !!userId,
    staleTime: 30_000,
  });
  const fanClubQuery = useQuery({
    queryKey: ["partner-fan-club", userId],
    queryFn: () => getClub({ data: { creatorId: userId! } }),
    enabled: !!userId,
    staleTime: 60_000,
  });
  const joinMut = useMutation({
    mutationFn: () => joinClub({ data: { creatorId: userId! } }),
    onSuccess: (r: any) => {
      toast.success(`Joined! Active until ${new Date(r.expires_at).toLocaleDateString()}`);
      qc.invalidateQueries({ queryKey: ["partner-fan-club", userId] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (e: any) => toast.error(e.message),
  });


  const [checking, setChecking] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const prevOnlineRef = useRef<boolean | null>(null);

  // Live availability polling while dialog is open
  const presenceQuery = useQuery({
    queryKey: ["partner-presence", userId],
    queryFn: () => checkOnline({ data: { userId: userId! } }),
    enabled: !!userId,
    refetchInterval: 4000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (!userId || !presenceQuery.data) return;
    const isOnline = presenceQuery.data.online;
    setLastUpdated(Date.now());
    if (isOnline) setOffline(false);
    else setOffline(true);

    const prev = prevOnlineRef.current;
    if (prev !== null && prev !== isOnline) {
      if (isOnline) {
        toast.success("Creator is back online", { description: "You can start the call now." });
      } else {
        toast.warning("Creator just went offline", { description: "Pick another available creator." });
      }
    }
    prevOnlineRef.current = isOnline;
  }, [presenceQuery.data, userId]);

  useEffect(() => {
    // reset on creator change
    setOffline(false);
    setLastUpdated(null);
    prevOnlineRef.current = null;
  }, [userId]);

  // tick every 10s so "x ago" stays fresh
  useEffect(() => {
    if (!userId) return;
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, [userId]);

  const p = data?.profile;
  const liveOnline = presenceQuery.data?.online ?? null;
  const onlineRecent =
    !offline && (liveOnline === true ||
      (liveOnline === null && !!p?.last_seen_at && Date.now() - new Date(p.last_seen_at).getTime() < 90_000));

  async function handleConfirm() {
    if (!p) return;
    setChecking(true);
    try {
      const res = await checkOnline({ data: { userId: p.id } });
      if (!res.online) {
        setOffline(true);
        return;
      }
      // Silently request permissions and go straight to the call screen.
      try { await requestCallPermissions(kind); } catch { /* ignore */ }
      onConfirm(p.id);
    } catch {
      setOffline(true);
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
    <Dialog open={!!userId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Creator preview</DialogTitle>
        </DialogHeader>

        {isLoading || !p ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Avatar className="size-14">
                  {p.avatar_url && <AvatarImage src={p.avatar_url} />}
                  <AvatarFallback className="brand-gradient text-primary-foreground font-semibold">
                    {(p.username ?? "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {onlineRecent && (
                  <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-emerald-500 border-2 border-background" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold truncate">{p.username ?? "anon"}</p>
                  {p.is_creator && <BadgeCheck className="size-4 text-primary" />}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {[p.gender, p.state, p.country].filter(Boolean).join(" · ") || "Profile"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground">{data!.followers}</span> followers ·{" "}
                  <span className="font-medium text-foreground">{data!.following}</span> following
                </p>
              </div>
            </div>

            {p.bio && (
              <p className="text-sm text-muted-foreground line-clamp-3 border-l-2 border-primary/40 pl-3">
                {p.bio}
              </p>
            )}

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Safety & verification</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="gap-1"><ShieldCheck className="size-3" />18+ Verified</Badge>
                {p.is_creator && (
                  <Badge variant="secondary" className="gap-1"><BadgeCheck className="size-3" />Verified Creator</Badge>
                )}
                {p.avatar_url && (
                  <Badge variant="secondary" className="gap-1"><Camera className="size-3" />Photo on file</Badge>
                )}
                {onlineRecent && (
                  <Badge variant="secondary" className="gap-1"><Sparkles className="size-3" />Active now</Badge>
                )}
                <Badge variant="secondary" className="gap-1"><Lock className="size-3" />Private &amp; metered</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                Calls are coin-metered. Sharing personal contact, abuse or harassment is strictly prohibited — report inside the call to ban instantly.
              </p>
            </div>

            {offline && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs flex items-start gap-2">
                <AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-amber-700 dark:text-amber-300">Creator just went offline</p>
                  <p className="text-muted-foreground mt-0.5">Pick another available creator to start your call.</p>
                </div>
              </div>
            )}

            <div
              className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors duration-300 ${
                onlineRecent
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-muted bg-muted/40 text-muted-foreground"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className="relative inline-flex size-2">
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      onlineRecent ? "bg-emerald-500 animate-ping" : "bg-muted-foreground/40"
                    }`}
                  />
                  <span
                    className={`relative inline-flex size-2 rounded-full ${
                      onlineRecent ? "bg-emerald-500" : "bg-muted-foreground/60"
                    }`}
                  />
                </span>
                {presenceQuery.isFetching
                  ? "Checking availability…"
                  : onlineRecent
                    ? "Available now · live"
                    : "Currently unavailable"}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-[10px] opacity-70">Updated {formatAgo(lastUpdated)}</span>
                <button
                  type="button"
                  onClick={() => presenceQuery.refetch()}
                  disabled={presenceQuery.isFetching}
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium hover:bg-background/60 disabled:opacity-50 transition-colors"
                  aria-label="Refresh status"
                >
                  <RefreshCw className={`size-3 ${presenceQuery.isFetching ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </span>
            </div>

            {fanClubQuery.data?.club?.is_open && (
              <div className="rounded-lg border border-coin/40 bg-coin/5 p-3 flex items-start gap-2">
                {fanClubQuery.data.active ? (
                  <Crown className="size-4 text-coin shrink-0 mt-0.5" />
                ) : (
                  <Trophy className="size-4 text-coin shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">
                    {fanClubQuery.data.club.name}
                    {fanClubQuery.data.active && (
                      <span className="ml-1 text-[10px] text-coin font-normal">· Member</span>
                    )}
                  </p>
                  {fanClubQuery.data.club.tagline && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {fanClubQuery.data.club.tagline}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={fanClubQuery.data.active ? "outline" : "default"}
                  className="h-7 text-[11px]"
                  disabled={joinMut.isPending}
                  onClick={() => joinMut.mutate()}
                >
                  {joinMut.isPending
                    ? "…"
                    : fanClubQuery.data.active
                      ? `Extend · ${fanClubQuery.data.club.monthly_coins}`
                      : `Join · ${fanClubQuery.data.club.monthly_coins}`}
                </Button>
              </div>
            )}


            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={checking}>Cancel</Button>
              {offline || liveOnline === false ? (
                <Button
                  className="brand-gradient"
                  onClick={() => { setOffline(false); onFindAnother?.(); }}
                  disabled={!onFindAnother}
                >
                  <RefreshCw className="size-4 mr-1" />Find another
                </Button>
              ) : (
                <Button className="brand-gradient" onClick={handleConfirm} disabled={checking || !onlineRecent}>
                  {checking ? (
                    <><Loader2 className="size-4 mr-1 animate-spin" />Checking…</>
                  ) : kind === "video" ? (
                    <><Video className="size-4 mr-1" />Start video call</>
                  ) : (
                    <><Phone className="size-4 mr-1" />Start voice call</>
                  )}
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
