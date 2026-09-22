import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { getTrendingNow } from "@/lib/discovery.functions";
import { Flame, Sparkles } from "lucide-react";

/**
 * Neutral discovery: shows recently joined members only.
 * Gift-based ("Top Gifted") and matchmaking ("Hottest Room") cards are not part
 * of this release — gifts and matchmaking are disabled server-side.
 */
export function TrendingNowSection() {
  const fn = useServerFn(getTrendingNow);
  const { data } = useQuery({
    queryKey: ["trending-now"],
    queryFn: () => fn(),
    refetchInterval: 3 * 60_000,
    staleTime: 2 * 60_000,
  });

  const newJoinersLastHour = data?.newJoinersLastHour ?? 0;
  if (!newJoinersLastHour) return null;

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <Flame className="size-4 text-orange-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">Trending Now</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Link to="/new-joiners">
          <Card className="glass p-3 flex items-center gap-3 border-emerald-500/30 hover:border-emerald-500 transition h-full">
            <div className="size-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <Sparkles className="size-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">
                Joined This Hour
              </div>
              <p className="text-sm font-semibold">{newJoinersLastHour} new users</p>
              <p className="text-[11px] text-muted-foreground">Tap to say hi →</p>
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}
