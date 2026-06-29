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
  deliveredAt: string | null;
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

  const [endState, setEndState] = useState<null | { tone: "busy" | "rejected" | "timeout" | "cancelled"; title: string; body: string }>(null);

  const createMut = useMutation({
    mutationFn: (p: NonNullable<PendingCall>) => createInviteFn({ data: { calleeId: p.userId, kind: p.kind } }),
    onSuccess: (res) => {
      setInvite(res as InviteStatus);
      setMessage("Ringing… waiting for creator to answer");
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: any) => {
      const msg = String(e?.message ?? "Could not send call request");
      if (msg.startsWith("BUSY:")) {
        setEndState({
          tone: "busy",
          title: "Creator is busy",
          body: "They're already on another call. Please try again in a moment.",
        });
      } else {
        toast.error(msg.replace(/^BUSY:\s*/, ""));
        onClose();
      }
    },
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { inviteId: id } }),
    onSettled: () => onClose(),
  });

  useEffect(() => {
    setInvite(null);
    setEndState(null);
    setMessage("Sending call request…");
    if (pendingCall) createMut.mutate(pendingCall);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCall?.kind, pendingCall?.userId]);

  useEffect(() => {
    if (!invite?.id || invite.status !== "pending") return;
    let done = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;

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
        setEndState({
          tone: "rejected",
          title: "Call declined",
          body: "The creator declined your call. Try someone else from Discover.",
        });
      } else if (next.status === "expired" || next.status === "missed") {
        done = true;
        setEndState({
          tone: "timeout",
          title: "No answer",
          body: "Creator didn't pick up in time. Try another creator who is online.",
        });
      } else if (next.status === "cancelled") {
        done = true;
        onClose();
      }
    };

    const checkOnce = async () => {
      try {
        const res = await statusFn({ data: { inviteId: invite.id } });
        applyStatus(normalizeStatus(res));
      } catch { /* ignore */ }
    };

    const connect = () => {
      channel = supabase
        .channel(`outgoing-call-invite-${invite.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "call_invites", filter: `id=eq.${invite.id}` },
          (payload) => applyStatus(normalizeStatus(payload.new)),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            // sync once after subscribe in case status changed before channel was ready
            checkOnce();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            if (channel) { try { supabase.removeChannel(channel); } catch {} channel = null; }
            if (!done) reconnectTimer = setTimeout(connect, 2000);
          }
        });
    };
    connect();

    // One-shot reconciliation at expiry so caller never gets stuck on "Ringing…"
    const ms = Math.max(1000, new Date(invite.expiresAt).getTime() - Date.now() + 1500);
    expiryTimer = setTimeout(checkOnce, ms);

    const onVisible = () => { if (document.visibilityState === "visible") checkOnce(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", checkOnce);

    return () => {
      done = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (expiryTimer) clearTimeout(expiryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", checkOnce);
      if (channel) supabase.removeChannel(channel);
    };
  }, [invite?.id, invite?.status, navigate, onClose, statusFn]);


  const secondsLeft = useMemo(() => {
    if (!invite?.expiresAt) return 45;
    return Math.max(0, Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / 1000));
  }, [invite?.expiresAt, message]);

  if (!pendingCall) return null;
  const kind = pendingCall.kind;
  const Icon = kind === "video" ? Video : Phone;
  const toneStyles: Record<string, string> = {
    busy: "bg-amber-500/15 text-amber-600",
    rejected: "bg-rose-500/15 text-rose-600",
    timeout: "bg-slate-500/15 text-slate-600",
    cancelled: "bg-slate-500/15 text-slate-600",
  };

  return (
    <Dialog open={!!pendingCall} onOpenChange={(open) => {
      if (!open) {
        if (invite?.id && invite.status === "pending") cancelMut.mutate(invite.id);
        else onClose();
      }
    }}>
      <DialogContent className="max-w-sm text-center">
        {endState ? (
          <>
            <DialogHeader className="items-center text-center">
              <div className={`mb-2 flex size-20 items-center justify-center rounded-full ${toneStyles[endState.tone]}`}>
                <PhoneOff className="size-9" />
              </div>
              <DialogTitle>{endState.title}</DialogTitle>
              <DialogDescription>{endState.body}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Button
                className="w-full gap-2"
                disabled={createMut.isPending}
                onClick={() => {
                  setInvite(null);
                  setEndState(null);
                  setMessage("Sending call request…");
                  if (pendingCall) createMut.mutate(pendingCall);
                }}
              >
                <Icon className="size-4" /> Try again
              </Button>
              <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
            </div>
          </>
        ) : (

          <>
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
              <p className="mt-1 text-xs text-muted-foreground">Auto-cancels in {secondsLeft}s if no answer.</p>
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
