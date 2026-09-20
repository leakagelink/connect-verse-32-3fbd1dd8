import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gift, ChevronRight } from "lucide-react";
import { COIN_PURCHASES_ENABLED } from "@/lib/feature-flags";

export function RechargeOfferCard({ depositCount }: { depositCount: number }) {
  // No purchases exist in the free release, so never advertise a bonus.
  if (!COIN_PURCHASES_ENABLED) return null;
  // Only show if user still has a bonus tier remaining (0, 1, or 2 deposits done)
  if (depositCount >= 3) return null;

  const tiers = [
    { n: 1, pct: 50, label: "First deposit" },
    { n: 2, pct: 40, label: "Second deposit" },
    { n: 3, pct: 30, label: "Third deposit" },
  ];
  const current = tiers[depositCount];

  return (
    <Link to="/recharge" className="block">
      <Card className="relative overflow-hidden p-4 border-primary/40 brand-gradient text-primary-foreground hover:opacity-95 transition">
        <div className="absolute -right-6 -top-6 size-24 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -left-4 -bottom-8 size-24 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <div className="size-11 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
            <Gift className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-bold text-base">{current.label} bonus</p>
              <Badge className="bg-white/25 text-primary-foreground border-0 text-[10px]">
                +{current.pct}% EXTRA
              </Badge>
            </div>
            <p className="text-xs opacity-90">
              Recharge now & grab <span className="font-semibold">+{current.pct}% bonus coins</span> — plans start at just ₹9
            </p>
          </div>
          <ChevronRight className="size-5 opacity-90" />
        </div>
      </Card>
    </Link>
  );
}
