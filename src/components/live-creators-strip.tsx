import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Phone, Video, Coins, Sparkles } from "lucide-react";
import { VOICE_CALL_COINS_PER_MINUTE, VIDEO_CALL_COINS_PER_MINUTE } from "@/lib/constants";
import { useAvatarPrefetch } from "@/lib/avatar-prefetch";
import { useFollowStatusMap } from "@/lib/use-follow-status";
import { FollowStatusPill } from "@/components/follow-status-pill";

type Creator = {
  id: string;
  username?: string | null;
  gender?: string | null;
  country?: string | null;
  language?: string | null;
  avatar_url?: string | null;
  is_creator?: boolean | null;
};

export function LiveCreatorsStrip({
  users,
  loading,
  onCall,
}: {
  users: Creator[];
  loading: boolean;
  onCall: (userId: string, kind: "voice" | "video") => void;
}) {
  useAvatarPrefetch(users.map((u) => u.avatar_url));
  const { data: statusMap } = useFollowStatusMap(users.map((u) => u.id));
  if (loading) {
    return (
      <div className="flex gap-3 overflow-hidden pb-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="glass min-w-[180px] h-[230px] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!users.length) {
    return (
      <Card className="glass p-6 text-center text-sm text-muted-foreground">
        No creators live right now — check back soon.
      </Card>
    );
  }

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x snap-mandatory scrollbar-hide"
      style={{ scrollbarWidth: "none" }}
    >
      {users.slice(0, 20).map((u) => (
        <Card
          key={u.id}
          className="glass relative min-w-[180px] max-w-[180px] snap-start overflow-hidden border-primary/15 hover:border-primary/50 transition"
        >
          <div className="relative h-[120px] brand-gradient">
            <Avatar className="absolute inset-0 size-full rounded-none">
              {u.avatar_url && <AvatarImage src={u.avatar_url} className="object-cover" />}
              <AvatarFallback className="rounded-none bg-transparent text-primary-foreground text-3xl font-bold">
                {(u.username ?? "?").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/60 backdrop-blur px-2 py-0.5">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-semibold text-white tracking-wide">LIVE</span>
            </div>
            {u.is_creator && (
              <Badge className="absolute top-2 right-2 bg-coin/90 text-black border-0 text-[9px] gap-0.5">
                <Sparkles className="size-2.5" />
                Verified
              </Badge>
            )}
          </div>
          <div className="p-2.5">
            <p className="text-sm font-semibold truncate">{u.username ?? "anon"}</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {[u.country, u.language].filter(Boolean).join(" · ") || "Online"}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button
                onClick={() => onCall(u.id, "voice")}
                className="flex items-center justify-center gap-1 rounded-md bg-primary/15 hover:bg-primary/25 text-primary py-1.5 text-[10px] font-semibold transition"
              >
                <Phone className="size-3" />
                <Coins className="size-2.5" />
                {VOICE_CALL_COINS_PER_MINUTE}
              </button>
              <button
                onClick={() => onCall(u.id, "video")}
                className="flex items-center justify-center gap-1 rounded-md brand-gradient text-primary-foreground py-1.5 text-[10px] font-semibold"
              >
                <Video className="size-3" />
                <Coins className="size-2.5" />
                {VIDEO_CALL_COINS_PER_MINUTE}
              </button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
