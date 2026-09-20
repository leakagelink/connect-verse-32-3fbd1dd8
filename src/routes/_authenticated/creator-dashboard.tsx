import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyProfile } from "@/lib/onboarding.functions";
import {
  getMyEarnings,
  getMyAvailability,
  saveMyAvailability,
  getMyFanClub,
  saveMyFanClub,
} from "@/lib/creator.functions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Coins, Phone, Gift, Users, Trophy, Clock, Plus, X,
  Wallet, TrendingUp,

} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/creator-dashboard")({
  component: CreatorDashboard,
});

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtSeconds(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function CreatorDashboard() {
  const navigate = useNavigate();
  const getProfile = useServerFn(getMyProfile);
  const earningsFn = useServerFn(getMyEarnings);

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => getProfile(),
  });

  // Restrict to creators (female users in this app)
  useEffect(() => {
    if (!meLoading && me?.profile && me.profile.gender !== "female") {
      toast.info("Creator dashboard is for verified creators only.");
      navigate({ to: "/home", replace: true });
    }
  }, [me, meLoading, navigate]);

  const { data: earnings } = useQuery({
    queryKey: ["creator-earnings"],
    queryFn: () => earningsFn(),
    enabled: !!me?.profile && me.profile.gender === "female",
    refetchInterval: 60_000,
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/home" })} className="shrink-0">
            <ArrowLeft className="size-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold truncate">Creator Dashboard</h1>
            <p className="text-xs text-muted-foreground truncate">Track earnings, schedule and fans</p>
          </div>
        </div>


        {/* Quick stats — earnings figures only exist when monetization is on */}
        <div className={CREATOR_EARNINGS_ENABLED ? "grid grid-cols-2 gap-3 mb-4" : "hidden"}>
          <StatCard
            icon={<Wallet className="size-4 text-coin" />}
            label="Available coins"
            value={(earnings?.balance ?? 0).toLocaleString()}
            cta={
              <Link to="/withdraw" className="text-[11px] text-primary font-medium">
                Withdraw →
              </Link>
            }
          />
          <StatCard
            icon={<TrendingUp className="size-4 text-primary" />}
            label="Earned · 30d"
            value={(earnings?.summary.total_coins_30d ?? 0).toLocaleString()}
            sub={`${earnings?.summary.gift_count_30d ?? 0} gifts`}
          />
          <StatCard
            icon={<Phone className="size-4 text-primary" />}
            label="Call time · 30d"
            value={fmtSeconds(earnings?.summary.call_seconds_30d ?? 0)}
            sub={`${earnings?.summary.call_count_30d ?? 0} calls`}
          />
          <StatCard
            icon={<Users className="size-4 text-coin" />}
            label="Unique fans · 30d"
            value={(earnings?.summary.unique_senders_30d ?? 0).toLocaleString()}
            sub={`${earnings?.summary.fan_club_signups_30d ?? 0} fan-club joins`}
          />
        </div>

        {/* Sparkline */}
        <Card className={CREATOR_EARNINGS_ENABLED ? "glass p-4 mb-4" : "hidden"}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold">Gift coins · last 30 days</p>
            <Badge variant="secondary" className="text-[10px]">
              <Coins className="size-3 mr-1" />
              {earnings?.summary.gift_coins_30d ?? 0}
            </Badge>
          </div>
          <Sparkline daily={(earnings?.daily ?? []).filter((d) => d.day !== null) as Array<{ day: string; coins: number }>} />
        </Card>

        <Tabs defaultValue="schedule">
          <TabsList className="w-full">
            <TabsTrigger value="schedule" className="flex-1">
              <Clock className="size-4 mr-1" /> Schedule
            </TabsTrigger>
            <TabsTrigger value="fan-club" className="flex-1">
              <Trophy className="size-4 mr-1" /> Fan Club
            </TabsTrigger>
          </TabsList>
          <TabsContent value="schedule" className="mt-3">
            <ScheduleEditor />
          </TabsContent>
          <TabsContent value="fan-club" className="mt-3">
            <FanClubEditor />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function StatCard({
  icon, label, value, sub, cta,
}: { icon: React.ReactNode; label: string; value: string; sub?: string; cta?: React.ReactNode }) {
  return (
    <Card className="glass p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="size-7 rounded-lg bg-muted/40 flex items-center justify-center">{icon}</div>
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      {cta && <div className="mt-1">{cta}</div>}
    </Card>
  );
}

function Sparkline({ daily }: { daily: Array<{ day: string; coins: number }> }) {
  // Fill missing days
  const map = new Map(daily.map((d) => [d.day, d.coins]));
  const days: Array<{ day: string; coins: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ day: key, coins: Number(map.get(key) ?? 0) });
  }
  const max = Math.max(1, ...days.map((d) => d.coins));
  return (
    <div className="flex items-end gap-[2px] h-16">
      {days.map((d, i) => (
        <div
          key={i}
          title={`${d.day}: ${d.coins} coins`}
          className="flex-1 rounded-sm bg-gradient-to-t from-primary/30 to-coin/70"
          style={{ height: `${Math.max(4, (d.coins / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

// ============================================================
// SCHEDULE EDITOR
// ============================================================

type Slot = { dow: number; start: string; end: string };

function ScheduleEditor() {
  const qc = useQueryClient();
  const getFn = useServerFn(getMyAvailability);
  const saveFn = useServerFn(saveMyAvailability);

  const { data } = useQuery({
    queryKey: ["my-availability"],
    queryFn: () => getFn(),
  });

  const [accepting, setAccepting] = useState(true);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [tz, setTz] = useState("Asia/Kolkata");

  useEffect(() => {
    if (data) {
      setAccepting(!!data.accepting_calls);
      setSlots(Array.isArray(data.slots) ? (data.slots as Slot[]) : []);
      setTz(data.tz ?? "Asia/Kolkata");
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({ data: { accepting_calls: accepting, slots, tz } }),
    onSuccess: () => {
      toast.success("Schedule saved");
      qc.invalidateQueries({ queryKey: ["my-availability"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  function addSlot() {
    setSlots((s) => [...s, { dow: 1, start: "18:00", end: "22:00" }]);
  }
  function updateSlot(i: number, patch: Partial<Slot>) {
    setSlots((s) => s.map((sl, idx) => (idx === i ? { ...sl, ...patch } : sl)));
  }
  function removeSlot(i: number) {
    setSlots((s) => s.filter((_, idx) => idx !== i));
  }

  return (
    <Card className="glass p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">Accepting calls</p>
          <p className="text-[11px] text-muted-foreground">
            Turn off if you need a break. You won't be auto-matched.
          </p>
        </div>
        <Switch checked={accepting} onCheckedChange={setAccepting} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-sm">Weekly availability</Label>
          <Button size="sm" variant="outline" onClick={addSlot}>
            <Plus className="size-4 mr-1" /> Slot
          </Button>
        </div>
        {slots.length === 0 && (
          <p className="text-[11px] text-muted-foreground py-3 text-center">
            No slots yet. Add the hours you'd like to be discoverable.
          </p>
        )}
        <div className="space-y-2">
          {slots.map((s, i) => (
            <div key={i} className="flex items-center gap-2 bg-muted/30 rounded-lg p-2">
              <select
                value={s.dow}
                onChange={(e) => updateSlot(i, { dow: Number(e.target.value) })}
                className="bg-background border border-border rounded-md px-2 py-1 text-xs"
              >
                {DOW_LABELS.map((d, idx) => (
                  <option value={idx} key={idx}>{d}</option>
                ))}
              </select>
              <Input
                type="time"
                value={s.start}
                onChange={(e) => updateSlot(i, { start: e.target.value })}
                className="h-8 text-xs"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="time"
                value={s.end}
                onChange={(e) => updateSlot(i, { end: e.target.value })}
                className="h-8 text-xs"
              />
              <Button size="icon" variant="ghost" onClick={() => removeSlot(i)}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="tz" className="text-xs">Time zone</Label>
        <Input
          id="tz"
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="mt-1 h-9"
        />
      </div>

      <Button
        className="w-full brand-gradient"
        onClick={() => save.mutate()}
        disabled={save.isPending}
      >
        {save.isPending ? "Saving..." : "Save schedule"}
      </Button>
    </Card>
  );
}

// ============================================================
// FAN CLUB EDITOR
// ============================================================

function FanClubEditor() {
  const qc = useQueryClient();
  const getFn = useServerFn(getMyFanClub);
  const saveFn = useServerFn(saveMyFanClub);

  const { data } = useQuery({
    queryKey: ["my-fan-club"],
    queryFn: () => getFn(),
  });

  const [name, setName] = useState("Fan Club");
  const [tagline, setTagline] = useState("");
  const [perks, setPerks] = useState<string[]>([]);
  const [price, setPrice] = useState(500);
  const [isOpen, setIsOpen] = useState(true);
  const [newPerk, setNewPerk] = useState("");

  useEffect(() => {
    if (data?.club) {
      setName(data.club.name);
      setTagline(data.club.tagline ?? "");
      setPerks(Array.isArray(data.club.perks) ? (data.club.perks as string[]) : []);
      setPrice(Number(data.club.monthly_coins));
      setIsOpen(!!data.club.is_open);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          name,
          tagline: tagline || null,
          perks,
          monthly_coins: price,
          is_open: isOpen,
        },
      }),
    onSuccess: () => {
      toast.success("Fan club saved");
      qc.invalidateQueries({ queryKey: ["my-fan-club"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const activeMembers = useMemo(() => {
    const now = Date.now();
    return (data?.members ?? []).filter((m) => new Date(m.expires_at).getTime() > now);
  }, [data]);

  return (
    <div className="space-y-3">
      <Card className="glass p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-sm">Accepting new fans</p>
            <p className="text-[11px] text-muted-foreground">Turn off to pause sign-ups.</p>
          </div>
          <Switch checked={isOpen} onCheckedChange={setIsOpen} />
        </div>
        <div>
          <Label htmlFor="fc-name" className="text-xs">Club name</Label>
          <Input id="fc-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-9" maxLength={40} />
        </div>
        <div>
          <Label htmlFor="fc-tag" className="text-xs">Tagline</Label>
          <Input id="fc-tag" value={tagline} onChange={(e) => setTagline(e.target.value)} className="mt-1 h-9" maxLength={120} placeholder="Become my closest fan ✨" />
        </div>
        <div>
          <Label htmlFor="fc-price" className="text-xs">Monthly price (coins)</Label>
          <Input id="fc-price" type="number" min={50} max={50000} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="mt-1 h-9" />
          <p className="text-[10px] text-muted-foreground mt-1">Min 50 · 100% credited to your wallet on each join.</p>
        </div>
        <div>
          <Label className="text-xs">Perks</Label>
          <div className="flex gap-2 mt-1">
            <Input
              value={newPerk}
              onChange={(e) => setNewPerk(e.target.value)}
              placeholder="e.g. Priority calls"
              className="h-9 text-xs"
              maxLength={80}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (newPerk.trim() && perks.length < 8) {
                  setPerks([...perks, newPerk.trim()]);
                  setNewPerk("");
                }
              }}
            >
              Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {perks.map((p, i) => (
              <Badge key={i} variant="secondary" className="text-[11px]">
                {p}
                <button className="ml-1" onClick={() => setPerks(perks.filter((_, idx) => idx !== i))}>
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
        <Button className="w-full brand-gradient" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving..." : "Save fan club"}
        </Button>
      </Card>

      <Card className="glass p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">Members</p>
          <Badge variant="secondary" className="text-[10px]">{activeMembers.length} active</Badge>
        </div>
        {(!data?.members || data.members.length === 0) && (
          <p className="text-[11px] text-muted-foreground py-3 text-center">
            No fans yet. Share your profile to start growing your club.
          </p>
        )}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {data?.members?.map((m) => {
            const active = new Date(m.expires_at).getTime() > Date.now();
            return (
              <div key={m.fan_id} className="flex items-center gap-2 bg-muted/20 rounded-lg p-2">
                <Avatar className="size-7">
                  <AvatarImage src="" />
                  <AvatarFallback className="text-[10px]">{m.fan_id.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{m.fan_id.slice(0, 8)}…</p>
                  <p className="text-[10px] text-muted-foreground">
                    Joined {new Date(m.joined_at).toLocaleDateString()} · {m.coins_paid} coins
                  </p>
                </div>
                <Badge variant={active ? "default" : "secondary"} className="text-[9px]">
                  {active ? "Active" : "Expired"}
                </Badge>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
