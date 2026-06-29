import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Phone, Video } from "lucide-react";
import { listForYouCreators } from "@/lib/discovery.functions";
import { useAvatarPrefetch } from "@/lib/avatar-prefetch";
import { useFollowStatusMap } from "@/lib/use-follow-status";
import { FollowStatusPill } from "@/components/follow-status-pill";

export function ForYouSection({
  onCall,
}: {
  onCall: (uid: string, kind: "voice" | "video") => void;
}) {
  const fn = useServerFn(listForYouCreators);
  const { data } = useQuery({
    queryKey: ["for-you"],
    queryFn: () => fn(),
    refetchInterval: 3 * 60_000,
    staleTime: 2 * 60_000,
  });

  const list = (data ?? []).slice(0, 6);
  useAvatarPrefetch(list.map((u: any) => u.avatar_url));

  if (!data?.length) return null;

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="size-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">For You</h2>
        <Badge variant="secondary" className="text-[10px]">Personalized</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((u: any) => (
          <Card key={u.id} className="glass p-3 flex items-center gap-3">
            <div className="relative">
              <Avatar className="size-11">
                {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                <AvatarFallback className="brand-gradient text-primary-foreground text-xs">
                  {(u.username ?? "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {u.online && (
                <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-emerald-500 border-2 border-background" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">@{u.username ?? "anon"}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {[u.country, u.language].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex gap-1">
              <Button size="icon" variant="secondary" className="size-8" onClick={() => onCall(u.id, "voice")}>
                <Phone className="size-3.5" />
              </Button>
              <Button size="icon" className="size-8 brand-gradient" onClick={() => onCall(u.id, "video")}>
                <Video className="size-3.5" />
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
