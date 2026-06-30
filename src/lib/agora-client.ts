/**
 * Agora RTC client wrapper.
 * - Lazy-loads `agora-rtc-sdk-ng` (heavy SDK; only ship to users who actually call).
 * - Tracks network-quality and disconnect counts so the call screen can show
 *   indicators and the server can persist analytics.
 * - Auto-fallback: if uplink bandwidth tanks for `FALLBACK_AFTER_BAD_SAMPLES`
 *   consecutive 2-second samples on a video call, the local video track is
 *   unpublished/disabled and a callback is fired so the UI can toast the user.
 */
import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  NetworkQuality,
} from "agora-rtc-sdk-ng";
import { pushAgoraDebug } from "./agora-debug";

function describeTrack(t: MediaStreamTrack | null | undefined) {
  if (!t) return { present: false };
  return {
    present: true,
    id: t.id,
    kind: t.kind,
    readyState: t.readyState,
    muted: t.muted,
    enabled: t.enabled,
  };
}

function watchTrackEnded(t: MediaStreamTrack | null | undefined, label: string, uid?: string | number) {
  if (!t) return;
  const handler = () => pushAgoraDebug("track-ended", { label, uid, id: t.id, kind: t.kind }, "warn");
  try { t.addEventListener("ended", handler, { once: true }); } catch { /* ignore */ }
  try { t.addEventListener("mute", () => pushAgoraDebug("track-muted", { label, uid, id: t.id })); } catch { /* ignore */ }
  try { t.addEventListener("unmute", () => pushAgoraDebug("track-unmuted", { label, uid, id: t.id })); } catch { /* ignore */ }
}

/** Why the remote peer left the channel. */
export type RemoteLeaveReason = "quit" | "timeout" | "audience" | "unknown";
/** Why the local connection dropped. "network"/"interrupt" = transient drop. */
export type DisconnectReason = "network" | "interrupt" | "leave" | "server" | "unknown";

export type AgoraEvents = {
  onRemoteUser?: (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => void;
  onRemoteLeft?: (user: IAgoraRTCRemoteUser, reason: RemoteLeaveReason) => void;
  onQuality?: (q: NetworkQuality) => void;
  onDisconnected?: (reason: DisconnectReason) => void;
  onReconnected?: () => void;
  onVideoFallback?: () => void;
  /** Fired when a remote audio track was subscribed but autoplay was blocked. */
  onAudioBlocked?: () => void;
};

function mapLeaveReason(raw: unknown): RemoteLeaveReason {
  const r = String(raw ?? "").toLowerCase();
  if (r === "quit") return "quit";
  if (r === "servertimeout" || r === "server_timeout") return "timeout";
  if (r === "becomeaudience" || r === "become_audience") return "audience";
  return "unknown";
}

function mapDisconnectReason(raw: unknown): DisconnectReason {
  const r = String(raw ?? "").toUpperCase();
  if (r.includes("NETWORK")) return "network";
  if (r.includes("INTERRUPT")) return "interrupt";
  if (r.includes("LEAVE")) return "leave";
  if (r.includes("SERVER")) return "server";
  return "unknown";
}

const FALLBACK_AFTER_BAD_SAMPLES = 4; // ≈8 seconds of poor uplink

export class AgoraSession {
  private client: IAgoraRTCClient | null = null;
  private mic: IMicrophoneAudioTrack | null = null;
  private cam: ICameraVideoTrack | null = null;
  private qualitySum = 0;
  private qualityCount = 0;
  private disconnects = 0;
  private badStreak = 0;
  private fallbackFired = false;
  private kind: "voice" | "video" = "video";
  private channel = "";
  private events: AgoraEvents = {};
  /** Remote audio tracks whose autoplay was blocked, kept so retryAudio() can play them. */
  private pendingAudio: Array<{ play: () => void }> = [];
  /** All currently subscribed remote audio tracks (for volume / speaker routing). */
  private remoteAudio: Array<{ setVolume: (v: number) => void }> = [];
  private speakerOn = false;
  /** Container the UI wants remote video painted into. Updated via setRemoteVideoElement. */
  private remoteVideoEl: HTMLElement | null = null;
  /** Last remote user that published video — used to reattach when the peer toggles cam back on. */
  private lastRemoteVideoUser: IAgoraRTCRemoteUser | null = null;

  async join(opts: {
    appId: string;
    channel: string;
    token: string;
    account: string;
    kind: "voice" | "video";
    events?: AgoraEvents;
  }): Promise<MediaStream> {
    this.kind = opts.kind;
    this.channel = opts.channel;
    this.events = opts.events ?? {};

    const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
    AgoraRTC.setLogLevel(3); // warn+
    this.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    this.client.on("user-published", async (user, mediaType) => {
      if (!this.client) return;
      if (mediaType !== "audio" && mediaType !== "video") return;
      pushAgoraDebug("user-published", { uid: user.uid, mediaType });
      try {
        await this.client.subscribe(user, mediaType);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[agora] subscribe failed", mediaType, err);
        pushAgoraDebug("subscribe-failed", { uid: user.uid, mediaType, err: String(err) }, "error");
        return;
      }
      if (mediaType === "audio" && user.audioTrack) {
        this.remoteAudio.push(user.audioTrack as any);
        try { (user.audioTrack as any).setVolume(this.speakerOn ? 400 : 100); } catch { /* ignore */ }
        try {
          user.audioTrack.play();
          pushAgoraDebug("remote-audio-playing", { uid: user.uid });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[agora] remote audio autoplay blocked", err);
          this.pendingAudio.push(user.audioTrack);
          this.events.onAudioBlocked?.();
          pushAgoraDebug("remote-audio-blocked", { uid: user.uid }, "warn");
        }
      }
      if (mediaType === "video") {
        const vt = user.videoTrack as any;
        const raw: MediaStreamTrack | null = vt?.getMediaStreamTrack?.() ?? null;
        pushAgoraDebug("remote-video-track", {
          uid: user.uid,
          hasTrack: !!user.videoTrack,
          mst: describeTrack(raw),
        });
        if (user.videoTrack) {
          watchTrackEnded(raw, `remote:${user.uid}`, user.uid as any);
          // Peer (re-)published video. Their previous videoTrack instance is now
          // stale: re-binding to the SAME container without clearing leaves an
          // orphan <video> element rendering a black/last-frame canvas. Clean
          // the container, then play the FRESH track into it.
          this.lastRemoteVideoUser = user;
          this.paintRemoteVideo(user);
        }
      }
      this.events.onRemoteUser?.(user, mediaType);
    });
    this.client.on("user-unpublished", (user, mediaType) => {
      pushAgoraDebug("user-unpublished", { uid: user.uid, mediaType });
      if (mediaType !== "video") return;
      // Peer turned cam off. Drop the painted <video> so we don't keep a
      // frozen last frame on screen until they republish.
      if (this.lastRemoteVideoUser?.uid === user.uid) {
        this.clearRemoteVideoEl();
      }
    });
    this.client.on("user-left", (user, reason) => {
      pushAgoraDebug("user-left", { uid: user.uid, reason: String(reason) });
      this.events.onRemoteLeft?.(user, mapLeaveReason(reason));
    });
    this.client.on("connection-state-change", (cur, prev, reason) => {
      pushAgoraDebug("connection-state", { prev, cur, reason: String(reason ?? "") });
      if (prev === "CONNECTED" && cur !== "CONNECTED") {
        this.disconnects += 1;
        this.events.onDisconnected?.(mapDisconnectReason(reason));
      }
      if (cur === "CONNECTED" && prev === "RECONNECTING") {
        this.events.onReconnected?.();
      }
    });
    this.client.on("network-quality", (stats) => {
      // 0=unknown, 1=excellent ... 6=disconnected
      const up = stats.uplinkNetworkQuality;
      const dn = stats.downlinkNetworkQuality;
      const sample = Math.max(up, dn);
      if (sample > 0 && sample <= 6) {
        this.qualitySum += sample;
        this.qualityCount += 1;
      }
      this.events.onQuality?.(stats);

      // Auto-fallback for video calls on sustained poor uplink.
      if (this.kind === "video" && this.cam && !this.fallbackFired) {
        const poor = up >= 4 && up <= 6;
        this.badStreak = poor ? this.badStreak + 1 : 0;
        if (this.badStreak >= FALLBACK_AFTER_BAD_SAMPLES) {
          this.fallbackFired = true;
          this.disableVideo().catch(() => {});
          this.events.onVideoFallback?.();
        }
      }
    });

    await this.client.join(opts.appId, opts.channel, opts.token, opts.account);

    this.mic = await AgoraRTC.createMicrophoneAudioTrack({
      AEC: true,
      ANS: true,
      AGC: true,
      encoderConfig: "speech_standard",
    });
    // Make sure capture is hot before publishing.
    try { await this.mic.setEnabled(true); } catch { /* ignore */ }
    const tracksToPublish: (IMicrophoneAudioTrack | ICameraVideoTrack)[] = [this.mic];

    if (opts.kind === "video") {
      this.cam = await AgoraRTC.createCameraVideoTrack({
        encoderConfig: "480p_1",
      });
      tracksToPublish.push(this.cam);
    }
    await this.client.publish(tracksToPublish);
    pushAgoraDebug("local-published", {
      channel: opts.channel,
      kind: opts.kind,
      tracks: tracksToPublish.map((t: any) => t?.trackMediaType),
    });

    // Build a MediaStream from the underlying tracks so the existing UI
    // (local <video> preview, ModerationSampler, mic/cam toggles) keeps working.
    const stream = new MediaStream();
    const micTrack = this.mic.getMediaStreamTrack();
    if (micTrack) { stream.addTrack(micTrack); watchTrackEnded(micTrack, "local-mic"); }
    if (this.cam) {
      const camTrack = this.cam.getMediaStreamTrack();
      if (camTrack) { stream.addTrack(camTrack); watchTrackEnded(camTrack, "local-cam"); }
      pushAgoraDebug("local-cam-track", describeTrack(camTrack));
    }
    return stream;
  }

  attachRemoteVideo(user: IAgoraRTCRemoteUser, el: HTMLElement) {
    // Remember the container so subsequent peer cam toggles repaint here.
    this.remoteVideoEl = el;
    this.lastRemoteVideoUser = user;
    pushAgoraDebug("attach-remote-video", { uid: user.uid, hasEl: !!el });
    this.paintRemoteVideo(user);
  }

  /** Update the destination element for remote video without needing a track to be live yet. */
  setRemoteVideoElement(el: HTMLElement | null) {
    this.remoteVideoEl = el;
    pushAgoraDebug("set-remote-el", { hasEl: !!el, hasPending: !!this.lastRemoteVideoUser?.videoTrack });
    if (el && this.lastRemoteVideoUser?.videoTrack) {
      this.paintRemoteVideo(this.lastRemoteVideoUser);
    }
  }

  private paintRemoteVideo(user: IAgoraRTCRemoteUser) {
    const el = this.remoteVideoEl;
    if (!el || !user.videoTrack) {
      pushAgoraDebug("paint-skipped", { uid: user.uid, hasEl: !!el, hasTrack: !!user.videoTrack }, "warn");
      return;
    }
    const raw: MediaStreamTrack | null = (user.videoTrack as any)?.getMediaStreamTrack?.() ?? null;
    // Stop any prior playback bound to this track and wipe stale <video>
    // children before re-binding. Agora appends a child element on play();
    // a second play() without cleanup leaves the old one rendering stale data.
    try { user.videoTrack.stop(); } catch { /* not playing */ }
    while (el.firstChild) el.removeChild(el.firstChild);
    try {
      user.videoTrack.play(el, { fit: "cover" });
      pushAgoraDebug("paint-remote", { uid: user.uid, mst: describeTrack(raw) });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[agora] remote video play failed", err);
      pushAgoraDebug("paint-failed", { uid: user.uid, err: String(err) }, "error");
    }
  }

  private clearRemoteVideoEl() {
    const el = this.remoteVideoEl;
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    pushAgoraDebug("clear-remote-el");
  }

  async setMicEnabled(on: boolean) {
    pushAgoraDebug("local-mic-toggle", { on });
    await this.mic?.setEnabled(on);
  }
  async setCamEnabled(on: boolean) {
    if (!this.cam || !this.client) return;
    pushAgoraDebug("local-cam-toggle", { on });
    if (on) {
      try { await this.cam.setEnabled(true); } catch (err) { pushAgoraDebug("cam-setEnabled-fail", { err: String(err) }, "warn"); }
      try { await this.client.publish(this.cam); pushAgoraDebug("cam-republished"); }
      catch (err) { pushAgoraDebug("cam-republish-skip", { err: String(err) }); }
      const fresh = this.cam.getMediaStreamTrack();
      watchTrackEnded(fresh, "local-cam");
      pushAgoraDebug("local-cam-track", describeTrack(fresh));
    } else {
      try { await this.client.unpublish(this.cam); pushAgoraDebug("cam-unpublished"); }
      catch (err) { pushAgoraDebug("cam-unpublish-skip", { err: String(err) }); }
      try { await this.cam.setEnabled(false); } catch (err) { pushAgoraDebug("cam-setEnabled-fail", { on: false, err: String(err) }, "warn"); }
    }
  }

  /** Retry remote audio playback after a user gesture (autoplay unlock). */
  retryAudio() {
    const pending = this.pendingAudio;
    this.pendingAudio = [];
    for (const t of pending) {
      try { t.play(); } catch { /* ignore */ }
    }
  }

  /**
   * Toggle "speaker" (loudspeaker) mode.
   * Web/desktop: boosts remote audio volume to ~200 so it plays loud through
   * the device's main speakers vs the muted/earpiece-like default.
   * Native (Capacitor Android): also asks the OS to route audio to the
   * loudspeaker via the SpeakerMode plugin if available; falls back silently.
   */
  async setSpeakerMode(on: boolean) {
    this.speakerOn = on;
    // Agora's setVolume accepts 0–1000 (100 = original). Push to ~400 for the
    // loudspeaker mode so it's clearly louder than the default earpiece-like
    // playback on web/desktop browsers.
    for (const t of this.remoteAudio) {
      try { t.setVolume(on ? 400 : 100); } catch { /* ignore */ }
    }
    // Native (Capacitor Android): flip the OS audio route to the loudspeaker
    // via our SpeakerMode plugin (AudioManager under the hood). This is the
    // only thing that actually makes the call audible on phone speakers —
    // volume boosts alone don't change routing.
    try {
      const cap = (window as any).Capacitor;
      if (cap?.isNativePlatform?.() && cap?.Plugins?.SpeakerMode?.set) {
        await cap.Plugins.SpeakerMode.set({ on });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[agora] SpeakerMode plugin failed", err);
    }
  }
  isSpeakerOn() { return this.speakerOn; }




  async disableVideo() {
    if (this.cam && this.client) {
      try {
        await this.client.unpublish(this.cam);
      } catch { /* ignore */ }
      this.cam.stop();
      this.cam.close();
      this.cam = null;
    }
  }

  async leave() {
    try {
      this.mic?.stop();
      this.mic?.close();
      this.cam?.stop();
      this.cam?.close();
      await this.client?.leave();
    } catch { /* ignore */ }
    this.mic = null;
    this.cam = null;
    this.client = null;
  }

  /** Summary stats — call after leave/end. */
  stats() {
    return {
      channel: this.channel,
      qualityAvg: this.qualityCount > 0 ? this.qualitySum / this.qualityCount : 0,
      disconnects: this.disconnects,
    };
  }
}

/** Build a deterministic channel name shared by both peers. */
export function channelForPair(a: string, b: string): string {
  return `c_${[a, b].sort().join("_").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60)}`;
}
