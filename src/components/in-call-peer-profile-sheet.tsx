import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Send,
  Inbox,
  PhoneOff,
  PhoneMissed,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type ConfirmKind = null | "follow-request" | "unfollow";

export type LastCallContext = {
  status: "completed" | "missed" | "cancelled";
  /** call_logs.missed_reason — finer-grained reason when status !== completed. */
  missedReason?:
    | "no_answer"
    | "declined"
    | "cancelled"
    | "busy"
    | "expired"
    | null;
  kind: "voice" | "video";
};

type Props = {
  userId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** True only when this sheet is opened from inside the live call screen. */
  inCall?: boolean;
  /**
   * If the sheet is opened from a call-history surface (e.g. Recents),
   * pass the latest call row so the sheet can show a clear
   * "call available nahi" notice instead of the in-call banner.
   */
  lastCall?: LastCallContext | null;
};



/**
 * In-call peer profile sheet.
 *
 * Opens *inside* the call screen so the WebRTC session keeps running while
 * the user inspects the peer's profile, follows them, or sends a friend
 * (follow) request, then returns to the live call view without ever
 * navigating away from the route.
 */
export function InCallPeerProfileSheet({ userId, open, onOpenChange, inCall = false, lastCall = null }: Props) {
  const fetchProfile = useServerFn(getPartnerProfile);
  const follow = useServerFn(sendFollowRequest);
  const unfollow = useServerFn(unfollowUser);
  const qc = useQueryClient();
  const { user: me } = useSession();
  const [confirm, setConfirm] = useState<ConfirmKind>(null);

  // Single source of truth for "are we actually on the live call screen?".
  // The `inCall` prop is a hint from the caller, but we additionally verify
  // against the current route — the in-call banner/CTA must NEVER render
  // outside `/call/:kind/:userId` even if a caller forgets to pass the
  // prop correctly (recents, profile preview, deep links, etc.).
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const isOnCallRoute = /^\/call\//.test(currentPath);
  const showInCallChrome = inCall && isOnCallRoute;


  const { data, isLoading } = useQuery({
    queryKey: ["in-call-peer", userId],
    queryFn: () => fetchProfile({ data: { userId: userId! } }),
    enabled: !!userId && open,
    staleTime: 15_000,
  });

  // Realtime: refresh pills/buttons the moment the peer accepts, rejects,
  // or sends a request. Scoped to this user-pair so we don't react to
  // unrelated follow rows. RLS already restricts what we can see.
  useEffect(() => {
    if (!open || !userId || !me?.id) return;
    const myId = me.id;
    const peer = userId;
    const isRelevant = (row: any) =>
      row &&
      ((row.follower_id === myId && row.following_id === peer) ||
        (row.follower_id === peer && row.following_id === myId));
    const channel = supabase
      .channel(`in-call-peer-follows:${myId}:${peer}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "follows" },
        (payload) => {
          if (isRelevant(payload.new) || isRelevant(payload.old)) {
            qc.invalidateQueries({ queryKey: ["in-call-peer", peer] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, userId, me?.id, qc]);


  const followMut = useMutation({
    mutationFn: () => follow({ data: { userId: userId! } }),
    onSuccess: () => {
      toast.success("Friend request sent");
      qc.invalidateQueries({ queryKey: ["in-call-peer", userId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not send request"),
    onSettled: () => setConfirm(null),
  });

  const unfollowMut = useMutation({
    mutationFn: () => unfollow({ data: { userId: userId! } }),
    onSuccess: () => {
      toast.success("Unfollowed");
      qc.invalidateQueries({ queryKey: ["in-call-peer", userId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not unfollow"),
    onSettled: () => setConfirm(null),
  });

  const p = data?.profile;
  const outgoing = data?.outgoing ?? null; // null | 'pending' | 'accepted'
  const incoming = data?.incoming ?? null; // null | 'pending' | 'accepted'
  const requestPending = outgoing === "pending";
  const mutating = followMut.isPending || unfollowMut.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Profile</SheetTitle>
          {showInCallChrome ? (
            <SheetDescription>
              Apka call abhi bhi chal raha hai. Wapis call screen pe jaane ke
              liye “Back to call” dabayein.
            </SheetDescription>
          ) : null}
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

            <div className="flex flex-wrap gap-2" data-testid="in-call-status-pills">
              {p.is_creator && (
                <Badge variant="secondary" className="gap-1">
                  <BadgeCheck className="size-3" /> Verified creator
                </Badge>
              )}
              {outgoing === "pending" && (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
                  data-testid="pill-outgoing-pending"
                >
                  <Send className="size-3" /> Friend request sent
                </Badge>
              )}
              {outgoing === "accepted" && (
                <Badge variant="secondary" className="gap-1" data-testid="pill-outgoing-accepted">
                  <UserCheck className="size-3" /> You follow them
                </Badge>
              )}
              {incoming === "pending" && (
                <Badge
                  variant="outline"
                  className="gap-1 border-primary/40 text-primary"
                  data-testid="pill-incoming-pending"
                >
                  <Inbox className="size-3" /> Sent you a request
                </Badge>
              )}
              {incoming === "accepted" && (
                <Badge variant="secondary" data-testid="pill-incoming-accepted">
                  Follows you
                </Badge>
              )}
            </div>

            <div className="flex gap-2">
              {outgoing === "accepted" ? (
                <Button
                  data-testid="in-call-unfollow-btn"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setConfirm("unfollow")}
                  disabled={mutating || requestPending}
                >
                  <UserCheck className="size-4 mr-2" /> Following
                </Button>
              ) : outgoing === "pending" ? (
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled
                  data-testid="in-call-request-pending-btn"
                >
                  <Clock className="size-4 mr-2" /> Request pending
                </Button>
              ) : (
                <Button
                  data-testid="in-call-follow-btn"
                  className="flex-1"
                  onClick={() => setConfirm("follow-request")}
                  disabled={mutating || requestPending}
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
            <ArrowLeft className="size-4 mr-2" /> {showInCallChrome ? "Back to call" : "Close"}
          </Button>
        </SheetFooter>

        {/*
          Confirmation gate. The call's WebRTC tracks live in the parent call
          screen, not this sheet — opening / closing an AlertDialog here only
          mounts UI inside the same React tree, so audio/video keep flowing
          uninterrupted. We never navigate, never tear down the session, and
          the mutation only fires after an explicit confirm tap so a misclick
          on "Send friend request" or "Following" can't spam the peer.
        */}
        <AlertDialog
          open={confirm !== null}
          onOpenChange={(v) => {
            if (!v && !followMut.isPending && !unfollowMut.isPending) setConfirm(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirm === "unfollow"
                  ? `Unfollow ${p?.username ?? "this user"}?`
                  : `Send friend request to ${p?.username ?? "this user"}?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirm === "unfollow"
                  ? showInCallChrome
                    ? "Aap unhe unfollow kar denge. Call abhi bhi chalu rahegi."
                    : "Aap unhe unfollow kar denge."
                  : showInCallChrome
                    ? "Hum unhe ek friend request bhejenge. Call disturb nahi hogi."
                    : "Hum unhe ek friend request bhejenge."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                data-testid="in-call-confirm-cancel"
                disabled={followMut.isPending || unfollowMut.isPending}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                data-testid="in-call-confirm-action"
                disabled={followMut.isPending || unfollowMut.isPending}
                onClick={(e) => {
                  // Prevent the dialog from auto-closing before the mutation
                  // settles — onSettled clears the confirm state for us.
                  e.preventDefault();
                  if (confirm === "unfollow") unfollowMut.mutate();
                  else if (confirm === "follow-request") followMut.mutate();
                }}
              >
                {followMut.isPending || unfollowMut.isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {confirm === "unfollow" ? "Unfollowing…" : "Sending…"}
                  </span>
                ) : confirm === "unfollow" ? (
                  "Unfollow"
                ) : (
                  "Send request"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
