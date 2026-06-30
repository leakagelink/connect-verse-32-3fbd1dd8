import { useEffect, useMemo, useRef, useState } from "react";
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
import { acceptCallInvite, listIncomingCallInvites, markCallInviteDelivered, rejectCallInvite } from "@/lib/call-invites.functions";
import { acceptInviteWithRetry, type AcceptRetryAttempt } from "@/lib/accept-call-retry";

type IncomingInvite = {
  id: string;
  kind: "voice" | "video";
  expiresAt: string;
  deliveredAt: string | null;
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
  const ackFn = useServerFn(markCallInviteDelivered);
  const [permissionFor, setPermissionFor] = useState<IncomingInvite | null>(null);
  const [retryInfo, setRetryInfo] = useState<AcceptRetryAttempt | null>(null);
  const ackedRef = useRef<Set<string>>(new Set());


  const { data } = useQuery({
    queryKey: ["incoming-call-invites"],
    queryFn: () => listFn(),
    enabled: !disabled,
    // Realtime-driven: no fast polling. Safety net only in case the socket drops.
    refetchInterval: disabled ? false : 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
  });

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => qc.invalidateQueries({ queryKey: ["incoming-call-invites"] });

    const connect = async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`rt-call-invites-${uid}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "call_invites", filter: `callee_id=eq.${uid}` },
          refresh,
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "call_invites", filter: `callee_id=eq.${uid}` },
          refresh,
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            refresh();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            // auto-reconnect realtime if it drops
            if (channel) { try { supabase.removeChannel(channel); } catch {} channel = null; }
            if (!cancelled) {
              reconnectTimer = setTimeout(connect, 2000);
            }
          }
        });
    };
    connect();

    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      if (channel) supabase.removeChannel(channel);
    };
  }, [disabled, qc]);


  // Send delivery acknowledgement so the caller instantly sees "Delivered ✓".
  useEffect(() => {
    const fresh = (data ?? []).filter((i: any) => !i.deliveredAt && !ackedRef.current.has(i.id));
    if (!fresh.length) return;
    for (const inv of fresh) {
      ackedRef.current.add(inv.id);
      ackFn({ data: { inviteId: inv.id } }).catch(() => {
        ackedRef.current.delete(inv.id);
      });
    }
  }, [data, ackFn]);

  // Ringtone + vibration when an invite arrives

  useEffect(() => {
    const first = (data ?? [])[0];
    if (!first) return;
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        (navigator as any).vibrate?.([400, 200, 400, 200, 400]);
      }
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const playBeep = (when: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        osc.connect(gain); gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + when);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + when + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + 0.5);
        osc.start(ctx.currentTime + when);
        osc.stop(ctx.currentTime + when + 0.55);
      };
      [0, 0.7, 1.4].forEach(playBeep);
      return () => { try { ctx.close(); } catch {} };
    } catch { /* ignore audio failures */ }
  }, [data?.[0]?.id]);


  const invite = useMemo(() => (data ?? [])[0] as IncomingInvite | undefined, [data]);

  const acceptMut = useMutation({
    mutationFn: (id: string) =>
      acceptInviteWithRetry(acceptFn, id, {
        onAttempt: (info) => setRetryInfo(info),
      }),
    onSettled: () => setRetryInfo(null),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["incoming-call-invites"] });
      navigate({
        to: "/call/$kind/$userId",
        params: { kind: res.kind, userId: res.callerId },
        search: { inviteId: res.id },
      });
    },
    onError: (e: any) => {
      const msg = String(e?.message ?? "");
      // Server signals that the accepting user (the payer) doesn't have
      // enough coins / free seconds for a minute of talk time. Offer to
      // open the recharge sheet instead of silently failing.
      if (msg.startsWith("RECHARGE_REQUIRED")) {
        const friendly = msg.replace(/^RECHARGE_REQUIRED:\s*/, "") ||
          "Bat karne ke liye coins lijiye.";
        toast.error(friendly, {
          duration: 8000,
          action: {
            label: "Recharge",
            onClick: () => navigate({ to: "/wallet" }),
          },
        });
        // Auto-reject the invite so the caller gets a clean signal.
        if (invite) rejectMut.mutate(invite.id);
        return;
      }
      toast.error(msg || "Could not answer call");
    },
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
              {acceptMut.isPending && retryInfo && retryInfo.attempt > 1 ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <span className="font-semibold">Reconnecting…</span>{" "}
                  Previous session ke ghost reservation ko clear kiya ja raha hai.
                  Retry {retryInfo.attempt} of {retryInfo.maxAttempts}.
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">Call connects only after you answer.</p>
              )}
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