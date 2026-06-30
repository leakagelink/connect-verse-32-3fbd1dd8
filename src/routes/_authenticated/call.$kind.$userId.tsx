import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, Coins, Search, Gift, ShieldAlert, Volume2, VolumeX, UserCircle2, FlipHorizontal2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { InCallPeerProfileSheet } from "@/components/in-call-peer-profile-sheet";
import { toast } from "sonner";
import { VOICE_CALL_COINS_PER_MINUTE, VIDEO_CALL_COINS_PER_MINUTE } from "@/lib/constants";
import { endCallLog, applyCallUsage, getCallPeerWallets, heartbeatCall } from "@/lib/calls.functions";
import { generateMysteryCase, CASE_GENERATION_COIN_COST } from "@/lib/mystery.functions";
import { getMyProfile } from "@/lib/onboarding.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MysteryPanel } from "@/components/mystery-panel";
import { InCallRecharge } from "@/components/in-call-recharge";
import { GiftPanel } from "@/components/gift-panel";
import { listGifts, sendGift } from "@/lib/gifts.functions";
import { getWallet } from "@/lib/wallet.functions";

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
import { acceptInviteWithRetry } from "@/lib/accept-call-retry";
import { useCallPointerSafeguard } from "@/hooks/use-call-pointer-safeguard";
import { recordCallUiEvent } from "@/lib/call-ui-telemetry";





export const Route = createFileRoute("/_authenticated/call/$kind/$userId")({
  validateSearch: (search): { inviteId?: string; autoAccept?: boolean; e2e?: "ui" } => ({
    inviteId: typeof search.inviteId === "string" ? search.inviteId : undefined,
    autoAccept: search.autoAccept === "1" || search.autoAccept === 1 || search.autoAccept === true ? true : undefined,
    e2e: search.e2e === "ui" ? "ui" : undefined,
  }),
  component: CallScreenWithE2E,
});

function CallScreenWithE2E() {
  const search = Route.useSearch();
  if (search.e2e === "ui") return <CallFullscreenE2EMock />;
  return <CallScreen />;
}

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
  const [mirrorSelf, setMirrorSelf] = useState<boolean>(() => {
    try { return localStorage.getItem("call:mirrorSelf") !== "0"; } catch { return true; }
  });
  const toggleMirror = () => setMirrorSelf((v) => {
    const next = !v;
    try { localStorage.setItem("call:mirrorSelf", next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  });
  // Structured join failure so we can show actionable retry UI instead of a
  // toast + redirect away from the call.
  const [joinError, setJoinError] = useState<{
    kind: "mic" | "camera" | "media" | "in-use" | "other";
    message: string;
  } | null>(null);
  const [joinAttempt, setJoinAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [acceptRetry, setAcceptRetry] = useState<{ attempt: number; max: number } | null>(null);
  
  
  const elapsedRef = useRef(0);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [connected, setConnected] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // Two-step end-call confirmation. Tap red button (1) → AlertDialog asks
  // "End this call?" → tap "End call" (2) → final "Yes, disconnect now" (3).
  // Three deliberate taps eliminate accidental hangups mid-conversation.
  const [endStep, setEndStep] = useState<1 | 2>(1);
  // Peer profile sheet — opens *inside* the call screen so the WebRTC
  // session keeps running while the user follows / sends a friend request.
  const [peerProfileOpen, setPeerProfileOpen] = useState(false);
  const [lowBalanceOpen, setLowBalanceOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  // Snapshots of free seconds + coin balance captured when the call connects.
  // Used to live-display remaining free time / coin time during the call.
  const [freeStart, setFreeStart] = useState<number | null>(null);
  const [coinStart, setCoinStart] = useState<number | null>(null);
  // Recharge event timeline (debug overlay). Last 5 events kept.
  const [rechargeEvents, setRechargeEvents] = useState<Array<{
    planId: string;
    orderId?: string;
    paymentId?: string;
    source: "mock" | "razorpay";
    requestedAt: number;
    serverRespondedAt: number;
    uiRefreshedAt: number;
    added: number;
    bonus: number;
    newBalance: number;
  }>>([]);
  // Gift send event timeline (debug overlay). Last 8 events kept.
  const [giftEvents, setGiftEvents] = useState<Array<{
    giftId: string;
    giftName: string;
    giftEmoji: string;
    cost: number;
    requestedAt: number;
    serverRespondedAt: number;
    uiRefreshedAt: number;
    preBalance: number;
    newBalance: number;
    serverProcessedMs?: number;
    receiverPreBalance?: number;
    receiverNewBalance?: number;
    ok: boolean;
    error?: string;
  }>>([]);

  const outOfFundsTriggeredRef = useRef(false);
  const lowTimeWarnedRef = useRef(false);
  // Ref bridge so auto-end effects (out-of-coins / peer-left) can invoke
  // confirmEndCall before it's defined later in the component.
  const endCallNowRef = useRef<() => void>(() => {});
  // Audit reason for why this side ended the call. Set by the trigger
  // (out-of-coins / peer-left / media error) before invoking endCallNowRef;
  // sent to endCallLog so the admin panel can audit who disconnected and why.
  const endReasonRef = useRef<"user_ended" | "peer_left" | "coins_exhausted" | "media_error" | "network" | "background_lost" | "unknown">("user_ended");

  // Distinguishing real hangup vs network drop:
  // - peerLeaveReasonRef: why the remote peer left ("quit" = intentional hangup,
  //   "timeout" = SDK gave up after ~20s of no signal — network drop).
  // - peerGraceTimerRef: when the cause is a network timeout we DON'T end the
  //   call immediately; we keep the session up for a grace window so the peer
  //   can reconnect. If they rejoin (onRemoteJoined) the timer is cleared.
  // - localDropReasonRef: most recent local connection-state drop reason; used
  //   to surface "Network unstable…" without ending the call.
  const peerLeaveReasonRef = useRef<"quit" | "timeout" | "audience" | "unknown" | null>(null);
  const peerGraceTimerRef = useRef<number | null>(null);
  const localDropReasonRef = useRef<"network" | "interrupt" | "leave" | "server" | "unknown" | null>(null);
  const PEER_RECONNECT_GRACE_MS = 25_000;



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
  // Gift E2E test runners (debug overlay).
  const listGiftsFn = useServerFn(listGifts);
  const sendGiftFn = useServerFn(sendGift);
  const getWalletFn = useServerFn(getWallet);
  const getPeerWalletsFn = useServerFn(getCallPeerWallets);
  const [e2eRunning, setE2eRunning] = useState(false);
  const [e2eResult, setE2eResult] = useState<{
    ok: boolean;
    summary: string;
    details: Record<string, unknown>;
    at: number;
  } | null>(null);
  const [callE2eResult, setCallE2eResult] = useState<{
    ok: boolean;
    summary: string;
    details: Record<string, unknown>;
    at: number;
  } | null>(null);
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });
  const isMale = me?.profile?.gender === "male";
  const myId = me?.profile?.id ?? "";
  const [caseId, setCaseId] = useState<string | null>(null);
  const [casePanelOpen, setCasePanelOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const callRoleRef = useRef<"caller" | "callee" | null>(null);
  // Whether the local user is the PAYER for this call. Server resolves this
  // via resolveCallParties — a creator calling a regular user inverts the
  // default (caller-pays) rule. Null until the invite status loads.
  const amPayerRef = useRef<boolean | null>(null);
  const [amPayerState, setAmPayerState] = useState<boolean | null>(null);

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
            invite = await acceptInviteWithRetry(acceptInviteFn, inviteId, {
              onAttempt: (info) => {
                if (info.attempt > 1) {
                  setAcceptRetry({ attempt: info.attempt, max: info.maxAttempts });
                }
              },
            });
            setAcceptRetry(null);
          } catch (e: any) {
            setAcceptRetry(null);
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
        // Prefer server-resolved billing direction; fall back to legacy
        // caller-pays rule when older servers omit the field.
        const payerResolved =
          typeof invite.amPayer === "boolean"
            ? invite.amPayer
            : invite.role === "caller";
        amPayerRef.current = payerResolved;
        setAmPayerState(payerResolved);
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
            onRemoteJoined: () => {
              if (!mounted) return;
              setRemoteJoined(true);
              peerLeaveReasonRef.current = null;
              if (peerGraceTimerRef.current) {
                clearTimeout(peerGraceTimerRef.current);
                peerGraceTimerRef.current = null;
                toast.success("Peer reconnected");
              }
            },
            onRemoteLeft: (reason) => {
              if (!mounted) return;
              peerLeaveReasonRef.current = reason ?? "unknown";
              setRemoteJoined(false);
            },
            onQuality: (q) => mounted && setNetworkQ(q),
            onDisconnected: (reason) => {
              if (!mounted) return;
              localDropReasonRef.current = reason ?? "unknown";
              if (reason === "network" || reason === "interrupt") {
                toast.warning("Network unstable — reconnecting…");
              }
            },
            onReconnected: () => {
              if (!mounted) return;
              localDropReasonRef.current = null;
              toast.success("Reconnected");
            },
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
    // Only start counting once BOTH peers are actually in the channel.
    // Previously the timer started as soon as the local Agora join completed,
    // which meant the caller's "Connected · mm:ss" began ticking while the
    // creator was still answering — making the two sides show different
    // elapsed times. Gating on `remoteJoined` keeps both sides in sync.
    if (!connected || !remoteJoined) return;
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
  }, [connected, remoteJoined]);

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
  // Server-resolved billing: a creator calling a regular user means the
  // CALLEE is the payer. We honour amPayerState whenever it has loaded.
  const isPayer = amPayerState ?? (callRoleRef.current !== "callee");
  const outOfFunds = connected && isPayer && totalSecondsLeft <= 0;
  const criticalTime = isPayer && perMin > 0 && totalSecondsLeft > 0 && totalSecondsLeft <= 60;

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
      endReasonRef.current = "coins_exhausted";
      window.setTimeout(() => {
        if (!endedRef.current) endCallNowRef.current();
      }, 900);
    }
    if (
      isPayer &&
      perMin > 0 &&
      totalSecondsLeft > 0 &&
      totalSecondsLeft <= 180 &&
      !lowTimeWarnedRef.current
    ) {
      lowTimeWarnedRef.current = true;
      toast.warning("3 minute se kam bache — call jaldi disconnect ho jayegi.", {
        duration: 8000,
        action: { label: "Recharge", onClick: () => setRechargeOpen(true) },
      });
    }

  }, [connected, outOfFunds, paused, isPayer, perMin, totalSecondsLeft]);

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

    const reason = peerLeaveReasonRef.current;

    // Network drop on the peer's side: Agora signals "timeout" (or unknown
    // when the remote SDK crashed without a clean leave). Keep the call up
    // for a grace window so they can reconnect; only end if they don't.
    if (reason === "timeout") {
      toast.warning("Peer disconnected — waiting for reconnect…", {
        duration: PEER_RECONNECT_GRACE_MS,
      });
      if (peerGraceTimerRef.current) clearTimeout(peerGraceTimerRef.current);
      peerGraceTimerRef.current = window.setTimeout(() => {
        peerGraceTimerRef.current = null;
        if (endedRef.current) return;
        toast.error("Peer didn't reconnect — ending call.");
        endReasonRef.current = "network";
        endCallNowRef.current();
      }, PEER_RECONNECT_GRACE_MS);
      return () => {
        if (peerGraceTimerRef.current) {
          clearTimeout(peerGraceTimerRef.current);
          peerGraceTimerRef.current = null;
        }
      };
    }

    // Intentional hangup ("quit") or role change → end immediately.
    toast.warning("Other person ended the call.");
    endReasonRef.current = "peer_left";
    const t = window.setTimeout(() => {
      if (!endedRef.current) endCallNowRef.current();
    }, 1200);
    return () => clearTimeout(t);
  }, [connected, remoteJoined]);

  // ---- Background / foreground reconnection -----------------------------
  // Mobile OSes routinely suspend WebRTC tracks when the tab/app is hidden.
  // Agora & 100ms SDKs auto-reconnect on resume, but the OS can also kill
  // the socket entirely. Strategy: when the app goes hidden mid-call we
  // remember the moment; when it comes back we give the SDK a grace window
  // to fire `onReconnected`. If it doesn't, we end the call with a clear
  // `background_lost` reason instead of leaving the user staring at a
  // frozen UI.
  const BG_RECONNECT_GRACE_MS = 15_000;
  const bgHiddenAtRef = useRef<number | null>(null);
  const bgGraceTimerRef = useRef<number | null>(null);
  const bgResumedClearTimerRef = useRef<number | null>(null);
  const [bgState, setBgState] = useState<null | "reconnecting" | "resumed" | "lost">(null);
  useEffect(() => {
    if (!connected) return;
    const onVisibility = () => {
      if (endedRef.current) return;
      if (document.visibilityState === "hidden") {
        bgHiddenAtRef.current = Date.now();
        return;
      }
      // Returned to foreground.
      const hiddenAt = bgHiddenAtRef.current;
      bgHiddenAtRef.current = null;
      if (hiddenAt == null) return;
      const awayMs = Date.now() - hiddenAt;

      // SDK reports a healthy session AND remote still present → just a
      // brief background trip; surface a soft "back online" hint and exit.
      if (!localDropReasonRef.current && remoteJoined) {
        if (awayMs > 4000) {
          setBgState("resumed");
          if (bgResumedClearTimerRef.current) clearTimeout(bgResumedClearTimerRef.current);
          bgResumedClearTimerRef.current = window.setTimeout(() => setBgState(null), 3500);
        }
        return;
      }

      // Otherwise: socket likely dropped while suspended. Give the SDK a
      // grace window to auto-reconnect. `onReconnected` clears
      // localDropReasonRef and `onRemoteJoined` flips remoteJoined back on
      // — both are checked when the timer fires.
      setBgState("reconnecting");
      if (bgGraceTimerRef.current) clearTimeout(bgGraceTimerRef.current);
      bgGraceTimerRef.current = window.setTimeout(() => {
        bgGraceTimerRef.current = null;
        if (endedRef.current) return;
        const healthy = !localDropReasonRef.current && remoteJoined;
        if (healthy) {
          setBgState("resumed");
          if (bgResumedClearTimerRef.current) clearTimeout(bgResumedClearTimerRef.current);
          bgResumedClearTimerRef.current = window.setTimeout(() => setBgState(null), 3500);
          return;
        }
        // Mark call as lost-due-to-background. We keep the banner visible
        // so the user understands why the call is ending; tapping "Return
        // to lobby" runs the standard end-call flow (cleanup + nav). If
        // they don't tap, we auto-end after a short window.
        setBgState("lost");
        endReasonRef.current = "background_lost";
        window.setTimeout(() => {
          if (!endedRef.current) endCallNowRef.current();
        }, 6000);
      }, BG_RECONNECT_GRACE_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (bgGraceTimerRef.current) {
        clearTimeout(bgGraceTimerRef.current);
        bgGraceTimerRef.current = null;
      }
      if (bgResumedClearTimerRef.current) {
        clearTimeout(bgResumedClearTimerRef.current);
        bgResumedClearTimerRef.current = null;
      }
    };
  }, [connected, remoteJoined]);

  // Clear the "reconnecting" banner the moment the SDK actually reconnects.
  useEffect(() => {
    if (bgState !== "reconnecting") return;
    if (!localDropReasonRef.current && remoteJoined) {
      setBgState("resumed");
      if (bgResumedClearTimerRef.current) clearTimeout(bgResumedClearTimerRef.current);
      bgResumedClearTimerRef.current = window.setTimeout(() => setBgState(null), 3500);
    }
  }, [bgState, remoteJoined, networkQ]);






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
    // Only the PAYER side reports usage to the server. The server also
    // re-checks this (returns "not-payer") but we short-circuit here to
    // avoid useless round-trips from the earner's tab.
    if (amPayerRef.current === false) return;
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

  // Liveness heartbeat every 15s — fires from BOTH caller and callee so the
  // backend can distinguish a real in-progress call from a ghost "accepted"
  // invite whose log never got an ended_at. Without this, the next caller
  // hits "this creator just picked up another call" against a dead session.
  const heartbeatFn = useServerFn(heartbeatCall);
  useEffect(() => {
    if (!connected) return;
    const ping = () => {
      const id = callLogIdRef.current;
      if (!id) return;
      heartbeatFn({ data: { callLogId: id } }).catch(() => { /* best-effort */ });
    };
    ping();
    const i = setInterval(ping, 15000);
    return () => clearInterval(i);
  }, [connected, heartbeatFn]);


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

  async function toggleMic() {
    const t = streamRef.current?.getAudioTracks()[0];
    const next = t ? !t.enabled : !muted;
    if (t) t.enabled = !next ? true : false;
    // Some SDKs publish their own track; also notify the session if available.
    const sess: any = sessionRef.current?.session;
    let sdkError: string | null = null;
    try {
      if (typeof sess?.setMicrophoneMuted === "function") await sess.setMicrophoneMuted(next);
      else if (typeof sess?.muteAudio === "function") await sess.muteAudio(next);
      else if (typeof sess?.setMuted === "function") await sess.setMuted(next);
    } catch (e: any) { sdkError = e?.message || String(e); }
    setMuted(next);
    toast.message(next ? "Microphone muted" : "Microphone unmuted");
    recordCallUiEvent({
      eventType: sdkError ? "ui_mute_blocked" : "ui_mute_toggled",
      callLogId: callLogIdRef.current,
      partnerUserId: userId,
      kind,
      ok: !sdkError,
      reason: sdkError ?? null,
      meta: { muted: next, hasTrack: !!t },
    });
  }
  function toggleCam() {
    const t = streamRef.current?.getVideoTracks()[0];
    if (t) { t.enabled = !t.enabled; setCamOff(!t.enabled); }
  }
  async function toggleSpeaker() {
    const next = !speakerOn;
    setSpeakerOn(next);
    const sess: any = sessionRef.current?.session;
    let sdkError: string | null = null;
    try {
      await sess?.setSpeakerMode?.(next);
    } catch (e: any) { sdkError = e?.message || String(e); }
    recordCallUiEvent({
      eventType: sdkError ? "ui_speaker_blocked" : "ui_speaker_toggled",
      callLogId: callLogIdRef.current,
      partnerUserId: userId,
      kind,
      ok: !sdkError,
      reason: sdkError ?? null,
      meta: { speakerOn: next },
    });
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
          endReason: endReasonRef.current,
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
  // Keep the ref pointing at the latest closure so auto-end effects work.
  endCallNowRef.current = confirmEndCall;



  const totalElapsed = sessionStartElapsedRef.current + elapsed;
  const mm = String(Math.floor(totalElapsed / 60)).padStart(2, "0");
  const ss = String(totalElapsed % 60).padStart(2, "0");

  // One-click end-to-end gift verification used by the debug overlay.
  // Picks the cheapest affordable gift, snapshots UI + server balances,
  // sends the gift, then re-reads the server wallet and asserts:
  //   serverPost == serverPre - cost
  //   sendGift.newBalance == serverPost
  //   UI coinsLeft drops by cost (≈ within 1 to allow a tick boundary)
  async function runGiftE2E() {
    if (e2eRunning) return;
    setE2eRunning(true);
    const t0 = Date.now();
    const tag = "[gift-e2e]";
    try {
      // eslint-disable-next-line no-console
      console.log(`${tag} start`, { coinsLeftUI: coinsLeft, coinsAvail, coinsConsumed });
      const [catalog, walletPre] = await Promise.all([listGiftsFn(), getWalletFn()]);
      const serverPre = walletPre.balance;
      const uiCoinsLeftPre = coinsLeft;
      const affordable = (catalog ?? [])
        .map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, cost: Number(g.coin_cost) }))
        .filter((g) => g.cost > 0 && g.cost <= Math.min(serverPre, uiCoinsLeftPre))
        .sort((a, b) => a.cost - b.cost);
      if (affordable.length === 0) {
        const msg = "No affordable gift in catalog vs current balance";
        console.warn(`${tag} skip`, { serverPre, uiCoinsLeftPre, catalog: catalog?.length });
        setE2eResult({ ok: false, summary: msg, details: { serverPre, uiCoinsLeftPre }, at: Date.now() });
        toast.error(`Gift E2E: ${msg}`);
        return;
      }
      const pick = affordable[0];
      console.log(`${tag} picked`, pick);
      const requestedAt = Date.now();
      const sendRes = await sendGiftFn({
        data: { giftId: pick.id, receiverId: userId, callLogId: callLogIdRef.current ?? null },
      });
      const serverRespondedAt = Date.now();
      // Reset UI baseline like normal flow does so coinsLeft reflects the server truth.
      setCoinStart(sendRes.newBalance + coinsConsumed);
      // Re-read server wallet to independently confirm the debit landed.
      const walletPost = await getWalletFn();
      const uiRefreshedAt = Date.now();
      const serverPost = walletPost.balance;
      const expectedServer = serverPre - pick.cost;
      const uiCoinsLeftPost = Math.max(0, sendRes.newBalance - coinsConsumed);

      const checks = {
        sendOk: sendRes.ok === true,
        serverDebitedCorrectly: serverPost === expectedServer,
        returnedBalanceMatchesServer: sendRes.newBalance === serverPost,
        preBalanceMatches: sendRes.preBalance === serverPre,
        uiDroppedByCost: Math.abs((uiCoinsLeftPre - uiCoinsLeftPost) - pick.cost) <= 1,
      };
      const allOk = Object.values(checks).every(Boolean);
      const details = {
        gift: pick,
        serverPre,
        serverPost,
        expectedServer,
        returnedNewBalance: sendRes.newBalance,
        returnedPreBalance: sendRes.preBalance,
        uiCoinsLeftPre,
        uiCoinsLeftPost,
        roundtripMs: serverRespondedAt - requestedAt,
        serverProcessedMs: sendRes.serverProcessedMs,
        verifyMs: uiRefreshedAt - serverRespondedAt,
        totalMs: uiRefreshedAt - t0,
        checks,
      };
      // eslint-disable-next-line no-console
      console.log(`${tag} ${allOk ? "PASS" : "FAIL"}`, details);

      // Surface in the existing GIFT TIMELINE overlay too.
      setGiftEvents((prev) => [{
        giftId: pick.id,
        giftName: `E2E ${pick.name}`,
        giftEmoji: pick.emoji,
        cost: pick.cost,
        requestedAt,
        serverRespondedAt,
        uiRefreshedAt,
        preBalance: sendRes.preBalance ?? serverPre,
        newBalance: sendRes.newBalance,
        serverProcessedMs: sendRes.serverProcessedMs,
        receiverPreBalance: sendRes.receiverPreBalance,
        receiverNewBalance: sendRes.receiverNewBalance,
        ok: allOk,
        error: allOk ? undefined : "verification failed — see console",
      }, ...prev].slice(0, 8));

      setE2eResult({
        ok: allOk,
        summary: allOk
          ? `PASS · ${pick.emoji} ${pick.name} · -${pick.cost} · srv ${serverPre}→${serverPost}`
          : `FAIL · see console for checks`,
        details,
        at: Date.now(),
      });
      toast[allOk ? "success" : "error"](`Gift E2E ${allOk ? "passed" : "failed"} — check console`);
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.error(`${tag} ERROR`, msg);
      setE2eResult({ ok: false, summary: `ERROR · ${msg}`, details: { error: msg }, at: Date.now() });
      toast.error(`Gift E2E error: ${msg}`);
    } finally {
      setE2eRunning(false);
    }
  }

  // Failure-path E2E suite. Verifies that sendGift correctly REJECTS:
  //   1) insufficient coins   — sender balance < gift cost
  //   2) invalid receiver     — self-send (proxy for receiver-side rejection)
  //   3) duplicate send       — two parallel sends must not double-debit beyond cost*2,
  //                             and the wallet must remain consistent (no negative, no skipped debit)
  // For each case we log PASS when the expected failure/behavior is observed,
  // FAIL when the server unexpectedly accepts a bad request or state diverges.
  async function runGiftE2EFailures() {
    if (e2eRunning) return;
    setE2eRunning(true);
    const tag = "[gift-e2e-fail]";
    const t0 = Date.now();
    const results: Array<{ name: string; pass: boolean; note: string; detail: Record<string, unknown> }> = [];

    const safeSend = async (payload: { giftId: string; receiverId: string }) => {
      try {
        const r = await sendGiftFn({ data: { ...payload, callLogId: callLogIdRef.current ?? null } });
        return { ok: true as const, res: r };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    };

    try {
      const [catalog, walletPre] = await Promise.all([listGiftsFn(), getWalletFn()]);
      const serverPre = walletPre.balance;
      const sorted = (catalog ?? [])
        .map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, cost: Number(g.coin_cost) }))
        .filter((g) => g.cost > 0)
        .sort((a, b) => a.cost - b.cost);
      console.log(`${tag} start`, { serverPre, catalogSize: sorted.length });

      // ── Case 1: insufficient coins ───────────────────────────────────────────
      const expensive = [...sorted].reverse().find((g) => g.cost > serverPre);
      if (!expensive) {
        results.push({
          name: "insufficient_coins",
          pass: false,
          note: "skipped — no gift in catalog costs more than current balance",
          detail: { serverPre, maxCost: sorted.at(-1)?.cost ?? 0 },
        });
      } else {
        const r = await safeSend({ giftId: expensive.id, receiverId: userId });
        const rejected = !r.ok && /need|coin|insufficient|balance/i.test(r.ok === false ? r.error : "");
        results.push({
          name: "insufficient_coins",
          pass: rejected,
          note: r.ok ? "server accepted overspend (FAIL)" : `rejected: ${r.error}`,
          detail: { gift: expensive, serverPre, response: r },
        });
      }

      // ── Case 2: invalid receiver (self-send) ─────────────────────────────────
      const cheap = sorted[0];
      if (!cheap) {
        results.push({ name: "invalid_receiver", pass: false, note: "skipped — empty gift catalog", detail: {} });
      } else {
        const r = await safeSend({ giftId: cheap.id, receiverId: myId || userId });
        // If myId is not the receiver of the call (it shouldn't be, userId is the peer), use a synthetic self id.
        const isSelf = (myId || "") === userId;
        const tryId = isSelf ? userId : myId;
        const r2 = isSelf ? r : await safeSend({ giftId: cheap.id, receiverId: tryId });
        const rejected = !r2.ok && /yourself|self/i.test(r2.ok === false ? r2.error : "");
        results.push({
          name: "invalid_receiver",
          pass: rejected,
          note: r2.ok ? "server accepted self-send (FAIL)" : `rejected: ${r2.error}`,
          detail: { gift: cheap, attemptedReceiver: tryId, response: r2 },
        });
      }

      // ── Case 3: duplicate / concurrent send ──────────────────────────────────
      // We need enough balance to cover the cheapest gift twice; otherwise one of the two
      // is expected to fail with insufficient funds — that's still a valid consistency check.
      const walletBeforeDup = await getWalletFn();
      const dupPre = walletBeforeDup.balance;
      if (!cheap) {
        results.push({ name: "duplicate_send", pass: false, note: "skipped — empty gift catalog", detail: {} });
      } else if (dupPre < cheap.cost) {
        results.push({
          name: "duplicate_send",
          pass: false,
          note: "skipped — balance too low for even one cheap gift",
          detail: { dupPre, cheapCost: cheap.cost },
        });
      } else {
        const [a, b] = await Promise.all([
          safeSend({ giftId: cheap.id, receiverId: userId }),
          safeSend({ giftId: cheap.id, receiverId: userId }),
        ]);
        const walletAfterDup = await getWalletFn();
        const dupPost = walletAfterDup.balance;
        const successCount = [a, b].filter((r) => r.ok).length;
        const expectedSpend = successCount * cheap.cost;
        const actualSpend = dupPre - dupPost;
        const consistent = actualSpend === expectedSpend && dupPost >= 0;
        // We accept any successCount (server may serialize both); we only FAIL when the
        // wallet ledger drifts from the count of successful sends, i.e. silent double-debit
        // or a "successful" send that didn't actually debit.
        results.push({
          name: "duplicate_send",
          pass: consistent,
          note: consistent
            ? `consistent: ${successCount}/2 succeeded, spent ${actualSpend}`
            : `LEDGER DRIFT: ${successCount} succeeded but spent ${actualSpend} (expected ${expectedSpend})`,
          detail: { cheap, dupPre, dupPost, a, b, successCount, expectedSpend, actualSpend },
        });
        // Refresh UI baseline so coinsLeft tracks server reality after the dup test.
        setCoinStart(dupPost + coinsConsumed);
      }

      const allPass = results.every((r) => r.pass);
      const summary = results
        .map((r) => `${r.pass ? "✓" : "✗"} ${r.name}`)
        .join(" · ");
      console.log(`${tag} ${allPass ? "ALL PASS" : "SOME FAIL"}`, {
        totalMs: Date.now() - t0,
        results,
      });
      setE2eResult({
        ok: allPass,
        summary: `Failures: ${summary}`,
        details: { results },
        at: Date.now(),
      });
      toast[allPass ? "success" : "error"](
        `Failure E2E ${allPass ? "passed" : "failed"} — check console`
      );
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${tag} ERROR`, msg);
      setE2eResult({ ok: false, summary: `ERROR · ${msg}`, details: { error: msg, results }, at: Date.now() });
      toast.error(`Failure E2E error: ${msg}`);
    } finally {
      setE2eRunning(false);
    }
  }

  // Call-usage E2E. Verifies that a single applyCallUsage flush:
  //   * debits ONLY the caller's wallet by the requested coin delta
  //   * credits the callee's wallet by floor(delta * CREATOR_EARN_RATIO=0.5)
  //   * leaves the other party's wallet untouched by the inverse op
  // Runs only when a live call_log exists. Uses a unique idempotency key
  // and a small bump (default 10 coins) so it can run mid-call without
  // double-billing — the live billing loop's next flush will see no delta
  // until its own counters surpass the new stored total.
  async function runCallUsageE2E() {
    if (e2eRunning) return;
    const callLogId = callLogIdRef.current;
    const tag = "[call-usage-e2e]";
    if (!callLogId) {
      toast.error("Call usage E2E: no active call log yet");
      return;
    }
    setE2eRunning(true);
    const t0 = Date.now();
    try {
      const peerPre = await getPeerWalletsFn({ data: { callLogId } });
      if (!peerPre.ok) {
        const msg = `peer wallets unavailable: ${peerPre.reason}`;
        setCallE2eResult({ ok: false, summary: `FAIL · ${msg}`, details: { peerPre }, at: Date.now() });
        toast.error(`Call usage E2E: ${msg}`);
        return;
      }
      // Only the caller side may run this — applyCallUsage authorizes as caller.
      if (peerPre.callerId !== myId) {
        const msg = "only the caller side can run this test";
        setCallE2eResult({ ok: false, summary: `SKIP · ${msg}`, details: { peerPre, myId }, at: Date.now() });
        toast.message(`Call usage E2E skipped — ${msg}`);
        return;
      }
      const BUMP = 10; // coins to charge in this synthetic flush
      const EARN_RATIO = 0.5;
      const expectedCallerDelta = BUMP;
      const expectedCalleeEarn = Math.floor(BUMP * EARN_RATIO);
      if (peerPre.callerBalance < BUMP) {
        const msg = `caller balance ${peerPre.callerBalance} < ${BUMP}`;
        setCallE2eResult({ ok: false, summary: `SKIP · ${msg}`, details: { peerPre }, at: Date.now() });
        toast.message(`Call usage E2E skipped — ${msg}`);
        return;
      }

      const probeKey = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const totalCoinsToSend = peerPre.storedCoinsSpent + BUMP;
      const elapsedToSend = peerPre.storedDuration + 1;
      console.log(`${tag} start`, {
        callLogId, probeKey, BUMP, expectedCalleeEarn,
        callerPre: peerPre.callerBalance, calleePre: peerPre.calleeBalance,
        storedCoinsSpent: peerPre.storedCoinsSpent,
      });

      const applyRes = await applyUsageFn({
        data: {
          callLogId,
          idempotencyKey: probeKey,
          totalFreeSeconds: peerPre.storedFreeUsed,
          totalCoins: totalCoinsToSend,
          elapsedSeconds: elapsedToSend,
        },
      });
      const appliedAt = Date.now();
      // Important: keep the live billing loop in sync so its next flush
      // doesn't try to re-bill the same coins we just consumed via the test.
      syncedCoinsRef.current = Math.max(syncedCoinsRef.current, totalCoinsToSend);

      const peerPost = await getPeerWalletsFn({ data: { callLogId } });
      if (!peerPost.ok) throw new Error(`post peer read failed: ${peerPost.reason}`);

      const callerDelta = peerPre.callerBalance - peerPost.callerBalance;
      const calleeDelta = peerPost.calleeBalance - peerPre.calleeBalance;

      const checks = {
        applyOk: applyRes && (applyRes as { ok?: boolean }).ok === true,
        callerDebitedExact: callerDelta === expectedCallerDelta,
        calleeCreditedExact: calleeDelta === expectedCalleeEarn,
        callerNotCredited: callerDelta >= 0,
        calleeNotDebited: calleeDelta >= 0,
        storedCoinsAdvanced: peerPost.storedCoinsSpent === totalCoinsToSend,
      };
      const allOk = Object.values(checks).every(Boolean);
      const details = {
        probeKey,
        bump: BUMP,
        earnRatio: EARN_RATIO,
        expectedCallerDelta,
        expectedCalleeEarn,
        callerPre: peerPre.callerBalance,
        callerPost: peerPost.callerBalance,
        callerDelta,
        calleePre: peerPre.calleeBalance,
        calleePost: peerPost.calleeBalance,
        calleeDelta,
        storedCoinsPre: peerPre.storedCoinsSpent,
        storedCoinsPost: peerPost.storedCoinsSpent,
        applyResponse: applyRes,
        applyMs: appliedAt - t0,
        totalMs: Date.now() - t0,
        checks,
      };
      console.log(`${tag} ${allOk ? "PASS" : "FAIL"}`, details);
      setCallE2eResult({
        ok: allOk,
        summary: allOk
          ? `PASS · caller -${callerDelta} · creator +${calleeDelta}`
          : `FAIL · caller Δ${callerDelta} (exp -${expectedCallerDelta}) · creator Δ${calleeDelta} (exp +${expectedCalleeEarn})`,
        details,
        at: Date.now(),
      });
      toast[allOk ? "success" : "error"](`Call usage E2E ${allOk ? "passed" : "failed"} — check console`);
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${tag} ERROR`, msg);
      setCallE2eResult({ ok: false, summary: `ERROR · ${msg}`, details: { error: msg }, at: Date.now() });
      toast.error(`Call usage E2E error: ${msg}`);
    } finally {
      setE2eRunning(false);
    }
  }









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
    // Fullscreen call surface — bypasses AppShell on purpose so the bottom
    // nav and top header are hidden for the duration of the call. The user
    // cannot navigate to any other screen until they explicitly end the
    // call (or open the in-call peer profile sheet, which keeps the call
    // session mounted).
    <div data-testid="call-fullscreen" data-call-surface="1" className="fixed inset-0 z-[60] bg-black flex flex-col overflow-y-auto safe-top safe-bottom">
      <CallPointerSafeguardMount />
      <SafetyTipOverlay />

      <Card className="glass overflow-hidden p-0 flex-1 rounded-none border-0">
        {paused && (
          <div className="bg-amber-500/90 text-black text-xs font-semibold text-center px-3 py-2">
            Paused — another call window is now active. Close this tab or reload to take over.
          </div>
        )}
        {bgState && (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-center gap-3 px-3 py-2 text-xs font-semibold ${
              bgState === "reconnecting"
                ? "bg-amber-500/90 text-black"
                : bgState === "resumed"
                ? "bg-emerald-500/90 text-black"
                : "bg-destructive text-destructive-foreground"
            }`}
          >
            <span
              aria-hidden
              className={`inline-block size-2 rounded-full ${
                bgState === "reconnecting"
                  ? "bg-black animate-pulse"
                  : bgState === "resumed"
                  ? "bg-black"
                  : "bg-white"
              }`}
            />
            <span className="flex-1 min-w-0">
              {bgState === "reconnecting" &&
                "Reconnecting call after returning from background…"}
              {bgState === "resumed" && "Call resumed — you're back online."}
              {bgState === "lost" &&
                "Connection lost while the app was in background. Ending call."}
            </span>
            {bgState === "lost" && (
              <button
                type="button"
                onClick={() => {
                  if (!endedRef.current) endCallNowRef.current();
                  navigate({ to: "/connect" });
                }}
                className="rounded-md bg-white/95 text-destructive px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
              >
                Return to lobby
              </button>
            )}
          </div>
        )}
        <div className="relative aspect-[3/4] sm:aspect-video bg-black flex items-center justify-center">

          {kind === "video" ? (
            <>
              {/* Remote peer fills the frame when joined (Agora). Local preview moves to a picture-in-picture tile. */}
              <div
                ref={remoteContainerRef}
                className={`absolute inset-0 size-full bg-black ${remoteJoined ? "block" : "hidden"} [&_video]:size-full [&_video]:object-contain [&>div]:size-full`}
              />
              <video
                ref={videoRef}
                className={
                  remoteJoined
                    ? `absolute bottom-24 right-3 w-24 h-32 sm:w-28 sm:h-36 object-cover rounded-lg border-2 border-white/50 z-10 bg-black ${mirrorSelf ? "-scale-x-100" : ""}`
                    : `absolute inset-0 size-full object-contain bg-black ${mirrorSelf ? "-scale-x-100" : ""}`
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
              {acceptRetry
                ? `Reconnecting… (retry ${acceptRetry.attempt}/${acceptRetry.max})`
                : connected && remoteJoined
                  ? `Connected · ${mm}:${ss}`
                  : (connected ? "Ringing…" : "Connecting…")}
              {provider === "agora" && networkQ > 0 && (
                <NetworkBars q={networkQ} />
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPeerProfileOpen(true)}
                className="px-2.5 py-1 rounded-full bg-black/50 text-xs font-medium flex items-center gap-1 hover:bg-black/70 active:scale-95 transition"
                aria-label="View profile"
                title="View profile (call stays connected)"
              >
                <UserCircle2 className="size-3.5" /> Profile
              </button>
              <div className="px-2.5 py-1 rounded-full bg-coin/80 text-xs font-semibold flex items-center gap-1">
                <Coins className="size-3" /> {perMin} / min
              </div>
            </div>
          </div>
          {/* Low-time warning — escalates in last 60s */}
          {isPayer && perMin > 0 && totalSecondsLeft > 0 && totalSecondsLeft <= 180 && (
            (() => {
              const critical = totalSecondsLeft <= 60;
              const mm = String(Math.floor(totalSecondsLeft / 60)).padStart(2, "0");
              const ss = String(totalSecondsLeft % 60).padStart(2, "0");
              return (
                <div
                  className={`absolute left-3 right-3 rounded-2xl shadow-2xl backdrop-blur animate-pulse ${
                    critical
                      ? "top-1/2 -translate-y-1/2 bg-destructive text-destructive-foreground p-5 ring-4 ring-destructive-foreground/30"
                      : "top-12 bg-destructive/90 text-destructive-foreground px-3 py-2"
                  }`}
                  role="alert"
                  aria-live="assertive"
                >
                  {critical ? (
                    <div className="flex flex-col items-center gap-3 text-center">
                      <div className="text-[11px] uppercase tracking-widest opacity-90">Call ending soon</div>
                      <div className="text-5xl font-bold tabular-nums leading-none">
                        {mm}:{ss}
                      </div>
                      <div className="grid grid-cols-2 gap-2 w-full text-[12px] font-medium">
                        <div className="rounded-lg bg-black/25 px-2 py-1.5">
                          <div className="opacity-80">Coins left</div>
                          <div className="text-base font-bold tabular-nums">{coinsLeft}</div>
                        </div>
                        <div className="rounded-lg bg-black/25 px-2 py-1.5">
                          <div className="opacity-80">Burn rate</div>
                          <div className="text-base font-bold tabular-nums">{perMin}/min</div>
                        </div>
                      </div>
                      <div className="text-[12px] opacity-95">
                        Coins khatam hote hi call disconnect ho jayegi. Continue karne ke liye abhi recharge karein.
                      </div>
                      <Button
                        size="lg"
                        variant="secondary"
                        onClick={() => setRechargeOpen(true)}
                        className="w-full font-semibold"
                      >
                        <Coins className="size-4 mr-2" /> Recharge now
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12px] leading-tight">
                        <div className="font-semibold">
                          Sirf {mm}:{ss} bache · {coinsLeft} coins
                        </div>
                        <div className="opacity-90">Call timeout pe disconnect ho jayegi. Continue ke liye recharge karein.</div>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => setRechargeOpen(true)} className="shrink-0">
                        <Coins className="size-3 mr-1" /> Recharge
                      </Button>
                    </div>
                  )}
                </div>
              );
            })()
          )}
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
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold backdrop-blur transition-colors ${
                  isPayer && totalSecondsLeft > 0 && totalSecondsLeft <= 180
                    ? "bg-destructive text-destructive-foreground ring-2 ring-destructive-foreground/40 animate-pulse"
                    : !usingFree && coinsLeft < perMin
                      ? "bg-destructive/80"
                      : "bg-black/50"
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
          <Button
            size="icon"
            variant={muted ? "destructive" : "secondary"}
            onClick={toggleMic}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            title={muted ? "Muted — tap to unmute" : "Tap to mute"}
          >
            {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </Button>
          {kind === "video" && (
            <Button
              size="icon"
              variant={camOff ? "destructive" : "secondary"}
              onClick={toggleCam}
              disabled={criticalTime}
              title={criticalTime ? "Disabled — last 60 seconds" : undefined}
            >
              {camOff ? <VideoOff className="size-5" /> : <VideoIcon className="size-5" />}
            </Button>
          )}
          {kind === "video" && (
            <Button
              size="icon"
              variant={mirrorSelf ? "default" : "secondary"}
              onClick={toggleMirror}
              aria-label={mirrorSelf ? "Self-view mirrored" : "Self-view not mirrored"}
              title={mirrorSelf ? "Mirror on — tap to turn off" : "Mirror off — tap to turn on"}
            >
              <FlipHorizontal2 className="size-5" />
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
            onClick={() => {
              setGiftOpen(true);
              recordCallUiEvent({
                eventType: "ui_gift_open",
                callLogId: callLogIdRef.current,
                partnerUserId: userId,
                kind,
                ok: true,
                meta: { connected, criticalTime },
              });
            }}
            disabled={!connected || criticalTime}
            aria-label="Send gift"
            title={criticalTime ? "Disabled — last 60 seconds" : undefined}
            className="relative"
          >
            <Gift className="size-5 text-pink-500" />
          </Button>
          <Button
            data-testid="end-call-btn"
            size="icon"
            variant="destructive"
            onClick={() => {
              setConfirmEnd(true);
              recordCallUiEvent({
                eventType: "ui_end_call_clicked",
                callLogId: callLogIdRef.current,
                partnerUserId: userId,
                kind,
                ok: true,
                meta: { source: "controls-bar" },
              });
            }}
          >
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
        balance={coinsLeft}
        onSent={(newBalance) => {
          // Reset baseline so the live coinsLeft reflects the post-gift balance
          // without waiting for the next ['me'] refetch.
          setCoinStart(newBalance + coinsConsumed);
          qc.invalidateQueries({ queryKey: ["me"] });
          qc.invalidateQueries({ queryKey: ["wallet"] });
        }}
        onLowBalance={() => {
          setGiftOpen(false);
          setRechargeOpen(true);
        }}
        onEvent={(ev) => {
          // End-to-end trace: surface in the call-screen debug overlay too.
          console.log("[call:gift-event]", {
            ok: ev.ok,
            cost: ev.cost,
            preBalance: ev.preBalance,
            newBalance: ev.newBalance,
            coinsLeftBefore: coinsLeft,
            serverProcessedMs: ev.serverProcessedMs,
            roundtripMs: ev.serverRespondedAt - ev.requestedAt,
            totalMs: ev.uiRefreshedAt - ev.requestedAt,
            error: ev.error,
          });
          setGiftEvents((prev) => [ev, ...prev].slice(0, 8));
        }}
      />



      <InCallPeerProfileSheet
        userId={userId}
        open={peerProfileOpen}
        onOpenChange={setPeerProfileOpen}
        inCall
      />


      <AlertDialog
        open={confirmEnd}
        onOpenChange={(v) => {
          setConfirmEnd(v);
          if (!v) setEndStep(1); // reset two-step state when dialog closes
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {endStep === 1 ? "End this call?" : "Are you really sure?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {endStep === 1 ? (
                <>
                  You will be charged for {Math.max(1, Math.ceil(elapsed / 60))} minute(s) at {perMin} coins/min.
                  Tap “End call” to continue — we will ask once more before disconnecting.
                </>
              ) : (
                <>
                  This will disconnect the call immediately. Tap “Yes, disconnect now” to hang up,
                  or “Stay on call” to keep talking.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="end-stay" onClick={() => setEndStep(1)}>Stay on call</AlertDialogCancel>
            {endStep === 1 ? (
              <Button
                data-testid="end-confirm-step1"
                onClick={() => setEndStep(2)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                End call
              </Button>
            ) : (
              <AlertDialogAction
                data-testid="end-confirm-step2"
                onClick={() => { setEndStep(1); confirmEndCall(); }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Yes, disconnect now
              </AlertDialogAction>
            )}
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
        onRecharged={(newBalance, meta) => {
          // Re-baseline the live ledger so the user keeps talking with the
          // newly added coins (without resetting elapsed time).
          const baselinedAt = Date.now();
          setCoinStart(newBalance + coinsConsumed);
          outOfFundsTriggeredRef.current = false;
          lowTimeWarnedRef.current = false;
          qc.invalidateQueries({ queryKey: ["me"] });
          if (meta) {
            setRechargeEvents((prev) =>
              [{ ...meta, uiRefreshedAt: baselinedAt }, ...prev].slice(0, 5),
            );
          }
          if (newBalance >= CASE_GENERATION_COIN_COST) {
            toast.success("Coins added — call continues. Tap Host Mystery Case anytime.");
          } else {
            toast.success("Coins added — call continues.");
          }
        }}
      />

      {/* Dev/debug overlay — toggle with ?debug=1 in URL or localStorage.callDebug=1 */}
      {(() => {
        let show = false;
        try {
          show =
            new URLSearchParams(window.location.search).get("debug") === "1" ||
            localStorage.getItem("callDebug") === "1";
        } catch { /* ignore */ }
        if (!show) return null;
        const mm = String(Math.floor(totalSecondsLeft / 60)).padStart(2, "0");
        const ss = String(totalSecondsLeft % 60).padStart(2, "0");
        return (
          <div
            className="fixed bottom-2 left-2 z-[9999] rounded-md border border-white/20 bg-black/80 px-2 py-1.5 font-mono text-[10px] leading-tight text-emerald-300 shadow-lg backdrop-blur-sm"
            style={{ pointerEvents: "none" }}
          >
            <div className="text-white/70">DEBUG · {kind} · {isPayer ? "payer" : "callee"}</div>
            <div>perMin: <span className="text-white">{perMin}</span></div>
            <div>elapsed: <span className="text-white">{elapsed}s</span></div>
            <div>freeAvail: <span className="text-white">{freeAvail}</span> · freeLeft: <span className="text-white">{freeLeftSec}</span></div>
            <div>coinsAvail: <span className="text-white">{coinsAvail}</span></div>
            <div>coinsConsumed: <span className="text-white">{coinsConsumed}</span></div>
            <div>coinsLeft: <span className="text-amber-300">{coinsLeft}</span></div>
            <div>coinSecondsLeft: <span className="text-amber-300">{coinSecondsLeft}s</span></div>
            <div>totalSecondsLeft: <span className="text-emerald-200">{totalSecondsLeft}s ({mm}:{ss})</span></div>
            <div>flags: <span className="text-white">{usingFree ? "FREE " : ""}{criticalTime ? "CRIT " : ""}{outOfFunds ? "OOF" : ""}</span></div>
          </div>
        );
      })()}

      {/* Gift E2E test trigger — clickable; same debug gate */}
      {(() => {
        let show = false;
        try {
          show =
            new URLSearchParams(window.location.search).get("debug") === "1" ||
            localStorage.getItem("callDebug") === "1";
        } catch { /* ignore */ }
        if (!show) return null;
        return (
          <div className="fixed bottom-2 left-1/2 z-[9999] -translate-x-1/2 rounded-md border border-white/20 bg-black/85 px-2 py-1.5 font-mono text-[10px] text-white shadow-lg backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={e2eRunning}
                onClick={runGiftE2E}
                className="rounded bg-fuchsia-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-50"
              >
                {e2eRunning ? "Running…" : "Run gift E2E"}
              </button>
              <button
                type="button"
                disabled={e2eRunning}
                onClick={runGiftE2EFailures}
                className="rounded bg-amber-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {e2eRunning ? "Running…" : "Run failure E2E"}
              </button>
              <button
                type="button"
                disabled={e2eRunning}
                onClick={runCallUsageE2E}
                className="rounded bg-sky-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {e2eRunning ? "Running…" : "Run call usage E2E"}
              </button>
              {e2eResult && (
                <span className={e2eResult.ok ? "text-emerald-300" : "text-red-300"}>
                  {e2eResult.summary}
                </span>
              )}
              {callE2eResult && (
                <span className={callE2eResult.ok ? "text-sky-300" : "text-red-300"}>
                  {callE2eResult.summary}
                </span>
              )}
            </div>
          </div>
        );
      })()}



      {/* Recharge timeline overlay — gated by same debug flag */}
      {(() => {
        let show = false;
        try {
          show =
            new URLSearchParams(window.location.search).get("debug") === "1" ||
            localStorage.getItem("callDebug") === "1";
        } catch { /* ignore */ }
        if (!show || rechargeEvents.length === 0) return null;
        const fmt = (t: number) => {
          const d = new Date(t);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
        };
        return (
          <div className="fixed bottom-2 right-2 z-[9999] max-h-[60vh] w-[320px] overflow-y-auto rounded-md border border-white/20 bg-black/80 px-2 py-1.5 font-mono text-[10px] leading-tight text-sky-200 shadow-lg backdrop-blur-sm">
            <div className="mb-1 flex items-center justify-between text-white/70">
              <span>RECHARGE TIMELINE</span>
              <button
                type="button"
                className="text-white/60 hover:text-white"
                onClick={() => setRechargeEvents([])}
              >
                clear
              </button>
            </div>
            {rechargeEvents.map((ev, i) => {
              const tServer = ev.serverRespondedAt - ev.requestedAt;
              const tRefresh = ev.uiRefreshedAt - ev.serverRespondedAt;
              const tTotal = ev.uiRefreshedAt - ev.requestedAt;
              return (
                <div key={i} className="mb-1.5 border-t border-white/10 pt-1 first:border-0 first:pt-0">
                  <div className="text-white/80">
                    #{rechargeEvents.length - i} · {ev.source} · plan <span className="text-white">{ev.planId.slice(0, 8)}</span>
                  </div>
                  {ev.orderId && (
                    <div>order: <span className="text-white break-all">{ev.orderId}</span></div>
                  )}
                  {ev.paymentId && (
                    <div>payment: <span className="text-white break-all">{ev.paymentId}</span></div>
                  )}
                  <div>requested: <span className="text-white">{fmt(ev.requestedAt)}</span></div>
                  <div>server credit: <span className="text-white">{fmt(ev.serverRespondedAt)}</span> <span className="text-emerald-300">(+{tServer}ms)</span></div>
                  <div>ui refresh: <span className="text-white">{fmt(ev.uiRefreshedAt)}</span> <span className="text-emerald-300">(+{tRefresh}ms)</span></div>
                  <div className="text-amber-300">total: {tTotal}ms · +{ev.added}{ev.bonus > 0 ? ` (+${ev.bonus} bonus)` : ""} → bal {ev.newBalance}</div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Gift send timeline overlay — same debug gate */}
      {(() => {
        let show = false;
        try {
          show =
            new URLSearchParams(window.location.search).get("debug") === "1" ||
            localStorage.getItem("callDebug") === "1";
        } catch { /* ignore */ }
        if (!show || giftEvents.length === 0) return null;
        const fmt = (t: number) => {
          const d = new Date(t);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
        };
        return (
          <div className="fixed top-2 right-2 z-[9999] max-h-[60vh] w-[320px] overflow-y-auto rounded-md border border-white/20 bg-black/80 px-2 py-1.5 font-mono text-[10px] leading-tight text-fuchsia-200 shadow-lg backdrop-blur-sm">
            <div className="mb-1 flex items-center justify-between text-white/70">
              <span>GIFT TIMELINE</span>
              <button
                type="button"
                className="text-white/60 hover:text-white"
                onClick={() => setGiftEvents([])}
              >
                clear
              </button>
            </div>
            {giftEvents.map((ev, i) => {
              const tServer = ev.serverRespondedAt - ev.requestedAt;
              const tRefresh = ev.uiRefreshedAt - ev.serverRespondedAt;
              const tTotal = ev.uiRefreshedAt - ev.requestedAt;
              return (
                <div key={i} className="mb-1.5 border-t border-white/10 pt-1 first:border-0 first:pt-0">
                  <div className={ev.ok ? "text-white/80" : "text-red-300"}>
                    #{giftEvents.length - i} · {ev.giftEmoji} {ev.giftName} · {ev.ok ? "OK" : "FAIL"}
                  </div>
                  <div>cost: <span className="text-white">{ev.cost}</span> · pre→post: <span className="text-white">{ev.preBalance}</span>→<span className="text-amber-300">{ev.newBalance}</span></div>
                  {ev.receiverPreBalance !== undefined && (
                    <div>receiver: <span className="text-white">{ev.receiverPreBalance}</span>→<span className="text-emerald-300">{ev.receiverNewBalance}</span></div>
                  )}
                  <div>requested: <span className="text-white">{fmt(ev.requestedAt)}</span></div>
                  <div>server resp: <span className="text-white">{fmt(ev.serverRespondedAt)}</span> <span className="text-emerald-300">(+{tServer}ms{ev.serverProcessedMs !== undefined ? ` · srv ${ev.serverProcessedMs}ms` : ""})</span></div>
                  <div>ui refresh: <span className="text-white">{fmt(ev.uiRefreshedAt)}</span> <span className="text-emerald-300">(+{tRefresh}ms)</span></div>
                  <div className="text-amber-300">total: {tTotal}ms</div>
                  {ev.error && <div className="text-red-300">err: {ev.error}</div>}
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>




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

/**
 * Tiny child component that activates the call-pointer safeguard for as long
 * as the call surface is mounted. Lives as a child so the hook only runs on
 * the real call route (not on every CallScreen render of unrelated panels).
 */
function CallPointerSafeguardMount() {
  useCallPointerSafeguard(true);
  return null;
}



/**
 * Headless visual contract used by the Call Fullscreen E2E.
 *
 * Mounts the same fullscreen container + the real three-click end-call
 * AlertDialog so the iframe-driven E2E can assert: (a) no AppShell chrome
 * leaks into the call surface, (b) the end-call button opens a two-step
 * confirmation, and (c) the surface refuses to leave the call route while
 * the dialog is active. Skips Agora / billing / invite effects on purpose.
 */
export function CallFullscreenE2EMock() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [ended, setEnded] = useState(false);

  // Block back-navigation just like the real call screen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.history.pushState({ inCallE2E: true }, "");
    const onPop = () => {
      window.history.pushState({ inCallE2E: true }, "");
      setOpen(true);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div
      data-testid="call-fullscreen"
      data-e2e-ready="1"
      data-e2e-ended={ended ? "1" : "0"}
      className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-end p-6 safe-top safe-bottom"
    >
      <div className="text-white/80 text-sm mb-4">Call E2E dry-run</div>
      <Button
        data-testid="end-call-btn"
        size="lg"
        variant="destructive"
        onClick={() => setOpen(true)}
      >
        End
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) setStep(1); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {step === 1 ? "End this call?" : "Are you really sure?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Three deliberate taps to disconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="end-stay" onClick={() => setStep(1)}>
              Stay on call
            </AlertDialogCancel>
            {step === 1 ? (
              <Button
                data-testid="end-confirm-step1"
                onClick={() => setStep(2)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                End call
              </Button>
            ) : (
              <AlertDialogAction
                data-testid="end-confirm-step2"
                onClick={() => { setStep(1); setOpen(false); setEnded(true); }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Yes, disconnect now
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
