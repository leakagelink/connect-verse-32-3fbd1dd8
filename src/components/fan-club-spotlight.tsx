import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Crown, Coins } from "lucide-react";
import { listFeaturedFanClubs } from "@/lib/discovery.functions";
import { joinFanClub } from "@/lib/creator.functions";
import { toast } from "sonner";
import { useState } from "react";
import { PAID_EXTRAS_ENABLED } from "@/lib/feature-flags";

export function FanClubSpotlight() {
  // Fan clubs are coin-priced memberships — hidden while coins are off.
  if (!PAID_EXTRAS_ENABLED) return null;
  return <FanClubSpotlightInner />;
}

function FanClubSpotlightInner() {
  const fn = useServerFn(listFeaturedFanClubs);
  const join = useServerFn(joinFanClub);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: clubs } = useQuery({
    queryKey: ["featured-fan-clubs"],
    queryFn: () => fn(),
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
  });

  if (!clubs?.length) return null;

  async function handleJoin(creatorId: string, cost: number) {
    if (!confirm(`Join this Fan Club for ${cost} coins / month?`)) return;
    setBusy(creatorId);
    try {
      await join({ data: { creatorId } });
      toast.success("Welcome to the Fan Club!");
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["featured-fan-clubs"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <Crown className="size-4 text-coin" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">Fan Club Spotlight</h2>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
        {clubs.map((c: any) => (
          <Card
            key={c.creator_id}
            className="glass shrink-0 w-[230px] p-3 snap-start border-coin/30 hover:border-coin transition"
          >
            <div className="flex items-center gap-2 mb-2">
              <Avatar className="size-10">
                {c.creator?.avatar_url && <AvatarImage src={c.creator.avatar_url} />}
                <AvatarFallback className="brand-gradient text-primary-foreground text-xs">
                  {(c.creator?.username ?? "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{c.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  @{c.creator?.username ?? "creator"}
                </p>
              </div>
            </div>
            {c.tagline && (
              <p className="text-[11px] text-muted-foreground mb-2 line-clamp-2">{c.tagline}</p>
            )}
            <div className="flex items-center justify-between mb-2">
              <Badge variant="secondary" className="text-[10px]">
                {c.member_count} members
              </Badge>
              <span className="text-[11px] font-bold text-coin flex items-center gap-0.5">
                <Coins className="size-3" />
                {c.monthly_coins}/mo
              </span>
            </div>
            <Button
              size="sm"
              className="w-full brand-gradient"
              disabled={busy === c.creator_id}
              onClick={() => handleJoin(c.creator_id, c.monthly_coins)}
            >
              {busy === c.creator_id ? "Joining…" : "Join"}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
