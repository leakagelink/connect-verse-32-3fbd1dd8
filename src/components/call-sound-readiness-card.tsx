import { useEffect, useState, useCallback } from "react";
import {
  Volume2,
  VolumeX,
  Vibrate,
  MoonStar,
  BellOff,
  Bell,
  Settings as SettingsIcon,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  getRingerStatus,
  openIncomingCallChannelSettings,
  openDndSettings,
  openVolumeSettings,
  isNative,
  platform,
  type RingerStatus,
} from "@/lib/native";

type Tone = "ok" | "warn" | "bad" | "info";

function toneBadgeClass(tone: Tone) {
  if (tone === "ok") return "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
  if (tone === "warn") return "bg-amber-500/15 text-amber-500 border-amber-500/30";
  if (tone === "bad") return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground border-border";
}

function toneIconBg(tone: Tone) {
  if (tone === "ok") return "bg-emerald-500/15 text-emerald-500";
  if (tone === "warn") return "bg-amber-500/15 text-amber-500";
  if (tone === "bad") return "bg-destructive/15 text-destructive";
  return "bg-muted text-foreground";
}

function Row({
  icon, title, detail, tone, badge, actions,
}: {
  icon: React.ReactNode;
  title: string;
  detail: React.ReactNode;
  tone: Tone;
  badge: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-3">
      <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${toneIconBg(tone)}`} aria-hidden>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{title}</p>
          <Badge variant="outline" className={`shrink-0 ${toneBadgeClass(tone)}`}>{badge}</Badge>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
        {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

function ringerTone(s: RingerStatus): { tone: Tone; badge: string; detail: string } {
  if (s.ringerMode === "silent") {
    return { tone: "bad", badge: "Silent", detail: "Phone is on Silent — calls won't make any sound. Switch to Ring." };
  }
  if (s.ringerMode === "vibrate") {
    return { tone: "warn", badge: "Vibrate only", detail: "Phone is on Vibrate — you'll feel the call but no ringtone will play." };
  }
  const pct = s.ringVolumeMax > 0 ? Math.round((s.ringVolume / s.ringVolumeMax) * 100) : 0;
  if (s.ringVolume === 0) {
    return { tone: "bad", badge: "Volume 0", detail: "Ring volume is muted. Increase ring volume so you can hear calls." };
  }
  if (pct < 30) {
    return { tone: "warn", badge: `Low (${pct}%)`, detail: "Ring volume is low — you might miss calls in a noisy place." };
  }
  return { tone: "ok", badge: `Ring · ${pct}%`, detail: "Ring volume is healthy — incoming calls will play your ringtone." };
}

function dndTone(s: RingerStatus): { tone: Tone; badge: string; detail: string } {
  if (!s.dndActive) {
    return { tone: "ok", badge: "Off", detail: "Do Not Disturb is off — call alerts can come through." };
  }
  if (s.channelBypassDnd) {
    return { tone: "ok", badge: "On · Calls bypass", detail: "DND is on, but Talkora incoming calls are allowed through." };
  }
  return {
    tone: "bad",
    badge: "On · Blocking",
    detail: "Do Not Disturb is blocking notifications and the call channel is NOT allowed to bypass. Calls won't ring.",
  };
}

function channelTone(s: RingerStatus): { tone: Tone; badge: string; detail: string } {
  if (s.channelBlocked) {
    return { tone: "bad", badge: "Off", detail: "You've turned off the Incoming calls channel in system settings. Re-enable it to hear ringtones." };
  }
  if (s.channelImportance < 4) {
    return { tone: "warn", badge: "Low importance", detail: "Incoming-calls channel importance is below High. Set it to Urgent so it can pop the full-screen ringer." };
  }
  if (!s.channelSoundSet) {
    return { tone: "warn", badge: "No sound", detail: "Channel has no ringtone selected. Pick a ringtone in channel settings." };
  }
  return { tone: "ok", badge: "Urgent + sound", detail: "Incoming-calls channel is fully set up to ring loudly." };
}

export function CallSoundReadinessCard() {
  const [status, setStatus] = useState<RingerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const s = await getRingerStatus();
    setStatus(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  if (!isNative() || platform() !== "android") {
    return (
      <Card className="glass p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
            <Bell className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Ringtone & Do Not Disturb</p>
            <p className="text-xs text-muted-foreground">
              These checks are only available inside the Talkora Android app. On web, your browser handles notification sounds.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (loading && !status) {
    return (
      <Card className="glass p-4">
        <p className="text-xs text-muted-foreground">Checking ringer, volume & Do Not Disturb…</p>
      </Card>
    );
  }
  if (!status) {
    return (
      <Card className="glass p-4">
        <p className="text-xs text-muted-foreground">Couldn't read ringer state.</p>
        <Button size="sm" variant="ghost" className="mt-2 h-7" onClick={() => void refresh()}>Retry</Button>
      </Card>
    );
  }

  const r = ringerTone(status);
  const d = dndTone(status);
  const c = channelTone(status);
  const tones: Tone[] = [r.tone, d.tone, c.tone];
  const overall: Tone = tones.includes("bad") ? "bad" : tones.includes("warn") ? "warn" : "ok";
  const pct = status.ringVolumeMax > 0 ? Math.round((status.ringVolume / status.ringVolumeMax) * 100) : 0;

  return (
    <Card className="glass space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={`flex size-10 items-center justify-center rounded-full ${toneIconBg(overall)}`}>
          {overall === "ok" ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Will calls ring on this phone?</p>
          <p className="text-xs text-muted-foreground">
            {overall === "ok"
              ? "Ringtone, volume and Do Not Disturb are all set correctly."
              : overall === "warn"
                ? "Calls will alert, but the sound may be hard to hear — fix the items below."
                : "Something is silencing incoming calls. Fix the items below."}
          </p>
        </div>
        <Badge variant="outline" className={`shrink-0 ${toneBadgeClass(overall)}`}>
          {overall === "ok" ? "Ready" : overall === "warn" ? "Improve" : "Will be silent"}
        </Badge>
      </div>

      {/* Ringer mode + volume */}
      <Row
        icon={
          status.ringerMode === "silent"
            ? <VolumeX className="size-4" />
            : status.ringerMode === "vibrate"
              ? <Vibrate className="size-4" />
              : <Volume2 className="size-4" />
        }
        title="Ringtone volume"
        tone={r.tone}
        badge={r.badge}
        detail={
          <div className="space-y-1.5">
            <p>{r.detail}</p>
            {status.ringerMode === "normal" && status.ringVolumeMax > 0 ? (
              <Progress
                value={pct}
                className={`h-1.5 ${r.tone === "ok" ? "" : r.tone === "warn" ? "[&>div]:bg-amber-500" : "[&>div]:bg-destructive"}`}
              />
            ) : null}
          </div>
        }
        actions={
          r.tone !== "ok" ? (
            <Button
              size="sm"
              onClick={async () => { setBusy("vol"); await openVolumeSettings(); setBusy(null); }}
              disabled={busy !== null}
              className="h-7"
            >
              <SettingsIcon className="mr-1.5 size-3.5" /> Sound settings
            </Button>
          ) : null
        }
      />

      {/* DND */}
      <Row
        icon={<MoonStar className="size-4" />}
        title="Do Not Disturb"
        tone={d.tone}
        badge={d.badge}
        detail={d.detail}
        actions={
          d.tone !== "ok" ? (
            <>
              <Button
                size="sm"
                onClick={async () => { setBusy("dnd"); await openDndSettings(); setBusy(null); }}
                disabled={busy !== null}
                className="h-7"
              >
                <MoonStar className="mr-1.5 size-3.5" /> Open DND
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => { setBusy("ch"); await openIncomingCallChannelSettings(); setBusy(null); }}
                disabled={busy !== null}
                className="h-7"
              >
                Allow calls past DND
              </Button>
            </>
          ) : null
        }
      />

      {/* Channel */}
      <Row
        icon={c.tone === "bad" ? <BellOff className="size-4" /> : <Bell className="size-4" />}
        title="Incoming-calls notification channel"
        tone={c.tone}
        badge={c.badge}
        detail={c.detail}
        actions={
          c.tone !== "ok" ? (
            <Button
              size="sm"
              onClick={async () => { setBusy("ch"); await openIncomingCallChannelSettings(); setBusy(null); }}
              disabled={busy !== null}
              className="h-7"
            >
              <SettingsIcon className="mr-1.5 size-3.5" /> Open channel
            </Button>
          ) : null
        }
      />

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Mode: <strong>{status.ringerMode}</strong> · Ring: <strong>{status.ringVolume}/{status.ringVolumeMax}</strong> ·
          DND: <strong>{status.dndFilter}</strong>
        </span>
        <Button size="sm" variant="ghost" className="h-7" onClick={() => void refresh()} disabled={busy !== null}>
          Refresh
        </Button>
      </div>
    </Card>
  );
}
