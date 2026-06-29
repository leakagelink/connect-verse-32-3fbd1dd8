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

export type AgoraEvents = {
  onRemoteUser?: (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => void;
  onRemoteLeft?: (user: IAgoraRTCRemoteUser) => void;
  onQuality?: (q: NetworkQuality) => void;
  onDisconnected?: () => void;
  onReconnected?: () => void;
  onVideoFallback?: () => void;
  /** Fired when a remote audio track was subscribed but autoplay was blocked. */
  onAudioBlocked?: () => void;
};

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
      try {
        await this.client.subscribe(user, mediaType);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[agora] subscribe failed", mediaType, err);
        return;
      }
      if (mediaType === "audio" && user.audioTrack) {
        try {
          user.audioTrack.play();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[agora] remote audio autoplay blocked", err);
          this.pendingAudio.push(user.audioTrack);
          this.events.onAudioBlocked?.();
        }
      }
      this.events.onRemoteUser?.(user, mediaType);
    });
    this.client.on("user-left", (user) => this.events.onRemoteLeft?.(user));
    this.client.on("connection-state-change", (cur, prev) => {
      if (prev === "CONNECTED" && cur !== "CONNECTED") {
        this.disconnects += 1;
        this.events.onDisconnected?.();
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

    this.mic = await AgoraRTC.createMicrophoneAudioTrack();
    const tracksToPublish: (IMicrophoneAudioTrack | ICameraVideoTrack)[] = [this.mic];

    if (opts.kind === "video") {
      this.cam = await AgoraRTC.createCameraVideoTrack({
        encoderConfig: "480p_1",
      });
      tracksToPublish.push(this.cam);
    }
    await this.client.publish(tracksToPublish);

    // Build a MediaStream from the underlying tracks so the existing UI
    // (local <video> preview, ModerationSampler, mic/cam toggles) keeps working.
    const stream = new MediaStream();
    const micTrack = this.mic.getMediaStreamTrack();
    if (micTrack) stream.addTrack(micTrack);
    if (this.cam) {
      const camTrack = this.cam.getMediaStreamTrack();
      if (camTrack) stream.addTrack(camTrack);
    }
    return stream;
  }

  attachRemoteVideo(user: IAgoraRTCRemoteUser, el: HTMLElement) {
    user.videoTrack?.play(el);
  }

  async setMicEnabled(on: boolean) {
    await this.mic?.setEnabled(on);
  }
  async setCamEnabled(on: boolean) {
    await this.cam?.setEnabled(on);
  }

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
