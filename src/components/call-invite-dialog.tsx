import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Phone, PhoneOff, Video } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { cancelCallInvite, createCallInvite, getCallInviteStatus } from "@/lib/call-invites.functions";

type PendingCall = { kind: "voice" | "video"; userId: string } | null;

type InviteStatus = {
  id: string;
  kind: "voice" | "video";
  status: "pending" | "accepted" | "rejected" | "missed" | "cancelled" | "expired";
  callerId: string;
  calleeId: string;
  expiresAt: string;
};

export function CallInviteDialog({
  pendingCall,
  onClose,
}: {
  pendingCall: PendingCall;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const createInviteFn = useServerFn(createCallInvite);
  const statusFn = useServerFn(getCallInviteStatus);
  const cancelFn = useServerFn(cancelCallInvite);
  const [invite, setInvite] = useState<InviteStatus | null>(null);
  const [message, setMessage] = useState("Sending call request…");

  const createMut = useMutation({
    mutationFn: (p: NonNullable<PendingCall>) => createInviteFn({ data: { calleeId: p.userId, kind: p.kind } }),
    onSuccess: (res) => {
      setInvite(res as InviteStatus);
      setMessage("Ringing… waiting for creator to answer");
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Could not send call request");
      onClose();
    },
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { inviteId: id } }),
    onSettled: () => onClose(),
  });

  useEffect(() => {
    setInvite(null);
    setMessage("Sending call request…");
    if (pendingCall) createMut.mutate(pendingCall);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCall?.kind, pendingCall?.userId]);

  useEffect(() => {
    if (!invite?.id || invite.status !== "pending") return;
    let done = false;
    const normalizeStatus = (raw: any): InviteStatus => ({
      id: raw.id,
      kind: raw.kind,
      status: raw.status,
      callerId: raw.callerId ?? raw.caller_id,
      calleeId: raw.calleeId ?? raw.callee_id,
      expiresAt: raw.expiresAt ?? raw.expires_at,
    });
    const applyStatus = (next: InviteStatus) => {
      if (done) return;
      setInvite(next);
      if (next.status === "accepted") {
        done = true;
        toast.success("Creator answered — connecting call");
        onClose();
        navigate({
          to: "/call/$kind/$userId",
          params: { kind: next.kind, userId: next.calleeId },
          search: { inviteId: next.id },
        });
      } else if (next.status === "rejected") {
        done = true;
        toast.info("Creator declined the call.");
        onClose();
      } else if (next.status === "cancelled" || next.status === "expired" || next.status === "missed") {
        done = true;
        toast.info("Call was not answered. Try another creator.");
        onClose();
      }
    };

    const channel = supabase
      .channel(`outgoing-call-invite-${invite.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "call_invites", filter: `id=eq.${invite.id}` },
        (payload) => applyStatus(normalizeStatus(payload.new)),
      )
      .subscribe();

    const poll = setInterval(async () => {
      try {
        const res = await statusFn({ data: { inviteId: invite.id } });
        applyStatus(normalizeStatus(res));
      } catch { /* keep ringing UI */ }
    }, 2000);

    return () => {
      done = true;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [invite?.id, invite?.status, navigate, onClose, statusFn]);

  const secondsLeft = useMemo(() => {
    if (!invite?.expiresAt) return 45;
    return Math.max(0, Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / 1000));
  }, [invite?.expiresAt, message]);

  if (!pendingCall) return null;
  const kind = pendingCall.kind;
  const Icon = kind === "video" ? Video : Phone;

  return (
    <Dialog open={!!pendingCall} onOpenChange={(open) => {
      if (!open) {
        if (invite?.id && invite.status === "pending") cancelMut.mutate(invite.id);
        else onClose();
      }
    }}>
      <DialogContent className="max-w-sm text-center">
        <DialogHeader className="items-center text-center">
          <div className="relative mb-2 flex size-20 items-center justify-center rounded-full bg-primary/15">
            <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
            <Icon className="relative size-9 text-primary" />
          </div>
          <DialogTitle>{kind === "video" ? "Video call request sent" : "Audio call request sent"}</DialogTitle>
          <DialogDescription>
            {message}. Call will connect only after the creator accepts.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-center gap-2 font-medium">
            {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />}
            {createMut.isPending ? "Sending…" : `Ringing${secondsLeft ? ` · ${secondsLeft}s` : ""}`}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Please wait. “Connected” will show only after answer.</p>
        </div>
        <Button
          variant="destructive"
          className="w-full gap-2"
          disabled={cancelMut.isPending}
          onClick={() => {
            if (invite?.id && invite.status === "pending") cancelMut.mutate(invite.id);
            else onClose();
          }}
        >
          <PhoneOff className="size-4" /> Cancel call
        </Button>
      </DialogContent>
    </Dialog>
  );
}