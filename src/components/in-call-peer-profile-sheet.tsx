import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getPartnerProfile,
  sendFollowRequest,
  unfollowUser,
} from "@/lib/follows.functions";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BadgeCheck,
  UserPlus,
  UserCheck,
  Clock,
  ArrowLeft,
  Loader2,
} from "lucide-react";

type Props = {
  userId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

/**
 * In-call peer profile sheet.
 *
 * Opens *inside* the call screen so the WebRTC session keeps running while
 * the user inspects the peer's profile, follows them, or sends a friend
 * (follow) request, then returns to the live call view without ever
 * navigating away from the route.
 */
export function InCallPeerProfileSheet({ userId, open, onOpenChange }: Props) {
  const fetchProfile = useServerFn(getPartnerProfile);
  const follow = useServerFn(sendFollowRequest);
  const unfollow = useServerFn(unfollowUser);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["in-call-peer", userId],
    queryFn: () => fetchProfile({ data: { userId: userId! } }),
    enabled: !!userId && open,
    staleTime: 15_000,
  });

  const followMut = useMutation({
    mutationFn: () => follow({ data: { userId: userId! } }),
    onSuccess: () => {
      toast.success("Friend request sent");
      qc.invalidateQueries({ queryKey: ["in-call-peer", userId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not send request"),
  });

  const unfollowMut = useMutation({
    mutationFn: () => unfollow({ data: { userId: userId! } }),
    onSuccess: () => {
      toast.success("Unfollowed");
      qc.invalidateQueries({ queryKey: ["in-call-peer", userId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not unfollow"),
  });

  const p = data?.profile;
  const outgoing = data?.outgoing ?? null; // null | 'pending' | 'accepted'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Profile</SheetTitle>
          <SheetDescription>
            Apka call abhi bhi chal raha hai. Wapis call screen pe jaane ke
            liye “Back to call” dabayein.
          </SheetDescription>
        </SheetHeader>

        {isLoading || !p ? (
          <div className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading profile…
          </div>
        ) : (
          <div className="py-4 space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-16">
                {p.avatar_url && <AvatarImage src={p.avatar_url} />}
                <AvatarFallback className="brand-gradient text-primary-foreground font-semibold">
                  {(p.username ?? "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold truncate">
                    {p.username ?? "anon"}
                  </p>
                  {p.is_creator && (
                    <BadgeCheck className="size-4 text-primary" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {[p.gender, p.state, p.country].filter(Boolean).join(" · ") ||
                    "Profile"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground">
                    {data!.followers}
                  </span>{" "}
                  followers ·{" "}
                  <span className="font-medium text-foreground">
                    {data!.following}
                  </span>{" "}
                  following
                </p>
              </div>
            </div>

            {p.bio && (
              <p className="text-sm text-muted-foreground border-l-2 border-primary/40 pl-3">
                {p.bio}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {p.is_creator && (
                <Badge variant="secondary" className="gap-1">
                  <BadgeCheck className="size-3" /> Verified creator
                </Badge>
              )}
              {data?.incoming === "accepted" && (
                <Badge variant="secondary">Follows you</Badge>
              )}
            </div>

            <div className="flex gap-2">
              {outgoing === "accepted" ? (
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => unfollowMut.mutate()}
                  disabled={unfollowMut.isPending}
                >
                  <UserCheck className="size-4 mr-2" /> Following
                </Button>
              ) : outgoing === "pending" ? (
                <Button variant="secondary" className="flex-1" disabled>
                  <Clock className="size-4 mr-2" /> Request sent
                </Button>
              ) : (
                <Button
                  className="flex-1"
                  onClick={() => followMut.mutate()}
                  disabled={followMut.isPending}
                >
                  <UserPlus className="size-4 mr-2" />
                  {followMut.isPending ? "Sending…" : "Send friend request"}
                </Button>
              )}
            </div>
          </div>
        )}

        <SheetFooter>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            <ArrowLeft className="size-4 mr-2" /> Back to call
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
