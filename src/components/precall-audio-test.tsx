import { useEffect, useRef, useState } from "react";
import { Mic, Volume2, CheckCircle2, AlertCircle, Loader2, RefreshCw, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type MicStatus = "idle" | "starting" | "ok" | "silent" | "error";
type ToneStatus = "idle" | "playing" | "played" | "blocked";

interface Props {
  /** Fired when both mic capture and speaker tone are confirmed working. */
  onPassed: () => void;
  onCancel: () => void;
}

const LS_MIC_KEY = "talkora.audio.micDeviceId";
const LS_SPK_KEY = "talkora.audio.spkDeviceId";

type AudioElementWithSink = HTMLAudioElement & {
  setSinkId?: (id: string) => Promise<void>;
};

/**
 * Verifies microphone capture and speaker playback BEFORE joining a call.
 * Lets users pick which input/output device to use and persists the choice
 * in localStorage so the call screen can pick the same devices on join.
 */
export function PreCallAudioTest({ onPassed, onCancel }: Props) {
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [micError, setMicError] = useState<string>("");
  const [level, setLevel] = useState(0);
  const [toneStatus, setToneStatus] = useState<ToneStatus>("idle");
  const [toneError, setToneError] = useState<string>("");

  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>(() => localStorage.getItem(LS_MIC_KEY) || "");
  const [spkId, setSpkId] = useState<string>(() => localStorage.getItem(LS_SPK_KEY) || "");
  const supportsSinkId =
    typeof document !== "undefined" &&
    typeof (document.createElement("audio") as AudioElementWithSink).setSinkId === "function";

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const peakRef = useRef(0);
  const toneElRef = useRef<AudioElementWithSink | null>(null);

  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setMics(list.filter((d) => d.kind === "audioinput"));
      setSpeakers(list.filter((d) => d.kind === "audiooutput"));
    } catch {
      /* ignore */
    }
  }

  async function startMic(deviceId?: string) {
    setMicStatus("starting");
    setMicError("");
    peakRef.current = 0;
    setLevel(0);
    try {
      const id = deviceId ?? micId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(id ? { deviceId: { exact: id } } : {}),
        },
        video: false,
      });
      streamRef.current = stream;

      // Once permission is granted, device labels populate — refresh.
      void refreshDevices();

      // If no mic was preselected, snap to the actually chosen device.
      const trackId = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (!id && trackId) {
        setMicId(trackId);
        localStorage.setItem(LS_MIC_KEY, trackId);
      }

      const AC: typeof AudioContext =
        (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      const ctx = new AC();
      audioCtxRef.current = ctx;
      try { await ctx.resume(); } catch { /* ignore */ }
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i] - 128) / 128;
          if (v > peak) peak = v;
        }
        setLevel(peak);
        if (peak > peakRef.current) peakRef.current = peak;
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      setMicStatus("ok");

      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = window.setTimeout(() => {
        if (peakRef.current < 0.02) setMicStatus("silent");
      }, 4000);
    } catch (err) {
      const e = err as DOMException;
      const name = e?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setMicError("Microphone permission was denied. Enable it in your device settings and try again.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setMicError("Selected microphone isn't available. Pick a different one and retry.");
      } else if (name === "NotReadableError") {
        setMicError("Microphone is being used by another app. Close other call apps and retry.");
      } else {
        setMicError(e?.message || "Couldn't access the microphone.");
      }
      setMicStatus("error");
    }
  }

  function stopMic() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }

  async function playTone() {
    setToneError("");
    setToneStatus("playing");
    try {
      // Build a short sine-wave WAV in-memory so we can route it through an
      // <audio> element and use setSinkId() to honour the chosen speaker.
      const sampleRate = 44100;
      const duration = 0.9;
      const freq = 660;
      const total = Math.floor(sampleRate * duration);
      const buffer = new ArrayBuffer(44 + total * 2);
      const view = new DataView(buffer);
      const writeStr = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
      };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + total * 2, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, "data");
      view.setUint32(40, total * 2, true);
      for (let i = 0; i < total; i++) {
        const t = i / sampleRate;
        // Quick attack/decay envelope to avoid clicks.
        const env = Math.min(1, t / 0.05) * Math.min(1, (duration - t) / 0.1);
        const sample = Math.sin(2 * Math.PI * freq * t) * env * 0.3;
        view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
      }
      const blob = new Blob([buffer], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);

      const el = (toneElRef.current ?? document.createElement("audio")) as AudioElementWithSink;
      toneElRef.current = el;
      el.src = url;
      el.preload = "auto";

      if (spkId && supportsSinkId && el.setSinkId) {
        try {
          await el.setSinkId(spkId);
        } catch (err) {
          // Non-fatal: fall back to default device.
          console.warn("setSinkId failed", err);
        }
      }

      await el.play();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        setToneStatus("played");
      }, duration * 1000 + 50);
    } catch (err) {
      const msg = (err as Error)?.message || "Couldn't play the test tone.";
      setToneError(msg);
      setToneStatus("blocked");
    }
  }

  function cleanup() {
    stopMic();
    if (toneElRef.current) {
      try { toneElRef.current.pause(); } catch { /* ignore */ }
      toneElRef.current.src = "";
      toneElRef.current = null;
    }
  }

  useEffect(() => {
    void refreshDevices();
    void startMic();
    const onChange = () => { void refreshDevices(); };
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleMicChange(value: string) {
    setMicId(value);
    localStorage.setItem(LS_MIC_KEY, value);
    stopMic();
    await startMic(value);
  }

  async function handleSpkChange(value: string) {
    setSpkId(value);
    localStorage.setItem(LS_SPK_KEY, value);
    // If the user has already played the tone, replay it through the new device.
    if (toneStatus === "played" || toneStatus === "blocked") {
      setToneStatus("idle");
    }
  }

  function handleRetryMic() {
    stopMic();
    setLevel(0);
    void startMic();
  }

  const micPass = micStatus === "ok" && peakRef.current >= 0.02;
  const tonePass = toneStatus === "played";
  const canJoin = micPass && tonePass;

  const levelPct = Math.min(100, Math.round(level * 140));

  const micLabel = (d: MediaDeviceInfo, i: number) => d.label || `Microphone ${i + 1}`;
  const spkLabel = (d: MediaDeviceInfo, i: number) => d.label || `Speaker ${i + 1}`;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Audio check</h3>
        <p className="text-xs text-muted-foreground">
          Pick your mic and speaker, then run the checks before connecting.
        </p>
      </div>

      {/* Mic row */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Mic className="size-4" />
            <span>Microphone</span>
          </div>
          {micStatus === "starting" && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> Starting…
            </span>
          )}
          {micPass && (
            <span className="text-xs text-emerald-600 inline-flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Working
            </span>
          )}
          {micStatus === "silent" && (
            <span className="text-xs text-amber-600 inline-flex items-center gap-1">
              <AlertCircle className="size-3" /> No sound detected
            </span>
          )}
          {micStatus === "error" && (
            <span className="text-xs text-destructive inline-flex items-center gap-1">
              <AlertCircle className="size-3" /> Error
            </span>
          )}
        </div>

        <Select value={micId || undefined} onValueChange={handleMicChange}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder={mics.length ? "Choose microphone" : "Waiting for permission…"} />
          </SelectTrigger>
          <SelectContent>
            {mics.map((d, i) => (
              <SelectItem key={d.deviceId || `mic-${i}`} value={d.deviceId || `mic-${i}`}>
                {micLabel(d, i)}
              </SelectItem>
            ))}
            {mics.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No microphones found</div>
            )}
          </SelectContent>
        </Select>

        <div className="h-2 w-full overflow-hidden rounded bg-muted">
          <div
            className={`h-full transition-[width] duration-75 ${
              micPass ? "bg-emerald-500" : level > 0 ? "bg-amber-500" : "bg-muted"
            }`}
            style={{ width: `${levelPct}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Speak into your mic — the bar should react.
        </p>

        {micStatus === "error" && (
          <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{micError}</span>
          </div>
        )}
        {micStatus === "silent" && (
          <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>
              We're not hearing anything. Try a different mic above, or unmute your hardware
              switch, then retry.
            </span>
          </div>
        )}
        {(micStatus === "error" || micStatus === "silent") && (
          <Button variant="outline" size="sm" onClick={handleRetryMic} className="gap-2 w-full">
            <RefreshCw className="size-3" /> Retry mic
          </Button>
        )}
      </div>

      {/* Speaker row */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Headphones className="size-4" />
            <span>Speaker</span>
          </div>
          {tonePass && (
            <span className="text-xs text-emerald-600 inline-flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Confirmed
            </span>
          )}
          {toneStatus === "blocked" && (
            <span className="text-xs text-destructive inline-flex items-center gap-1">
              <AlertCircle className="size-3" /> Blocked
            </span>
          )}
        </div>

        <Select
          value={spkId || undefined}
          onValueChange={handleSpkChange}
          disabled={!supportsSinkId || speakers.length === 0}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue
              placeholder={
                !supportsSinkId
                  ? "System default (selection not supported on this device)"
                  : speakers.length
                    ? "Choose speaker"
                    : "Waiting for permission…"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {speakers.map((d, i) => (
              <SelectItem key={d.deviceId || `spk-${i}`} value={d.deviceId || `spk-${i}`}>
                {spkLabel(d, i)}
              </SelectItem>
            ))}
            {speakers.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No speakers found</div>
            )}
          </SelectContent>
        </Select>

        <p className="text-[11px] text-muted-foreground">
          Tap Play tone and listen. If you don't hear it, switch device or raise the volume.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            disabled={micStatus !== "ok" && micStatus !== "silent"}
            onClick={playTone}
          >
            {toneStatus === "playing" ? <Loader2 className="size-3 animate-spin" /> : <Volume2 className="size-3" />}
            {toneStatus === "played" ? "Play tone again" : "Play tone"}
          </Button>
          {toneStatus === "played" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setToneStatus("idle")}
              className="text-xs"
            >
              Didn't hear it
            </Button>
          )}
        </div>
        {toneStatus === "blocked" && (
          <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{toneError}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button
          onClick={() => { cleanup(); onPassed(); }}
          disabled={!canJoin}
          className="flex-1"
        >
          {canJoin ? "Join call" : "Run checks first"}
        </Button>
      </div>
    </div>
  );
}
