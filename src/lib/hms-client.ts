/**
 * 100ms RTC client wrapper — mirrors AgoraSession's public surface so the
 * call screen can swap providers without major branching.
 *
 * 100ms manages capture internally; local preview + remote video are
 * rendered via `attachLocalVideo` / `attachRemoteVideo`, not a MediaStream.
 * ModerationSampler is disabled on 100ms calls.
 *
 * The HMS store/actions types are imported as `any` because the public
 * type surface from `@100mslive/hms-video-store` v0.14 doesn't expose the
 * `IHMSStoreReadOnly.subscribe / getState` overloads cleanly — the
 * runtime API works fine.
 */
export type HmsEvents = {
  onRemoteJoined?: () => void;
  onRemoteLeft?: (reason: "quit" | "timeout" | "audience" | "unknown") => void;
  onQuality?: (q: number) => void;
  onDisconnected?: (reason: "network" | "interrupt" | "leave" | "server" | "unknown") => void;
  onReconnected?: () => void;
  onVideoFallback?: () => void;
};

// Cached SDK module so attach helpers don't re-import.
let hmsModule: any = null;
async function loadHms() {
  if (!hmsModule) {
    hmsModule = await import("@100mslive/hms-video-store");
  }
  return hmsModule;
}

export class HmsSession {
  private store: any = null;
  private actions: any = null;
  private hmsStore: any = null;
  private unsubscribes: Array<() => void> = [];
  private events: HmsEvents = {};
  private channel = "";
  private kind: "voice" | "video" = "video";
  private disconnects = 0;
  private qualitySum = 0;
  private qualityCount = 0;
  private localVideoEl: HTMLVideoElement | null = null;
  private remoteContainerEl: HTMLElement | null = null;
  private remoteVideoEl: HTMLVideoElement | null = null;
  private attachedLocalTrackId: string | null = null;
  private attachedRemoteTrackId: string | null = null;
  private wasConnected = false;

  async join(opts: {
    token: string;
    userName: string;
    channel: string;
    kind: "voice" | "video";
    events?: HmsEvents;
  }): Promise<void> {
    this.kind = opts.kind;
    this.channel = opts.channel;
    this.events = opts.events ?? {};

    const mod = await loadHms();
    this.store = new mod.HMSReactiveStore();
    this.store.triggerOnSubscribe();
    this.actions = this.store.getActions();
    this.hmsStore = this.store.getStore();

    // Connection state — fires onDisconnected / onReconnected.
    this.unsubscribes.push(
      this.hmsStore.subscribe((connected: boolean | undefined) => {
        if (connected) {
          if (this.wasConnected) this.events.onReconnected?.();
          this.wasConnected = true;
        } else if (this.wasConnected) {
          this.disconnects += 1;
          this.events.onDisconnected?.("unknown");
        }
      }, mod.selectIsConnectedToRoom),
    );

    // Peers — emit remote join/left and (re)attach video tracks as they change.
    this.unsubscribes.push(
      this.hmsStore.subscribe((peers: any[]) => {
        const remote = peers.find((p) => !p.isLocal);
        if (remote) {
          this.events.onRemoteJoined?.();
          if (this.kind === "video" && remote.videoTrack) {
            this.tryAttachRemote(remote.videoTrack);
          }
        } else if (this.wasConnected) {
          this.events.onRemoteLeft?.("unknown");
          this.attachedRemoteTrackId = null;
        }
        const local = peers.find((p) => p.isLocal);
        if (local?.videoTrack && this.kind === "video") {
          this.tryAttachLocal(local.videoTrack);
        }
      }, mod.selectPeers),
    );

    await this.actions.join({
      userName: opts.userName,
      authToken: opts.token,
      settings: {
        isAudioMuted: false,
        isVideoMuted: opts.kind !== "video",
      },
    });
  }

  /** Attach local video preview to a <video> element. Call after join(). */
  attachLocalVideo(el: HTMLVideoElement) {
    this.localVideoEl = el;
    if (!this.hmsStore || !hmsModule) return;
    const peers = this.hmsStore.getState(hmsModule.selectPeers) as any[];
    const local = peers.find((p) => p.isLocal);
    if (local?.videoTrack) this.tryAttachLocal(local.videoTrack);
  }

  /** Attach remote video into a container. Creates a <video> child element. */
  attachRemoteVideo(container: HTMLElement) {
    this.remoteContainerEl = container;
    let v = container.querySelector("video[data-hms-remote]") as HTMLVideoElement | null;
    if (!v) {
      v = document.createElement("video");
      v.setAttribute("data-hms-remote", "1");
      v.autoplay = true;
      v.playsInline = true;
      v.style.width = "100%";
      v.style.height = "100%";
      v.style.objectFit = "cover";
      container.appendChild(v);
    }
    this.remoteVideoEl = v;
    if (!this.hmsStore || !hmsModule) return;
    const peers = this.hmsStore.getState(hmsModule.selectPeers) as any[];
    const remote = peers.find((p) => !p.isLocal);
    if (remote?.videoTrack) this.tryAttachRemote(remote.videoTrack);
  }

  private async tryAttachLocal(trackId: string) {
    if (!this.actions || !this.localVideoEl) return;
    if (this.attachedLocalTrackId === trackId) return;
    try {
      await this.actions.attachVideo(trackId, this.localVideoEl);
      this.attachedLocalTrackId = trackId;
    } catch { /* ignore */ }
  }

  private async tryAttachRemote(trackId: string) {
    if (!this.actions || !this.remoteVideoEl) return;
    if (this.attachedRemoteTrackId === trackId) return;
    try {
      await this.actions.attachVideo(trackId, this.remoteVideoEl);
      this.attachedRemoteTrackId = trackId;
    } catch { /* ignore */ }
  }

  async setMicEnabled(on: boolean) {
    await this.actions?.setLocalAudioEnabled(on);
  }

  async setCamEnabled(on: boolean) {
    if (this.kind !== "video") return;
    await this.actions?.setLocalVideoEnabled(on);
  }

  async leave() {
    for (const u of this.unsubscribes) {
      try { u(); } catch { /* ignore */ }
    }
    this.unsubscribes = [];
    try { await this.actions?.leave(); } catch { /* ignore */ }
    this.actions = null;
    this.hmsStore = null;
    this.store = null;
  }

  stats() {
    return {
      channel: this.channel,
      qualityAvg: this.qualityCount > 0 ? this.qualitySum / this.qualityCount : 0,
      disconnects: this.disconnects,
    };
  }
}
