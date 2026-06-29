import { useEffect, useState } from "react";
import { Mic, Video as VideoIcon, CheckCircle2, XCircle, AlertCircle, Loader2, Settings as SettingsIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  checkCallPermissions,
  requestCallPermissions,
  openAppSettings,
  isNative,
  type PermState,
} from "@/lib/native";
import { toast } from "sonner";
import { PreCallAudioTest } from "@/components/precall-audio-test";

interface Props {
  open: boolean;
  kind: "voice" | "video";
  onCancel: () => void;
  /** Fires only when mic (and camera, if video) are fully granted. */
  onReady: () => void;
}

/**
 * Lightweight pre-call dialog that displays the current mic/camera
 * permission status BEFORE navigating to the call screen. Lets the user
 * see exactly what is missing, trigger the OS prompt inside their tap
 * gesture, or jump to app settings if a prior denial blocks the prompt.
 */
export function PrecallPermissionDialog({ open, kind, onCancel, onReady }: Props) {
  const needsCamera = kind === "video";
  const [mic, setMic] = useState<PermState>("unknown");
  const [camera, setCamera] = useState<PermState>("unknown");
  const [checking, setChecking] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [askedOnce, setAskedOnce] = useState(false);

  async function refresh() {
    setChecking(true);
    try {
      const s = await checkCallPermissions();
      setMic(s.mic);
      setCamera(s.camera);
      return s;
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!open) {
      setAskedOnce(false);
      return;
    }
    void refresh();
  }, [open, kind]);

  const micOk = mic === "granted";
  const camOk = !needsCamera || camera === "granted";
  const allGranted = micOk && camOk;
  const anyDenied = mic === "denied" || (needsCamera && camera === "denied");
  const useSettingsCta = isNative() && askedOnce && anyDenied;

  async function handleAllow() {
    setRequesting(true);
    try {
      const res = await requestCallPermissions(kind);
      setAskedOnce(true);
      await refresh();
      if (res.granted) {
        onReady();
        return;
      }
      if (res.reason === "mic-denied") toast.error("Microphone access denied.");
      else if (res.reason === "camera-denied") toast.error("Camera access denied.");
      else if (res.reason === "media-denied") toast.error("Camera or microphone access denied.");
      else if (res.reason === "media-unavailable") toast.error("Camera or microphone not available on this device.");
      else if (res.reason === "plugin-missing") toast.error("Permission module unavailable. Reinstall the latest app.");
    } finally {
      setRequesting(false);
    }
  }

  async function handleOpenSettings() {
    const ok = await openAppSettings();
    if (!ok) toast.info("Open Settings → Apps → Talkora → Permissions and enable Microphone" + (needsCamera ? " and Camera." : "."));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {kind === "video" ? "Camera & Microphone check" : "Microphone check"}
          </DialogTitle>
          <DialogDescription>
            Talkora needs access to start your {kind === "video" ? "video call" : "voice call"}.
            Your media streams directly to your partner — we never record or store it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <PermRow
            icon={<Mic className="size-4" />}
            label="Microphone"
            state={mic}
            checking={checking}
          />
          {needsCamera && (
            <PermRow
              icon={<VideoIcon className="size-4" />}
              label="Camera"
              state={camera}
              checking={checking}
            />
          )}
        </div>

        {anyDenied && (
          <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <p>
              {askedOnce
                ? "Permission was denied. Open Settings → Apps → Talkora → Permissions and enable"
                : "We previously couldn't get permission. Tap Allow access to try again for"}
              {needsCamera ? " Microphone and Camera." : " Microphone."}
            </p>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {allGranted ? (
            <Button onClick={onReady} className="w-full">Start {kind === "video" ? "video call" : "call"}</Button>
          ) : useSettingsCta ? (
            <Button onClick={handleOpenSettings} className="w-full gap-2">
              <SettingsIcon className="size-4" /> Open app settings
            </Button>
          ) : (
            <Button onClick={handleAllow} disabled={requesting || checking} className="w-full gap-2">
              {requesting ? <Loader2 className="size-4 animate-spin" /> : null}
              {askedOnce ? "Try again" : "Allow access"}
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel} className="w-full">Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermRow({
  icon, label, state, checking,
}: { icon: React.ReactNode; label: string; state: PermState; checking: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        {icon}
        <span>{label}</span>
      </div>
      {checking ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <StateBadge state={state} />
      )}
    </div>
  );
}

function StateBadge({ state }: { state: PermState }) {
  if (state === "granted") {
    return (
      <Badge variant="secondary" className="gap-1 text-emerald-600 bg-emerald-500/10 border-emerald-500/20">
        <CheckCircle2 className="size-3" /> Granted
      </Badge>
    );
  }
  if (state === "denied") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="size-3" /> Denied
      </Badge>
    );
  }
  if (state === "prompt") {
    return (
      <Badge variant="outline" className="gap-1">
        <AlertCircle className="size-3" /> Not granted
      </Badge>
    );
  }
  return <Badge variant="outline">Unknown</Badge>;
}
