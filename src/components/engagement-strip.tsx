import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { getCheckinStatus, claimDailyCheckin, STREAK_REWARDS } from "@/lib/engagement.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Flame, Trophy, UserPlus, Coins, Check } from "lucide-react";
import { toast } from "sonner";
import { COIN_REWARDS_ENABLED } from "@/lib/feature-flags";

export function EngagementStrip() {
  // Daily check-in pays coin rewards, so it is hidden in the free release.
  if (!COIN_REWARDS_ENABLED) return null;
  return <EngagementStripInner />;
}

function EngagementStripInner() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getCheckinStatus);
  const claimFn = useServerFn(claimDailyCheckin);

  const { data } = useQuery({
    queryKey: ["checkin-status"],
    queryFn: () => statusFn(),
    staleTime: 60_000,
  });

  const claim = useMutation({
    mutationFn: () => claimFn(),
    onSuccess: (r: any) => {
      toast.success(`+${r.reward} coins! Day ${r.dayIndex} · ${r.streakDays}-day streak 🔥`);
      qc.invalidateQueries({ queryKey: ["checkin-status"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Could not claim"),
  });

  const streak = data?.streakDays ?? 0;
  const nextDay = data?.nextDayIndex ?? 1;
  const nextReward = data?.nextReward ?? STREAK_REWARDS[0];
  const claimed = data?.claimedToday;

  return (
    <div className="mb-4 space-y-3">
      {/* Daily check-in card */}
      <Card className="glass p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="size-10 rounded-xl bg-coin/15 flex items-center justify-center">
            <Flame className={`size-5 ${streak > 0 ? "text-coin" : "text-muted-foreground"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">
              Daily check-in {streak > 0 && <span className="text-coin">· {streak}-day streak</span>}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {claimed ? "Come back tomorrow for more coins." : `Claim ${nextReward} coins today!`}
            </p>
          </div>
          <Button
            size="sm"
            disabled={claimed || claim.isPending}
            className={claimed ? "" : "brand-gradient"}
            onClick={() => claim.mutate()}
          >
            {claimed ? <><Check className="size-4 mr-1" /> Done</> : <><Coins className="size-4 mr-1" />Claim</>}
          </Button>
        </div>
        {/* 7-day reward strip */}
        <div className="grid grid-cols-7 gap-1.5">
          {STREAK_REWARDS.map((reward, i) => {
            const day = i + 1;
            const isPast = day < nextDay || (claimed && day <= nextDay);
            const isToday = !claimed && day === nextDay;
            return (
              <div
                key={day}
                className={[
                  "rounded-md text-center py-1.5 text-[10px] border",
                  isPast
                    ? "bg-coin/15 border-coin/40 text-coin"
                    : isToday
                      ? "bg-primary/10 border-primary/50 text-primary font-semibold"
                      : "bg-muted/30 border-border/60 text-muted-foreground",
                ].join(" ")}
              >
                <div className="leading-none">D{day}</div>
                <div className="font-bold leading-tight mt-0.5">{reward}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-2">
        <Link to="/leaderboard">
          <Card className="glass p-3 flex items-center gap-2 hover:border-primary/40 transition">
            <div className="size-9 rounded-lg bg-coin/15 flex items-center justify-center">
              <Trophy className="size-4 text-coin" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Top Creators</p>
              <p className="text-[10px] text-muted-foreground">Weekly leaderboard</p>
            </div>
          </Card>
        </Link>
        <Link to="/refer">
          <Card className="glass p-3 flex items-center gap-2 hover:border-primary/40 transition">
            <div className="size-9 rounded-lg bg-primary/15 flex items-center justify-center">
              <UserPlus className="size-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Refer & Earn</p>
              <p className="text-[10px] text-muted-foreground">+50 coins per friend</p>
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}
