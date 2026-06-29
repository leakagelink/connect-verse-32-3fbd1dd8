import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { heartbeat, listOnlineCreators } from "@/lib/presence.functions";
import { getAppSettings } from "@/lib/settings.functions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Phone,
  Video,
  Coins,
  Sparkles,
  Languages,
  MapPin,
  Zap,
  Star,
  Filter,
  RotateCcw,
} from "lucide-react";
import {
  VOICE_CALL_COINS_PER_MINUTE,
  VIDEO_CALL_COINS_PER_MINUTE,
  APP_LANGUAGES,
} from "@/lib/constants";
import { COUNTRIES, STATES_BY_COUNTRY } from "@/lib/locations";
import { requestCallPermissions } from "@/lib/native";
import { CallInviteDialog } from "@/components/call-invite-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/connect")({
  component: ConnectScreen,
});

type Creator = {
  id: string;
  username: string | null;
  gender: string | null;
  country: string | null;
  state: string | null;
  language: string | null;
  avatar_url: string | null;
  is_creator: boolean;
  last_seen_at: string | null;
};

function ConnectScreen() {
  const navigate = useNavigate();
  const beat = useServerFn(heartbeat);
  const creatorsFn = useServerFn(listOnlineCreators);
  const settingsFn = useServerFn(getAppSettings);
  const { data } = useQuery({
    queryKey: ["online-creators"],
    queryFn: () => creatorsFn(),
    refetchInterval: 15_000,
  });
  const { data: settings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => settingsFn(),
    staleTime: 60_000,
  });
  const filtersVisible = settings?.connect_filters_visible ?? true;

  const queryClient = useQueryClient();

  useEffect(() => {
    beat().catch(() => {});
    const i = setInterval(() => beat().catch(() => {}), 30_000);
    // On Android WebView, returning from background fires
    // visibilitychange but often not 'focus' — refresh both presence
    // and the creators list immediately so the user never sees a
    // stale empty Connect screen.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      beat().catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["online-creators"] });
    };
    const onOnline = () => {
      beat().catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["online-creators"] });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(i);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [beat, queryClient]);

  const all: Creator[] = (data && "creators" in data ? data.creators : []) as Creator[];
  const me = data && "me" in data ? data.me : { language: null, country: null, state: null };

  const [language, setLanguage] = useState<string>("auto");
  const [country, setCountry] = useState<string>("auto");
  const [state, setState] = useState<string>("any");
  const [activeOnly, setActiveOnly] = useState<boolean>(false);

  // Initialize defaults from my profile once data arrives
  useEffect(() => {
    if (!data) return;
    if (language === "auto" && me.language) setLanguage(me.language);
    if (country === "auto" && me.country) setCountry(me.country);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const stateOptions = useMemo(() => {
    if (country === "any" || country === "auto") return [];
    return STATES_BY_COUNTRY[country] ?? [];
  }, [country]);

  // Filter + priority sorting
  const sorted = useMemo(() => {
    // If admin has hidden the filter UI, ignore the filter state entirely.
    const langFilter = !filtersVisible || language === "any" ? null : language;
    const countryFilter = !filtersVisible || country === "any" ? null : country;
    const stateFilter = !filtersVisible || state === "any" ? null : state;
    const useActiveOnly = filtersVisible && activeOnly;
    const activeCutoff = Date.now() - 30_000; // last 30s = "active now"

    const filtered = all.filter((u) => {
      if (langFilter && u.language !== langFilter) return false;
      if (countryFilter && u.country !== countryFilter) return false;
      if (stateFilter && u.state !== stateFilter) return false;
      if (useActiveOnly) {
        const t = u.last_seen_at ? new Date(u.last_seen_at).getTime() : 0;
        if (t < activeCutoff) return false;
      }
      return true;
    });

    // priority score: language match (4) + state match (2) + country match (1)
    const score = (u: Creator) => {
      let s = 0;
      if (me.language && u.language === me.language) s += 4;
      if (me.state && u.state === me.state) s += 2;
      if (me.country && u.country === me.country) s += 1;
      return s;
    };
    // Mobile app users were getting an empty Connect screen when their saved
    // profile country/language did not match available creators. Keep filters
    // as priority, not a hard blocker: if strict filtering returns nothing,
    // show all online creators so calls can still start.
    const visibleCreators = filtered.length ? filtered : all;

    return [...visibleCreators].sort((a, b) => {
      const d = score(b) - score(a);
      if (d !== 0) return d;
      // tiebreak: more recently seen first
      return (b.last_seen_at ?? "").localeCompare(a.last_seen_at ?? "");
    });
  }, [all, me, language, country, state, activeOnly, filtersVisible]);

  // Pre-call permission dialog removed — permissions are requested silently in startCall.
  const [callInvite, setCallInvite] = useState<{ kind: "voice" | "video"; userId: string } | null>(null);

  async function startCall(kind: "voice" | "video", userId: string) {
    // Silently request mic/camera permissions and jump straight to the call
    // screen — no pre-call audio/video check UI.
    try { await requestCallPermissions(kind); } catch { /* ignore; call screen will surface errors */ }
    setCallInvite({ kind, userId });
  }

  function autoConnect(kind: "voice" | "video") {
    if (!sorted.length) {
      toast.error("No creators match your filters right now.");
      return;
    }
    // pick from top 5 priority creators
    const pool = sorted.slice(0, Math.min(sorted.length, 5));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    startCall(kind, pick.id);
  }

  const hasFilters =
    (language !== "any" && language !== "auto") ||
    (country !== "any" && country !== "auto") ||
    state !== "any";

  return (
    <AppShell>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h1 className="text-2xl font-bold">Connect</h1>
        </div>
        <p className="text-sm text-muted-foreground">Talk live with our verified creators</p>
      </div>

      {/* Quick auto-match buttons */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <button
          onClick={() => autoConnect("voice")}
          className="group relative overflow-hidden rounded-2xl p-4 text-left border border-primary/30 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent hover:from-primary/30 transition"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="size-10 rounded-xl brand-gradient flex items-center justify-center">
              <Phone className="size-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold">Audio Call</p>
              <p className="text-[11px] text-muted-foreground">Auto-match instantly</p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-coin/20 px-2 py-0.5 text-[11px] font-semibold text-coin">
            <Coins className="size-3" /> {VOICE_CALL_COINS_PER_MINUTE} / min
          </div>
        </button>

        <button
          onClick={() => autoConnect("video")}
          className="group relative overflow-hidden rounded-2xl p-4 text-left border border-accent/40 bg-gradient-to-br from-accent/20 via-accent/10 to-transparent hover:from-accent/30 transition"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="size-10 rounded-xl brand-gradient flex items-center justify-center">
              <Video className="size-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold">Video Call</p>
              <p className="text-[11px] text-muted-foreground">Auto-match instantly</p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-coin/20 px-2 py-0.5 text-[11px] font-semibold text-coin">
            <Coins className="size-3" /> {VIDEO_CALL_COINS_PER_MINUTE} / min
          </div>
        </button>
      </div>

      {/* Filters (admin-controlled visibility) */}
      {filtersVisible && (
      <Card className="glass p-3 mb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Filter className="size-4 text-primary" />
            <h2 className="font-semibold text-sm">Filter creators</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!hasFilters}
            onClick={() => {
              setLanguage("any");
              setCountry("any");
              setState("any");
            }}
            className="h-7 px-2 text-[11px] text-primary hover:text-primary"
          >
            <RotateCcw className="size-3 mr-1" />
            Clear / Reset
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Language" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any language</SelectItem>
              {APP_LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={country}
            onValueChange={(v) => {
              setCountry(v);
              setState("any");
            }}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any country</SelectItem>
              {COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={state}
            onValueChange={setState}
            disabled={!stateOptions.length}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder={stateOptions.length ? "State" : "—"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any state</SelectItem>
              {stateOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setActiveOnly((v) => !v)}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition border " +
              (activeOnly
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                : "bg-muted/40 border-border text-muted-foreground hover:text-foreground")
            }
          >
            <span
              className={
                "size-1.5 rounded-full " +
                (activeOnly ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground")
              }
            />
            Active now only
          </button>
          <p className="text-[10px] text-muted-foreground text-right">
            Matching language & region prioritised.
          </p>
        </div>
      </Card>
      )}


      {/* Sliding featured creators */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Zap className="size-4 text-primary" />
            <h2 className="font-semibold">Featured Live</h2>
          </div>
          <span className="text-xs text-muted-foreground">{sorted.length} online</span>
        </div>
        <CreatorMarquee creators={sorted.slice(0, 12)} onStartCall={startCall} />
      </div>

      {/* All online creators grid */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">All online creators</h2>
      </div>
      {!sorted.length ? (
        <Card className="glass p-8 text-center text-muted-foreground">
          No creators match your filters. Try widening your search.
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sorted.map((u) => {
            const priority =
              (me.language && u.language === me.language) ||
              (me.country && u.country === me.country);
            return (
              <Card
                key={u.id}
                className={
                  "glass p-3 flex items-center gap-3 " +
                  (priority ? "ring-1 ring-primary/40" : "")
                }
              >
                <div className="relative">
                  <Avatar className="size-12">
                    {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                    <AvatarFallback className="brand-gradient text-primary-foreground font-semibold">
                      {(u.username ?? "?").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-emerald-500 border-2 border-background" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium truncate">{u.username ?? "anon"}</p>
                    <Badge variant="secondary" className="text-[10px]">
                      Creator
                    </Badge>
                    {priority && (
                      <Star className="size-3 text-primary fill-primary shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-2 truncate">
                    {u.language && (
                      <span className="inline-flex items-center gap-0.5">
                        <Languages className="size-3" />
                        {u.language}
                      </span>
                    )}
                    {u.country && (
                      <span className="inline-flex items-center gap-0.5">
                        <MapPin className="size-3" />
                        {u.state ? `${u.state}, ${u.country}` : u.country}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button size="sm" variant="secondary" className="h-7 px-2" onClick={() => void startCall("voice", u.id)}>
                    <Phone className="size-3.5" />
                  </Button>
                  <Button size="sm" className="h-7 px-2 brand-gradient" onClick={() => void startCall("video", u.id)}>
                    <Video className="size-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CallInviteDialog pendingCall={callInvite} onClose={() => setCallInvite(null)} />
    </AppShell>
  );
}

function CreatorMarquee({
  creators,
  onStartCall,
}: {
  creators: Creator[];
  onStartCall: (kind: "voice" | "video", userId: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const items = useMemo(
    () => (creators.length ? [...creators, ...creators] : []),
    [creators],
  );
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!creators.length) return;
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    let last = performance.now();
    const speed = 28; // px / sec
    const step = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      if (!paused) {
        el.scrollLeft += speed * dt;
        const half = el.scrollWidth / 2;
        if (el.scrollLeft >= half) el.scrollLeft -= half;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [creators.length, paused]);

  if (!creators.length) {
    return (
      <Card className="glass p-6 text-center text-sm text-muted-foreground">
        Featured creators will appear here as soon as they come online.
      </Card>
    );
  }

  return (
    <div
      ref={trackRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      className="flex gap-3 overflow-x-hidden scrollbar-none"
      style={{ scrollBehavior: "auto" }}
    >
      {items.map((u, idx) => (
        <button
          type="button"
          key={`${u.id}-${idx}`}
          className="shrink-0 w-[140px]"
          onClick={() => void onStartCall("video", u.id)}
        >
          <Card className="glass p-3 text-center hover:border-primary/40 transition">
            <div className="relative mx-auto w-fit">
              <Avatar className="size-16 mx-auto ring-2 ring-primary/40">
                {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                <AvatarFallback className="brand-gradient text-primary-foreground font-semibold">
                  {(u.username ?? "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="absolute bottom-0 right-1 size-3 rounded-full bg-emerald-500 border-2 border-background" />
            </div>
            <p className="mt-2 text-sm font-medium truncate">{u.username ?? "anon"}</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {u.language ?? "—"}
            </p>
            <div className="mt-1.5 inline-flex items-center gap-0.5 rounded-full bg-coin/15 px-1.5 py-0.5 text-[10px] font-semibold text-coin">
              <Coins className="size-2.5" /> {VIDEO_CALL_COINS_PER_MINUTE}/m
            </div>
          </Card>
        </button>
      ))}
    </div>
  );
}
