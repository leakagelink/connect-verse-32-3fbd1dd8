import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Phone, PhoneOff, Video } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PrecallPermissionDialog } from "@/components/precall-permission-dialog";
import { supabase } from "@/integrations/supabase/client";
import { acceptCallInvite, listIncomingCallInvites, rejectCallInvite } from "@/lib/call-invites.functions";

type IncomingInvite = {
  id: string;
  kind: "voice" | "video";
  expiresAt: string;
  caller: {
    id: string;
    username: string | null;
    avatar_url: string | null;
    country?: string | null;
    state?: string | null;
    language?: string | null;
  };
};

export function IncomingCallDialog({ disabled }: { disabled?: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listIncomingCallInvites);
  const acceptFn = useServerFn(acceptCallInvite);
  const rejectFn = useServerFn(rejectCallInvite);
  const [permissionFor, setPermissionFor] = useState<IncomingInvite | null>(null);

  const { data } = useQuery({
    queryKey: ["incoming-call-invites"],
    queryFn: () => listFn(),
    enabled: !disabled,
    refetchInterval: disabled ? false : 2500,
    staleTime: 0,
  });

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`rt-call-invites-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "call_invites", filter: `callee_id=eq.${uid}` },
          () => qc.invalidateQueries({ queryKey: ["incoming-call-invites"] }),
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [disabled, qc]);

  const invite = useMemo(() => (data ?? [])[0] as IncomingInvite | undefined, [data]);

  const acceptMut = useMutation({
    mutationFn: (id: string) => acceptFn({ data: { inviteId: id } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["incoming-call-invites"] });
      navigate({
        to: "/call/$kind/$userId",
        params: { kind: res.kind, userId: res.callerId },
        search: { inviteId: res.id },
      });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not answer call"),
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectFn({ data: { inviteId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incoming-call-invites"] }),
  });

  if (disabled) return null;

  return (
    <>
      <Dialog
        open={!!invite && !permissionFor}
        onOpenChange={(open) => {
          if (!open && invite) rejectMut.mutate(invite.id);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {invite?.kind === "video" ? <Video className="size-5 text-primary" /> : <Phone className="size-5 text-primary" />}
              Incoming {invite?.kind === "video" ? "video" : "audio"} call
            </DialogTitle>
          </DialogHeader>
          {invite && (
            <div className="space-y-5 text-center">
              <div className="mx-auto relative size-24">
                <span className="absolute inset-0 rounded-full bg-primary/25 animate-ping" />
                <Avatar className="relative size-24 border-4 border-primary/30">
                  {invite.caller.avatar_url && <AvatarImage src={invite.caller.avatar_url} />}
                  <AvatarFallback className="brand-gradient text-primary-foreground text-xl font-bold">
                    {(invite.caller.username ?? "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div>
                <p className="text-lg font-bold">@{invite.caller.username ?? "creator"}</p>
                <p className="text-xs text-muted-foreground">
                  {[invite.caller.state, invite.caller.country, invite.caller.language].filter(Boolean).join(" · ") || "Talkora caller"}
                </p>
              </div>
              <div className="flex items-center justify-center gap-4">
                <Button
                  size="icon"
                  variant="destructive"
                  className="size-14 rounded-full"
                  disabled={rejectMut.isPending || acceptMut.isPending}
                  onClick={() => rejectMut.mutate(invite.id)}
                  aria-label="Reject call"
                >
                  <PhoneOff className="size-6" />
                </Button>
                <Button
                  size="icon"
                  className="size-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={acceptMut.isPending || rejectMut.isPending}
                  onClick={() => setPermissionFor(invite)}
                  aria-label="Answer call"
                >
                  {acceptMut.isPending ? <Loader2 className="size-6 animate-spin" /> : <Phone className="size-6" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Call connects only after you answer.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <PrecallPermissionDialog
        open={!!permissionFor}
        kind={permissionFor?.kind ?? "voice"}
        onCancel={() => setPermissionFor(null)}
        onReady={() => {
          const current = permissionFor;
          setPermissionFor(null);
          if (current) acceptMut.mutate(current.id);
        }}
      />
    </>
  );
}