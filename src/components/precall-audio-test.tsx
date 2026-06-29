import { useEffect, useRef, useState } from "react";
import { Mic, Volume2, CheckCircle2, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type MicStatus = "idle" | "starting" | "ok" | "silent" | "error";
type ToneStatus = "idle" | "playing" | "played" | "blocked";

interface Props {
  /** Fired when both mic capture and speaker tone are confirmed working. */
  onPassed: () => void;
  onCancel: () => void;
}

/**
 * Verifies microphone capture and speaker playback BEFORE joining a call.
 * Shows actionable errors so users can fix problems instead of joining a
 * silent call.
 *
 *   1. Requests a mic MediaStream and renders a live VU meter (proves the
 *      OS-level mic permission is real and the device is actually capturing).
 *   2. Plays a short test tone via Web Audio (proves the speaker works AND
 *      unlocks autoplay so Agora's remote audio plays automatically on join).
 *   3. Requires the user to confirm they heard the tone before continuing.
 */
export function PreCallAudioTest({ onPassed, onCancel }: Props) {
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [micError, setMicError] = useState<string>("");
  const [level, setLevel] = useState(0); // 0..1
  const [toneStatus, setToneStatus] = useState<ToneStatus>("idle");
  const [toneError, setToneError] = useState<string>("");

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const peakRef = useRef(0);

  async function startMic() {
    setMicStatus("starting");
    setMicError("");
    peakRef.current = 0;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      streamRef.current = stream;
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
        // Compute peak deviation from 128 (silence) → 0..1
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

      // Watch for total silence — likely a muted hardware switch or wrong device.
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
        setMicError("No microphone was found on this device.");
      } else if (name === "NotReadableError") {
        setMicError("Microphone is being used by another app. Close other call apps and retry.");
      } else {
        setMicError(e?.message || "Couldn't access the microphone.");
      }
      setMicStatus("error");
    }
  }

  async function playTone() {
    setToneError("");
    setToneStatus("playing");
    try {
      const ctx = audioCtxRef.current;
      if (!ctx) throw new Error("Audio engine not ready. Allow microphone first.");
      try { await ctx.resume(); } catch { /* ignore */ }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 660;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.9);
      window.setTimeout(() => setToneStatus("played"), 950);
    } catch (err) {
      const msg = (err as Error)?.message || "Couldn't play the test tone.";
      setToneError(msg);
      setToneStatus("blocked");
    }
  }

  function cleanup() {
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

  useEffect(() => {
    void startMic();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRetryMic() {
    cleanup();
    setLevel(0);
    void startMic();
  }

  const micPass = micStatus === "ok" && peakRef.current >= 0.02;
  const tonePass = toneStatus === "played";
  const canJoin = micPass && tonePass;

  const levelPct = Math.min(100, Math.round(level * 140));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Audio check</h3>
        <p className="text-xs text-muted-foreground">
          Let's make sure your mic and speaker work before connecting.
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
              We're not hearing anything. Check that the right mic is selected and not
              muted at the hardware level, then retry.
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
            <Volume2 className="size-4" />
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
        <p className="text-[11px] text-muted-foreground">
          Tap Play tone and listen. If you don't hear it, raise the volume and try again.
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
