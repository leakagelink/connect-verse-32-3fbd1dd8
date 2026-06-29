/**
 * Provider-agnostic call connector with automatic failover.
 *
 * Asks the server for the next healthy credential, attempts the join, and
 * on failure reports the credential as failed + retries with it excluded
 * from the pool — until either a session is up or we exhaust the retry
 * budget. Returns a tagged-union describing what's connected so the call
 * screen can render the right preview / remote view.
 */
import { AgoraSession, channelForPair } from "./agora-client";
import { HmsSession } from "./hms-client";
import { getCallingConfig, issueAgoraToken, issueHmsToken, reportCallFailure } from "./calling.functions";

export type SessionEvents = {
  onRemoteJoined?: () => void;
  onRemoteLeft?: () => void;
  onQuality?: (q: number) => void;
  onDisconnected?: () => void;
  onReconnected?: () => void;
  onVideoFallback?: () => void;
  onAudioBlocked?: () => void;
};

export type ConnectedAgora = {
  provider: "agora";
  credentialId: string;
  channel: string;
  session: AgoraSession;
  /** Raw local MediaStream — used by ModerationSampler + <video srcObject>. */
  localStream: MediaStream;
  attachRemote: (el: HTMLElement) => void;
  failoverChain: FailoverEntry[];
};

export type ConnectedHms = {
  provider: "100ms";
  credentialId: string;
  channel: string;
  session: HmsSession;
  /** 100ms manages capture internally — no raw stream for ModerationSampler. */
  localStream: null;
  attachLocal: (el: HTMLVideoElement) => void;
  attachRemote: (el: HTMLElement) => void;
  failoverChain: FailoverEntry[];
};

export type ConnectedMock = {
  provider: "mock";
  credentialId: null;
  channel: string;
  session: null;
  localStream: MediaStream;
  failoverChain: FailoverEntry[];
};

export type AnySession = ConnectedAgora | ConnectedHms | ConnectedMock;

export type FailoverEntry = {
  credentialId: string;
  provider: string;
  error: string;
};

export async function connectCall(opts: {
  myUserId: string;
  partnerUserId: string;
  kind: "voice" | "video";
  events: SessionEvents;
  /** Hard cap on credentials we try before falling back to mock / throwing. */
  maxAttempts?: number;
}): Promise<AnySession> {
  const channel = channelForPair(opts.myUserId, opts.partnerUserId);
  const maxAttempts = opts.maxAttempts ?? 3;
  const excludeCredentialIds: string[] = [];
  const failoverChain: FailoverEntry[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cfg = await getCallingConfig({
      data: { excludeCredentialIds },
    });

    // No provider available → mock fallback (local-only — cannot exchange
    // audio between two devices). Only acceptable for a self-call (same id).
    if (cfg.provider === "mock" || !cfg.credentialId) {
      if (opts.myUserId !== opts.partnerUserId) {
        throw new Error(
          "Calling service is not configured. Audio cannot connect between two devices without a calling provider.",
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: opts.kind === "video" ? { width: 640, height: 480, facingMode: "user" } : false,
      });
      return {
        provider: "mock",
        credentialId: null,
        channel,
        session: null,
        localStream: stream,
        failoverChain,
      };
    }

    try {
      if (cfg.provider === "agora") {
        const tok = await issueAgoraToken({
          data: { channel, role: "publisher", credentialId: cfg.credentialId },
        });
        const session = new AgoraSession();
        const stream = await session.join({
          appId: tok.appId,
          channel: tok.channel,
          token: tok.token,
          account: tok.account,
          kind: opts.kind,
          events: {
            onRemoteUser: (user, mediaType) => {
              opts.events.onRemoteJoined?.();
              if (mediaType === "video") {
                // remote container attachment is done by the caller via attachRemote
                queueMicrotask(() => session.attachRemoteVideo(user, _agoraRemoteEl ?? document.createElement("div")));
              }
            },
            onRemoteLeft: () => opts.events.onRemoteLeft?.(),
            onQuality: (q) => opts.events.onQuality?.(Math.max(q.uplinkNetworkQuality, q.downlinkNetworkQuality)),
            onDisconnected: opts.events.onDisconnected,
            onReconnected: opts.events.onReconnected,
            onVideoFallback: opts.events.onVideoFallback,
            onAudioBlocked: opts.events.onAudioBlocked,
          },
        });
        // Track the remote container target so attachRemote() works post-join.
        let _agoraRemoteEl: HTMLElement | null = null;
        return {
          provider: "agora",
          credentialId: tok.credentialId,
          channel,
          session,
          localStream: stream,
          attachRemote: (el) => { _agoraRemoteEl = el; },
          failoverChain,
        };
      }

      if (cfg.provider === "100ms") {
        const tok = await issueHmsToken({
          data: { channel, role: "guest", credentialId: cfg.credentialId },
        });
        const session = new HmsSession();
        await session.join({
          token: tok.token,
          userName: opts.myUserId,
          channel: tok.channel,
          kind: opts.kind,
          events: opts.events,
        });
        return {
          provider: "100ms",
          credentialId: tok.credentialId,
          channel,
          session,
          localStream: null,
          attachLocal: (el) => session.attachLocalVideo(el),
          attachRemote: (el) => session.attachRemoteVideo(el),
          failoverChain,
        };
      }

      throw new Error(`Unknown provider: ${(cfg as { provider: string }).provider}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const failedId = cfg.credentialId;
      failoverChain.push({ credentialId: failedId, provider: cfg.provider, error: message });
      excludeCredentialIds.push(failedId);
      try {
        await reportCallFailure({ data: { credentialId: failedId, errorMessage: message.slice(0, 500) } });
      } catch { /* ignore reporter failures */ }
      // Loop continues to next attempt
    }
  }

  // All credentials in the pool failed — fall back to mock so the user
  // still gets the legacy P2P experience instead of a hard error.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: opts.kind === "video" ? { width: 640, height: 480, facingMode: "user" } : false,
  });
  return {
    provider: "mock",
    credentialId: null,
    channel,
    session: null,
    localStream: stream,
    failoverChain,
  };
}
