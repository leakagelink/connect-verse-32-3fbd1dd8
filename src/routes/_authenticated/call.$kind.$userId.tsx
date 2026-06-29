import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, Coins, Search, Gift, ShieldAlert, Volume2, VolumeX } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { toast } from "sonner";
import { VOICE_CALL_COINS_PER_MINUTE, VIDEO_CALL_COINS_PER_MINUTE } from "@/lib/constants";
import { endCallLog, applyCallUsage } from "@/lib/calls.functions";
import { generateMysteryCase, CASE_GENERATION_COIN_COST } from "@/lib/mystery.functions";
import { getMyProfile } from "@/lib/onboarding.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MysteryPanel } from "@/components/mystery-panel";
import { InCallRecharge } from "@/components/in-call-recharge";
import { GiftPanel } from "@/components/gift-panel";
import { GiftFloater } from "@/components/gift-floater";
import { SosButton } from "@/components/sos-button";
import { SafetyTipOverlay } from "@/components/safety-tip-overlay";
import { ModerationSampler } from "@/components/moderation-sampler";
import { useScreenPrivacy } from "@/hooks/use-screen-privacy";
import { onHardwareBack, openAppSettings, requestCallPermissions, isNative } from "@/lib/native";
import { CallPermissionGate } from "@/components/call-permission-gate";
import { supabase } from "@/integrations/supabase/client";
import { recordCallMetrics } from "@/lib/calling.functions";
import { connectCall, type AnySession } from "@/lib/call-session";
import { Signal, SignalHigh, SignalLow, SignalMedium, SignalZero } from "lucide-react";
import { getCallInviteStatus, acceptCallInvite } from "@/lib/call-invites.functions";




export const Route = createFileRoute("/_authenticated/call/$kind/$userId")({
  validateSearch: (search) => ({
    inviteId: typeof search.inviteId === "string" ? search.inviteId : undefined,
    autoAccept: search.autoAccept === "1" || search.autoAccept === 1 || search.autoAccept === true,
  }),
  component: CallScreen,
});

function CallScreen() {
  const { kind, userId } = useParams({ from: "/_authenticated/call/$kind/$userId" });
  const { inviteId, autoAccept } = Route.useSearch();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const remoteContainerRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<AnySession | null>(null);
  const endedRef = useRef(false);
  const callLogIdRef = useRef<string | null>(null);
  const [provider, setProvider] = useState<"mock" | "agora" | "100ms">("mock");
  const [networkQ, setNetworkQ] = useState<number>(0); // 0=unknown,1=excellent..6=down
  const [remoteJoined, setRemoteJoined] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  // Structured join failure so we can show actionable retry UI instead of a
  // toast + redirect away from the call.
  const [joinError, setJoinError] = useState<{
    kind: "mic" | "camera" | "media" | "in-use" | "other";
    message: string;
  } | null>(null);
  const [joinAttempt, setJoinAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  
  
  const elapsedRef = useRef(0);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [connected, setConnected] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [lowBalanceOpen, setLowBalanceOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  // Snapshots of free seconds + coin balance captured when the call connects.
  // Used to live-display remaining free time / coin time during the call.
  const [freeStart, setFreeStart] = useState<number | null>(null);
  const [coinStart, setCoinStart] = useState<number | null>(null);
  const outOfFundsTriggeredRef = useRef(false);
  // Ref bridge so auto-end effects (out-of-coins / peer-left) can invoke
  // confirmEndCall before it's defined later in the component.
  const endCallNowRef = useRef<() => void>(() => {});

  // Single-active-session enforcement: every mount mints a unique token and
  // writes it into the active_call localStorage slot. A newer tab claiming
  // ownership overwrites the token; older tabs notice via the `storage` event
  // and pause (no usage flushes, no elapsed counter, no recharge prompts).
  const sessionTokenRef = useRef<string>(
    (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID?.()) ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);

  // Phase 4 — Native: block screenshots / screen-recording during the call,
  // and intercept Android hardware back to surface the "End call?" prompt
  // instead of bailing out mid-call.
  useScreenPrivacy(true);
  useEffect(() => {
    const off = onHardwareBack(() => {
      setConfirmEnd(true);
      return true; // handled — do not exit app
    });
    return off;
  }, []);




  const perMin = kind === "video" ? VIDEO_CALL_COINS_PER_MINUTE : VOICE_CALL_COINS_PER_MINUTE;
  const endLogFn = useServerFn(endCallLog);
  const applyUsageFn = useServerFn(applyCallUsage);
  const inviteStatusFn = useServerFn(getCallInviteStatus);
  const acceptInviteFn = useServerFn(acceptCallInvite);
  // Tracks how much we've already persisted to the server (server is the
  // source of truth across refresh / reconnect).
  const syncedFreeRef = useRef(0);
  const syncedCoinsRef = useRef(0);
  // Baseline elapsed seconds already recorded on the call_log from prior
  // sessions of the same call (after a reconnect / refresh). The wall-clock
  // total we report to the server is this baseline + the current session's
  // elapsed counter.
  const sessionStartElapsedRef = useRef(0);
  const generateCaseFn = useServerFn(generateMysteryCase);
  const profileFn = useServerFn(getMyProfile);
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });
  const isMale = me?.profile?.gender === "male";
  const myId = me?.profile?.id ?? "";
  const [caseId, setCaseId] = useState<string | null>(null);
  const [casePanelOpen, setCasePanelOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const callRoleRef = useRef<"caller" | "callee" | null>(null);

  // Realtime: share generated case_id between caller & callee using a deterministic channel
  useEffect(() => {
    if (!myId) return;
    const pair = [myId, userId].sort().join(":");
    const channel = supabase.channel(`mystery:${pair}`, { config: { broadcast: { self: false } } });
    channel
      .on("broadcast", { event: "new_case" }, (payload) => {
        const id = (payload.payload as any)?.caseId as string | undefined;
        if (id) {
          setCaseId(id);
          setCasePanelOpen(true);
          toast.info("Your partner started a mystery case!");
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [myId, userId]);

  const myBalance = me?.walletBalance ?? 0;
  const canAfford = myBalance >= CASE_GENERATION_COIN_COST;

  async function hostMysteryCase() {
    if (!isMale) {
      toast.error("Only male players can host a mystery case.");
      return;
    }
    if (!canAfford) {
      setLowBalanceOpen(true);
      return;
    }
    setGenerating(true);
    try {
      const res = await generateCaseFn({
        data: { partnerId: userId, callLogId: callLogIdRef.current ?? undefined },
      });
      setCaseId(res.id);
      setCasePanelOpen(true);
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      const pair = [myId, userId].sort().join(":");
      await supabase.channel(`mystery:${pair}`).send({
        type: "broadcast",
        event: "new_case",
        payload: { caseId: res.id },
      });
      toast.success(`Case generated! -${CASE_GENERATION_COIN_COST} coins`);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (/insufficient|not enough|balance/i.test(msg)) {
        setLowBalanceOpen(true);
      } else {
        toast.error(msg || "Could not generate case");
      }
    } finally {
      setGenerating(false);
    }
  }


  const [permReady, setPermReady] = useState(false);
  // True when this voice call is the result of an auto-downgrade from a video
  // call (camera failed). Drives the "Try camera again" affordance so the user
  // can switch back without ending the call.
  const [wasDowngraded, setWasDowngraded] = useState(false);
  useEffect(() => {
    if (kind !== "voice" || !inviteId) { setWasDowngraded(false); return; }
    try {
      setWasDowngraded(sessionStorage.getItem(`call:cam-fallback:${inviteId}`) === "1");
    } catch { /* ignore */ }
  }, [kind, inviteId]);

  function tryCameraAgain() {
    if (!inviteId) return;
    try { sessionStorage.removeItem(`call:cam-fallback:${inviteId}`); } catch { /* ignore */ }
    toast.info("Switching back to video…");
    navigate({
      to: "/call/$kind/$userId",
      params: { kind: "video", userId },
      search: { inviteId },
      replace: true,
    });
  }


  useEffect(() => {
    let mounted = true;
    if (!myId) return; // wait for profile so the call account = supabase user id
    if (!permReady) return; // wait for the user to grant mic/cam via the gate
    async function start() {
      try {
        if (!inviteId) {
          throw new Error("Call request missing. Please start the call again from Connect.");
        }
        let invite = await inviteStatusFn({ data: { inviteId } });
        // Auto-accept: launched from a full-screen incoming-call notification
        // (lock-screen Accept button). The callee hasn't accepted yet through
        // the in-app UI, so do it here before joining.
        if (autoAccept && invite.status === "pending" && invite.role === "callee") {
          try {
            invite = await acceptInviteFn({ data: { inviteId } });
          } catch (e: any) {
            throw new Error(e?.message || "Could not accept this call.");
          }
        }
        if (invite.status !== "accepted") {
          throw new Error(
            invite.status === "pending"
              ? "Creator has not answered yet. Please wait for acceptance."
              : "This call request is no longer active. Please start a new call.",
          );
        }
        const expectedPartner = invite.role === "caller" ? invite.calleeId : invite.callerId;
        if (invite.kind !== kind || expectedPartner !== userId || !invite.callLogId) {
          throw new Error("Call invite does not match this call session.");
        }
        callRoleRef.current = invite.role as "caller" | "callee";
        callLogIdRef.current = invite.callLogId;
        syncedFreeRef.current = invite.baselineFreeSecondsUsed ?? 0;
        syncedCoinsRef.current = invite.baselineCoinsSpent ?? 0;
        sessionStartElapsedRef.current = invite.baselineDurationSeconds ?? 0;

        // Provider-agnostic connect with automatic failover across the
        // calling pool (multi-Agora + multi-100ms). On every credential
        // failure the factory reports it server-side and retries with the
        // next healthy credential before giving up.
        const session = await connectCall({
          myUserId: myId,
          partnerUserId: userId,
          kind: kind as "voice" | "video",
          events: {
            onRemoteJoined: () => mounted && setRemoteJoined(true),
            onRemoteLeft: () => mounted && setRemoteJoined(false),
            onQuality: (q) => mounted && setNetworkQ(q),
            onDisconnected: () => mounted && toast.warning("Network unstable — reconnecting…"),
            onReconnected: () => mounted && toast.success("Reconnected"),
            onVideoFallback: () => {
              if (!mounted) return;
              setCamOff(true);
              toast.warning("Switched to audio-only due to poor network.");
            },
            onAudioBlocked: () => mounted && setAudioBlocked(true),
          },
        });

        if (!mounted) {
          session.localStream?.getTracks().forEach((t) => t.stop());
          (session.session as any)?.leave?.().catch(() => {});
          return;
        }
        sessionRef.current = session;
        setProvider(session.provider);

        // Local preview wiring. Agora & mock hand back a MediaStream; 100ms
        // manages capture internally so we attach the local <video> via SDK.
        if (session.localStream) {
          streamRef.current = session.localStream;
          if (kind === "video" && videoRef.current) {
            videoRef.current.srcObject = session.localStream;
            await videoRef.current.play().catch(() => {});
          }
        } else if (session.provider === "100ms" && kind === "video" && videoRef.current) {
          session.attachLocal(videoRef.current);
        }
        // Remote container — both Agora & 100ms attach to the same div.
        if (kind === "video" && remoteContainerRef.current && session.provider !== "mock") {
          session.attachRemote(remoteContainerRef.current);
        }
        if (session.failoverChain.length > 0) {
          toast.info(
            `Switched to ${session.provider.toUpperCase()} after ${session.failoverChain.length} failover(s).`,
          );
        }

        setTimeout(async () => {
          if (!mounted) return;
          setConnected(true);
          // Snapshot the free seconds + coin balance at connect time so the
          // live counter shows exactly what the user has to spend.
          setFreeStart(me?.profile?.free_seconds_remaining ?? 0);
          setCoinStart(me?.walletBalance ?? 0);
          try {
            const resumeKey = `active_call:${userId}:${kind}:${inviteId}`;
            try {
              localStorage.setItem(
                resumeKey,
                JSON.stringify({
                  id: invite.callLogId,
                  lastFlushedAt: new Date().toISOString(),
                  sessionToken: sessionTokenRef.current,
                }),
              );
            } catch { /* ignore */ }
            // Authoritative re-sync: pull the latest profile so the free
            // countdown + "Free minutes used" label reflect what the server
            // actually has (after any prior session's flushes).
            try {
              const fresh = await profileFn();
              if (mounted && fresh?.profile) {
                qc.setQueryData(["me"], fresh);
                setFreeStart(fresh.profile.free_seconds_remaining ?? 0);
                setCoinStart(fresh.walletBalance ?? 0);
                elapsedRef.current = 0;
                setElapsed(0);
                freeExhaustedRef.current =
                  (fresh.profile.free_seconds_remaining ?? 0) === 0;
              }
            } catch { /* ignore profile refresh failure */ }
          } catch { /* ignore log start failure */ }
        }, 1200);
      } catch (e: any) {
        if (!mounted) return;
        const msg = String(e?.message ?? e ?? "");
        const name = String(e?.name ?? "");
        const blob = `${name} ${msg}`;
        // Classify so we can show the right call-to-action. Kind-aware:
        // for video calls we bias ambiguous failures toward "camera" so the
        // user gets actionable camera guidance instead of a generic media error.
        let kindOfErr: "mic" | "camera" | "media" | "in-use" | "other" = "other";
        const mentionsCamera = /camera|video|OverconstrainedError|getUserMedia.*video/i.test(blob);
        const mentionsMic = /mic|microphone|audio/i.test(blob);
        const isInUse = /NotReadableError|TrackStartError|in use|busy|already in use/i.test(blob);
        const isPerm = /NotAllowedError|Permission|denied|SecurityError/i.test(blob);
        const isNotFound = /NotFoundError|DevicesNotFoundError|Requested device not found/i.test(blob);
        const isOverconstrained = /OverconstrainedError|ConstraintNotSatisfied/i.test(blob);
        if (isInUse) {
          kindOfErr = "in-use";
        } else if (mentionsCamera && !mentionsMic && (isPerm || isNotFound || isOverconstrained)) {
          kindOfErr = "camera";
        } else if (mentionsMic && !mentionsCamera && (isPerm || isNotFound)) {
          kindOfErr = "mic";
        } else if (isPerm || isNotFound || isOverconstrained) {
          kindOfErr = kind === "video" ? (mentionsCamera ? "camera" : "media") : "mic";
        } else if (/getUserMedia|MediaStream|track/i.test(blob)) {
          kindOfErr = kind === "video" ? "camera" : "mic";
        }
        // Auto-fallback: if this is a video call and the failure is camera-
        // specific (or a "device in use" error that's almost always the
        // camera being held by another app), silently downgrade to a voice
        // call once instead of dead-ending on the error card. The audio
        // pipeline still works, so the user keeps the conversation going.
        const cameraSpecific = kindOfErr === "camera" || (kindOfErr === "in-use" && mentionsCamera);
        const alreadyFellBack =
          typeof sessionStorage !== "undefined" && inviteId
            ? sessionStorage.getItem(`call:cam-fallback:${inviteId}`) === "1"
            : false;
        if (kind === "video" && cameraSpecific && inviteId && !alreadyFellBack) {
          try { sessionStorage.setItem(`call:cam-fallback:${inviteId}`, "1"); } catch { /* ignore */ }
          toast.warning("Camera unavailable — continuing as voice call.");
          navigate({
            to: "/call/$kind/$userId",
            params: { kind: "voice", userId },
            search: { inviteId },
            replace: true,
          });
          return;
        }
        setJoinError({ kind: kindOfErr, message: msg || name || "Unknown error" });
        setRetrying(false);
      }
    }
    start();
    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const s = sessionRef.current;
      if (s && s.session) {
        (s.session as { leave: () => Promise<void> }).leave().catch(() => {});
      }
    };
  }, [kind, navigate, myId, userId, permReady, inviteId, inviteStatusFn, acceptInviteFn, autoAccept, joinAttempt]);


  useEffect(() => {
    if (!connected) return;
    const i = setInterval(() => {
      // Paused tabs (a newer session has claimed ownership) freeze the timer
      // so no double-counting happens against the authoritative session.
      if (pausedRef.current) return;
      setElapsed((e) => {
        const next = e + 1;
        elapsedRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(i);
  }, [connected]);

  // Listen for ownership changes from other tabs. If another mount of the
  // call screen overwrites the active_call slot with a different
  // sessionToken, this tab pauses: no flushes, no elapsed tick, no recharge
  // prompts. Resuming requires reload of this tab (which mints a fresh token).
  useEffect(() => {
    const resumeKey = `active_call:${userId}:${kind}:${inviteId ?? "direct"}`;
    function evaluate(raw: string | null) {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        const token = parsed?.sessionToken as string | undefined;
        if (token && token !== sessionTokenRef.current && !pausedRef.current) {
          pausedRef.current = true;
          setPaused(true);
          toast.warning(
            "Another call window took over — this tab is paused to avoid double billing.",
            { duration: 8000 },
          );
        }
      } catch { /* ignore */ }
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key !== resumeKey) return;
      evaluate(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    // Initial check in case another tab claimed ownership before this one mounted.
    try { evaluate(localStorage.getItem(resumeKey)); } catch { /* ignore */ }
    return () => window.removeEventListener("storage", onStorage);
  }, [userId, kind, inviteId]);

  // ---- Live billing ledger (free seconds first, then coins) ----
  const freeAvail = freeStart ?? 0;
  const coinsAvail = coinStart ?? 0;
  const freeUsed = Math.min(freeAvail, elapsed);
  const freeLeftSec = Math.max(0, freeAvail - freeUsed);
  const coinSecondsUsed = Math.max(0, elapsed - freeAvail);
  const coinsConsumed = Math.ceil((coinSecondsUsed * perMin) / 60);
  const coinsLeft = Math.max(0, coinsAvail - coinsConsumed);
  // Seconds the remaining coin balance can still buy after free time ends.
  const coinSecondsLeft = Math.floor((coinsLeft * 60) / perMin);
  const totalSecondsLeft = freeLeftSec + coinSecondsLeft;
  const usingFree = freeLeftSec > 0;
  const isPayer = callRoleRef.current !== "callee";
  const outOfFunds = connected && isPayer && totalSecondsLeft <= 0;

  // Seed live ledger snapshots the moment the profile is available — so the
  // "5:00 free" countdown is visible from the very start of the call screen.
  useEffect(() => {
    if (freeStart === null && me?.profile) {
      setFreeStart(me.profile.free_seconds_remaining ?? 0);
      setCoinStart(me.walletBalance ?? 0);
    }
  }, [me, freeStart]);

  // Notify the user exactly when free minutes finish and coin billing kicks in.
  const freeExhaustedRef = useRef(false);
  useEffect(() => {
    if (!connected || freeStart === null) return;
    if (freeAvail > 0 && freeLeftSec === 0 && !freeExhaustedRef.current) {
      freeExhaustedRef.current = true;
      toast.info("Free minutes finished — coins are now being used.");
    }
  }, [connected, freeStart, freeAvail, freeLeftSec]);


  // When payer runs out of free time + coins, end the call on this side.
  // Leaving Agora triggers `user-left` on the peer, which auto-ends them too.
  useEffect(() => {
    if (!connected) return;
    if (pausedRef.current) return;
    if (outOfFunds && !outOfFundsTriggeredRef.current) {
      outOfFundsTriggeredRef.current = true;
      toast.error("Coins exhausted — ending call.", { duration: 6000 });
      window.setTimeout(() => {
        if (!endedRef.current) endCallNowRef.current();
      }, 900);
    }
  }, [connected, outOfFunds, paused]);

  // Auto-end when the remote peer leaves the channel. Agora fires `user-left`
  // on an intentional leave or after the ~20s connection timeout, so this is
  // a reliable "peer is gone" signal (vs transient network blips, which
  // surface as user-unpublished/onDisconnected and recover automatically).
  const wasJoinedRef = useRef(false);
  useEffect(() => {
    if (remoteJoined) wasJoinedRef.current = true;
  }, [remoteJoined]);
  useEffect(() => {
    if (!connected || !wasJoinedRef.current || remoteJoined) return;
    if (endedRef.current) return;
    toast.warning("Other person ended the call.");
    const t = window.setTimeout(() => {
      if (!endedRef.current) endCallNowRef.current();
    }, 1200);
    return () => clearTimeout(t);
  }, [connected, remoteJoined]);


  // ---- Persistence: keep server-side free_seconds_remaining and coin balance
  // in sync so the countdown / "Free minutes used" state survives refresh,
  // reconnect, accidental tab close, or app restart. -----------------------
  // Idempotency key for the in-flight flush. Reused across retries so the
  // server can dedupe duplicate attempts; cleared after a successful flush.
  const pendingFlushKeyRef = useRef<string | null>(null);
  const flushInFlightRef = useRef(false);
  const flushUsage = useRef<(opts?: { keepalive?: boolean }) => void>(() => {});
  flushUsage.current = () => {
    const callLogId = callLogIdRef.current;
    if (!callLogId) return;
    if (callRoleRef.current === "callee") return;
    if (flushInFlightRef.current) return;
    // Paused (another tab took ownership) → don't push usage from this tab,
    // the authoritative tab is now responsible for billing.
    if (pausedRef.current) return;
    // Also bail if the localStorage slot now belongs to a different session
    // token (e.g. storage event was missed in this tab).
    try {
      const raw = localStorage.getItem(`active_call:${userId}:${kind}:${inviteId ?? "direct"}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.sessionToken && parsed.sessionToken !== sessionTokenRef.current) {
          pausedRef.current = true;
          setPaused(true);
          return;
        }
      }
    } catch { /* ignore */ }
    // This-session usage so far (live counters).
    const sessionFreeUsed = Math.min(freeAvail, elapsedRef.current);
    const sessionCoinsUsed = Math.ceil(
      (Math.max(0, elapsedRef.current - freeAvail) * perMin) / 60,
    );
    const cappedSessionCoinsUsed = Math.min(coinsAvail, sessionCoinsUsed);
    const totalFree = syncedFreeRef.current + sessionFreeUsed;
    const totalCoins = syncedCoinsRef.current + cappedSessionCoinsUsed;
    const totalElapsed = sessionStartElapsedRef.current + elapsedRef.current;
    if (
      sessionFreeUsed === 0 &&
      cappedSessionCoinsUsed === 0 &&
      totalElapsed === sessionStartElapsedRef.current
    ) {
      return;
    }
    // Mint a stable idempotency key for this attempt; keep it until the
    // server confirms so any retry sends the same key and gets deduped.
    if (!pendingFlushKeyRef.current) {
      pendingFlushKeyRef.current =
        (globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }
    const idemKey = pendingFlushKeyRef.current;
    flushInFlightRef.current = true;
    applyUsageFn({
      data: {
        callLogId,
        idempotencyKey: idemKey,
        totalFreeSeconds: totalFree,
        totalCoins: totalCoins,
        elapsedSeconds: totalElapsed,
      },
    })
      .then(() => {
        syncedFreeRef.current = totalFree;
        syncedCoinsRef.current = totalCoins;
        sessionStartElapsedRef.current = totalElapsed;
        elapsedRef.current = 0;
        pendingFlushKeyRef.current = null;
        try {
          localStorage.setItem(
            `active_call:${userId}:${kind}:${inviteId ?? "direct"}`,
            JSON.stringify({
              id: callLogId,
              lastFlushedAt: new Date().toISOString(),
              sessionToken: sessionTokenRef.current,
            }),
          );
        } catch { /* ignore */ }
      })
      .catch(() => { /* keep pendingFlushKeyRef so retry reuses same key */ })
      .finally(() => {
        flushInFlightRef.current = false;
      });
  };



  // Periodic flush every 10s while connected.
  useEffect(() => {
    if (!connected) return;
    const i = setInterval(() => flushUsage.current(), 10000);
    return () => clearInterval(i);
  }, [connected]);

  // Flush when the tab is hidden / about to unload so a refresh keeps state.
  useEffect(() => {
    const onHide = () => flushUsage.current();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  // After mount, re-fetch the profile so any usage persisted by a previous
  // call session (before refresh) is reflected in the countdown immediately.
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["me"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);






  // Block back navigation while on the call screen — show confirm dialog instead.
  useEffect(() => {
    window.history.pushState({ inCall: true }, "");
    const onPop = () => {
      if (endedRef.current) return;
      // re-push so we stay on this screen
      window.history.pushState({ inCall: true }, "");
      setConfirmEnd(true);
    };
    window.addEventListener("popstate", onPop);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (endedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  function toggleMic() {
    const t = streamRef.current?.getAudioTracks()[0];
    if (t) { t.enabled = !t.enabled; setMuted(!t.enabled); }
  }
  function toggleCam() {
    const t = streamRef.current?.getVideoTracks()[0];
    if (t) { t.enabled = !t.enabled; setCamOff(!t.enabled); }
  }
  async function toggleSpeaker() {
    const next = !speakerOn;
    setSpeakerOn(next);
    const sess: any = sessionRef.current?.session;
    try {
      await sess?.setSpeakerMode?.(next);
    } catch { /* ignore */ }
  }
  function confirmEndCall() {
    if (endedRef.current) return;
    endedRef.current = true;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setConfirmEnd(false);
    // Flush any unsynced free seconds / coins so the final state is persisted
    // even if endCallLog races or the network blips.
    flushUsage.current();
    const id = callLogIdRef.current;
    const totalSeconds = sessionStartElapsedRef.current + elapsedRef.current;
    const totalCoins = syncedCoinsRef.current;
    // Capture session stats BEFORE leave() resets them.
    const cur = sessionRef.current;
    const sess = cur?.session as { stats?: () => { channel: string; qualityAvg: number; disconnects: number }; leave?: () => Promise<void> } | null;
    const stats = sess?.stats?.();
    sess?.leave?.().catch(() => {});
    sessionRef.current = null;
    if (id) {
      endLogFn({
        data: {
          id,
          durationSeconds: totalSeconds,
          coinsSpent: totalCoins,
          status: totalSeconds > 0 ? "completed" : "cancelled",
        },
      }).catch(() => {});
      // Persist call quality + provider + credential for analytics / quota.
      recordCallMetrics({
        data: {
          callLogId: id,
          provider,
          credentialId: cur?.credentialId ?? undefined,
          channelName: stats?.channel,
          qualityAvg: stats?.qualityAvg,
          disconnects: stats?.disconnects,
          failoverChain: cur?.failoverChain ?? undefined,
          durationSeconds: totalSeconds,
        },
      }).catch(() => {});
    }

    try { localStorage.removeItem(`active_call:${userId}:${kind}:${inviteId ?? "direct"}`); } catch { /* ignore */ }
    navigate({ to: "/recents" });
  }


  const totalElapsed = sessionStartElapsedRef.current + elapsed;
  const mm = String(Math.floor(totalElapsed / 60)).padStart(2, "0");
  const ss = String(totalElapsed % 60).padStart(2, "0");



  if (!permReady) {
    return (
      <AppShell>
        <CallPermissionGate
          kind={kind as "voice" | "video"}
          onReady={() => setPermReady(true)}
          onCancel={() => navigate({ to: "/connect" })}
        />
      </AppShell>
    );
  }

  if (joinError) {
    const err = joinError;
    const titles: Record<typeof err.kind, string> = {
      mic: "Microphone unavailable",
      camera: "Camera unavailable",
      media: "Camera or microphone unavailable",
      "in-use": "Mic / camera is busy",
      other: "Couldn't start the call",
    };
    const tips: Record<typeof err.kind, string> = {
      mic: "We couldn't capture your microphone. Make sure mic permission is granted and no other app is using it.",
      camera: "We couldn't capture your camera. Grant camera permission, close any other app that might be using it (WhatsApp, Instagram, Zoom, your browser), then retry.",
      media: "We couldn't capture your camera or microphone. Grant access to both and try again.",
      "in-use": "Another app (like WhatsApp or your browser) is using your mic or camera. Close it and retry.",
      other: "Something went wrong while connecting. Please try again.",
    };
    const needsPerm = err.kind !== "in-use" && err.kind !== "other";
    // Offer a voice-only fallback when the camera is the blocker on a video call.
    const canFallbackToVoice =
      kind === "video" && (err.kind === "camera" || err.kind === "in-use");

    async function handleRetry() {
      setRetrying(true);
      try {
        if (needsPerm) {
          // Re-prompt the OS for the relevant permission inside the tap gesture.
          // For camera errors on a video call, ensure we ask for camera too.
          const askKind: "voice" | "video" =
            err.kind === "camera" || kind === "video" ? "video" : "voice";
          try { await requestCallPermissions(askKind); } catch { /* ignore */ }
        }
        setJoinError(null);
        setRemoteJoined(false);
        setConnected(false);
        setJoinAttempt((n) => n + 1);
      } finally {
        // The effect re-run flips retrying off via setRetrying(false) in the
        // catch path or via successful connect (joinError === null).
        setTimeout(() => setRetrying(false), 800);
      }
    }

    async function handleOpenSettings() {
      const ok = await openAppSettings();
      if (!ok) toast.info("Open Settings → Apps → Talkora → Permissions and enable Microphone / Camera.");
    }

    function handleSwitchToVoice() {
      setJoinError(null);
      navigate({
        to: "/call/$kind/$userId",
        params: { kind: "voice", userId },
        search: { inviteId },
        replace: true,
      });
    }

    return (
      <AppShell>
        <Card className="glass p-6 max-w-md mx-auto mt-6 space-y-4 text-center">
          <div className="mx-auto size-14 rounded-full bg-destructive/15 text-destructive flex items-center justify-center">
            <ShieldAlert className="size-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{titles[err.kind]}</h2>
            <p className="text-sm text-muted-foreground">{tips[err.kind]}</p>
          </div>
          <details className="text-left text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
            <summary className="cursor-pointer select-none">Technical details</summary>
            <p className="mt-1 break-words font-mono">{err.message}</p>
          </details>
          <div className="flex flex-col gap-2">
            <Button onClick={handleRetry} disabled={retrying} className="w-full">
              {retrying ? "Retrying…" : needsPerm ? "Grant access & retry" : "Try again"}
            </Button>
            {canFallbackToVoice && inviteId && (
              <Button variant="secondary" onClick={handleSwitchToVoice} className="w-full">
                Continue as voice call
              </Button>
            )}
            {needsPerm && isNative() && (
              <Button variant="outline" onClick={handleOpenSettings} className="w-full">
                Open app settings
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate({ to: "/connect" })} className="w-full">
              Cancel call
            </Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <SafetyTipOverlay />
      <Card className="glass overflow-hidden p-0">
        {paused && (
          <div className="bg-amber-500/90 text-black text-xs font-semibold text-center px-3 py-2">
            Paused — another call window is now active. Close this tab or reload to take over.
          </div>
        )}
        <div className="relative aspect-[3/4] sm:aspect-video bg-black flex items-center justify-center">

          {kind === "video" ? (
            <>
              {/* Remote peer fills the frame when joined (Agora). Local preview moves to a picture-in-picture tile. */}
              <div
                ref={remoteContainerRef}
                className={`absolute inset-0 size-full ${remoteJoined ? "block" : "hidden"}`}
              />
              <video
                ref={videoRef}
                className={
                  remoteJoined
                    ? "absolute bottom-24 right-3 w-24 h-32 sm:w-32 sm:h-40 object-cover rounded-lg border-2 border-white/50 z-10"
                    : "absolute inset-0 size-full object-cover"
                }
                muted
                playsInline
              />
            </>
          ) : (
            <div className="text-center">
              <div className="mx-auto size-28 rounded-full brand-gradient flex items-center justify-center mb-4 animate-pulse">
                <Mic className="size-12 text-primary-foreground" />
              </div>
              <p className="text-lg font-semibold text-white">
                {provider === "agora" && !remoteJoined ? "Ringing…" : "Voice call"}
              </p>
            </div>
          )}
          {audioBlocked && (
            <button
              type="button"
              onClick={() => {
                try {
                  (sessionRef.current?.session as any)?.retryAudio?.();
                } catch { /* ignore */ }
                setAudioBlocked(false);
              }}
              className="absolute inset-x-6 top-1/2 -translate-y-1/2 z-20 mx-auto max-w-xs rounded-xl bg-amber-500 text-black font-semibold px-4 py-3 shadow-lg"
            >
              🔊 Tap to enable speaker audio
            </button>
          )}
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-white">
            <div className="px-2.5 py-1 rounded-full bg-black/50 text-xs flex items-center gap-1.5">
              {connected ? `Connected · ${mm}:${ss}` : "Connecting…"}
              {provider === "agora" && networkQ > 0 && (
                <NetworkBars q={networkQ} />
              )}
            </div>
            <div className="px-2.5 py-1 rounded-full bg-coin/80 text-xs font-semibold flex items-center gap-1">
              <Coins className="size-3" /> {perMin} / min
            </div>
          </div>
          {/* Live free-time / coin-balance HUD — visible from call start */}
          {freeStart !== null && (
            <div className="absolute bottom-12 left-3 right-3 flex items-center justify-between gap-2 text-white">
              <div
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold backdrop-blur transition-colors ${
                  usingFree ? "bg-emerald-500/80" : "bg-black/50"
                }`}
              >
                {usingFree
                  ? `Free ${String(Math.floor(freeLeftSec / 60)).padStart(2, "0")}:${String(freeLeftSec % 60).padStart(2, "0")} left`
                  : "Free minutes used"}
              </div>
              <div
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold backdrop-blur ${
                  !usingFree && coinsLeft < perMin ? "bg-destructive/80" : "bg-black/50"
                }`}
              >
                <Coins className="inline size-3 -mt-0.5 mr-1" />
                {coinsLeft} coins · ≈{Math.floor(coinSecondsLeft / 60)}:
                {String(coinSecondsLeft % 60).padStart(2, "0")}
              </div>
            </div>
          )}

          <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/50 text-[11px] text-white">
            to {userId.slice(0, 8)}
          </div>
          <GiftFloater callLogId={callLogIdRef.current} myUserId={myId || null} />
        </div>
        <div className="p-4 flex items-center justify-center gap-3">
          <Button size="icon" variant={muted ? "destructive" : "secondary"} onClick={toggleMic}>
            {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </Button>
          {kind === "video" && (
            <Button size="icon" variant={camOff ? "destructive" : "secondary"} onClick={toggleCam}>
              {camOff ? <VideoOff className="size-5" /> : <VideoIcon className="size-5" />}
            </Button>
          )}
          <Button
            size="icon"
            variant={speakerOn ? "default" : "secondary"}
            onClick={toggleSpeaker}
            aria-label={speakerOn ? "Speaker on" : "Speaker off"}
            title={speakerOn ? "Speaker on — tap for earpiece" : "Tap for speaker"}
          >
            {speakerOn ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
          </Button>
          <Button
            size="icon"
            variant="secondary"
            onClick={() => setGiftOpen(true)}
            disabled={!connected}
            aria-label="Send gift"
            className="relative"
          >
            <Gift className="size-5 text-pink-500" />
          </Button>
          <Button size="icon" variant="destructive" onClick={() => setConfirmEnd(true)}>
            <PhoneOff className="size-5" />
          </Button>
        </div>
        <div className="px-4 pb-2 flex justify-center">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              speakerOn
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
            aria-live="polite"
          >
            {speakerOn ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
            Speaker {speakerOn ? "ON" : "OFF"}
          </span>
        </div>

        {wasDowngraded && kind === "voice" && (
          <div className="px-4 pb-2 flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <VideoOff className="size-3" /> Camera was unavailable — call continued as voice.
            </span>
            <Button size="sm" variant="secondary" onClick={tryCameraAgain}>
              <VideoIcon className="size-4 mr-1" /> Try camera again
            </Button>
          </div>
        )}

        {/* SOS panic row — Play Store UGC safety requirement */}
        <div className="px-4 pb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <ShieldAlert className="size-3" /> Feeling unsafe? Tap SOS →
          </p>
          <SosButton
            partnerUserId={userId}
            callLogId={callLogIdRef.current}
            onEndCall={confirmEndCall}
          />
        </div>


        {/* Mystery game controls */}
        <div className="px-4 pb-3">
          {isMale ? (
            <>
              <Button
                variant="secondary"
                className="w-full gap-2"
                disabled={generating || !connected}
                onClick={hostMysteryCase}
              >
                <Search className="size-4" />
                {generating
                  ? "Generating case…"
                  : caseId
                  ? "Open mystery case"
                  : canAfford
                  ? `Host Mystery Case · ${CASE_GENERATION_COIN_COST} coins`
                  : `Low balance · need ${CASE_GENERATION_COIN_COST} coins`}
              </Button>
              {!caseId && (
                <p
                  className={`mt-1 text-center text-[11px] ${
                    canAfford ? "text-muted-foreground" : "text-destructive"
                  }`}
                >
                  <Coins className="inline size-3 -mt-0.5 mr-1" />
                  Your balance: {myBalance} coins
                  {!canAfford && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="underline font-medium"
                        onClick={() => setLowBalanceOpen(true)}
                      >
                        Recharge
                      </button>
                    </>
                  )}
                </p>
              )}
            </>
          ) : caseId ? (
            <Button variant="secondary" className="w-full gap-2" onClick={() => setCasePanelOpen(true)}>
              <Search className="size-4" /> Open mystery case
            </Button>
          ) : (
            <p className="text-[11px] text-center text-muted-foreground">
              Your partner can host a Mystery Case · free for you to play 🕵️
            </p>
          )}
          {caseId && isMale && !casePanelOpen && (
            <button
              className="mt-1 w-full text-[11px] text-primary hover:underline"
              onClick={() => setCasePanelOpen(true)}
            >
              Re-open current case
            </button>
          )}
        </div>


        <p className="px-4 pb-4 text-center text-[11px] text-muted-foreground">
          Coins are deducted per minute. The back button is disabled during a call — tap the red button to end.
          <br />
          <span className="opacity-75">Calls may be sampled by automated &amp; human moderation for safety.</span>
        </p>
      </Card>

      <MysteryPanel caseId={caseId} open={casePanelOpen} onOpenChange={setCasePanelOpen} />

      {/* Phase 3 — periodic AI safety sampling of the local mic/cam */}
      <ModerationSampler
        stream={streamRef.current}
        kind={kind as "voice" | "video"}
        selfUserId={myId}
        callLogId={callLogIdRef.current}
        enabled={connected && !paused && Boolean(myId) && provider !== "100ms"}
      />

      <GiftPanel
        open={giftOpen}
        onOpenChange={setGiftOpen}
        receiverId={userId}
        callLogId={callLogIdRef.current}
        balance={myBalance}
        onSent={() => {
          qc.invalidateQueries({ queryKey: ["me"] });
        }}
        onLowBalance={() => {
          setGiftOpen(false);
          setRechargeOpen(true);
        }}
      />


      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this call?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disconnect? You will be charged for {Math.max(1, Math.ceil(elapsed / 60))} minute(s)
              at {perMin} coins/min.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay on call</AlertDialogCancel>
            <AlertDialogAction onClick={confirmEndCall} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Yes, end call
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={lowBalanceOpen} onOpenChange={setLowBalanceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Coins className="size-5 text-coin" />
              Not enough coins
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Hosting a Mystery Case costs{" "}
                  <span className="font-semibold text-foreground">{CASE_GENERATION_COIN_COST} coins</span>,
                  but your wallet has only{" "}
                  <span className="font-semibold text-foreground">{myBalance} coins</span>.
                </p>
                <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                  Recharge right here — your call stays connected and the Host button
                  refreshes automatically when payment completes.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep playing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setLowBalanceOpen(false);
                setRechargeOpen(true);
              }}
            >
              Recharge now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <InCallRecharge
        open={rechargeOpen}
        onOpenChange={setRechargeOpen}
        // Highlight plans that at minimum cover the next minute of this call
        // (or the mystery case cost, whichever is larger).
        requiredCoins={Math.max(perMin, CASE_GENERATION_COIN_COST)}
        onRecharged={(newBalance) => {
          // Re-baseline the live ledger so the user keeps talking with the
          // newly added coins (without resetting elapsed time).
          setCoinStart(newBalance + coinsConsumed);
          outOfFundsTriggeredRef.current = false;
          qc.invalidateQueries({ queryKey: ["me"] });
          if (newBalance >= CASE_GENERATION_COIN_COST) {
            toast.success("Coins added — call continues. Tap Host Mystery Case anytime.");
          } else {
            toast.success("Coins added — call continues.");
          }
        }}
      />
    </AppShell>



  );
}

function NetworkBars({ q }: { q: number }) {
  // Agora: 1=excellent, 2=good, 3=poor, 4=bad, 5=very-bad, 6=down
  const label =
    q <= 2 ? "Strong" : q === 3 ? "Fair" : q === 4 ? "Weak" : q >= 5 ? "Very weak" : "—";
  const color =
    q <= 2 ? "text-emerald-400" : q === 3 ? "text-yellow-400" : "text-red-400";
  const Icon =
    q <= 1 ? SignalHigh : q === 2 ? Signal : q === 3 ? SignalMedium : q === 4 ? SignalLow : SignalZero;
  return (
    <span className={`inline-flex items-center gap-0.5 ${color}`} title={`Network: ${label}`}>
      <Icon className="size-3" />
    </span>
  );
}
