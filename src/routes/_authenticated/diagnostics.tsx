import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  Bell,
  BellOff,
  BatteryCharging,
  PhoneIncoming,
  PhoneMissed,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  ShieldAlert,
  ChevronLeft,
  RefreshCw,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getPushPermissionState,
  requestPushPermission,
  openAppSettings,
  checkFullScreenIntentPermission,
  openFullScreenIntentSettings,
  getBackgroundReliabilityStatus,
  requestIgnoreBatteryOptimizations,
  openAutostartSettings,
  openBatterySettings,
  isNative,
  platform,
  type BackgroundReliabilityStatus,
  type OemVendor,
  type PermState,
} from "@/lib/native";
import { listRecentCalls, type RecentCall } from "@/lib/calls.functions";

export const Route = createFileRoute("/_authenticated/diagnostics")({
  component: DiagnosticsPage,
  head: () => ({
    meta: [{ title: "Call reliability diagnostics — Talkora" }],
  }),
});

const VENDOR_LABEL: Record<OemVendor, string> = {
  xiaomi: "Xiaomi / Redmi / Poco",
  vivo: "Vivo / iQOO",
  oppo: "Oppo",
  realme: "Realme",
  oneplus: "OnePlus",
  honor: "Honor",
  huawei: "Huawei",
  samsung: "Samsung",
  asus: "Asus",
  letv: "LeEco",
  nokia: "Nokia",
  stock: "Stock Android",
};

type CheckTone = "ok" | "warn" | "bad" | "info";

function ToneBadge({ tone, children }: { tone: CheckTone; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
        : tone === "bad"
          ? "bg-destructive/15 text-destructive border-destructive/30"
          : "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={`shrink-0 ${cls}`}>
      {children}
    </Badge>
  );
}

function CheckRow({
  icon,
  title,
  detail,
  tone,
  badge,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  detail: React.ReactNode;
  tone: CheckTone;
  badge: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-3">
      <div
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
          tone === "ok"
            ? "bg-emerald-500/15 text-emerald-500"
            : tone === "warn"
              ? "bg-amber-500/15 text-amber-500"
              : tone === "bad"
                ? "bg-destructive/15 text-destructive"
                : "bg-muted text-foreground"
        }`}
        aria-hidden
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{title}</p>
          <ToneBadge tone={tone}>{badge}</ToneBadge>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
        {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

function permTone(state: PermState | null): CheckTone {
  if (state === "granted") return "ok";
  if (state === "denied") return "bad";
  if (state === "prompt") return "warn";
  return "info";
}

function permBadge(state: PermState | null): string {
  if (state === "granted") return "Allowed";
  if (state === "denied") return "Blocked";
  if (state === "prompt") return "Not set";
  return "Unknown";
}

function DiagnosticsPage() {
  const [push, setPush] = useState<PermState | null>(null);
  const [fsi, setFsi] = useState<{ granted: boolean; required: boolean } | null>(null);
  const [bg, setBg] = useState<BackgroundReliabilityStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const listRecentFn = useServerFn(listRecentCalls);
  const { data: recents = [], isLoading: recentsLoading, refetch: refetchRecents } = useQuery({
    queryKey: ["diagnostics-recents"],
    queryFn: () => listRecentFn(),
  });

  const refreshAll = async () => {
    const [p, f, b] = await Promise.all([
      getPushPermissionState(),
      checkFullScreenIntentPermission(),
      getBackgroundReliabilityStatus(),
    ]);
    setPush(p);
    setFsi(f);
    setBg(b);
  };

  useEffect(() => {
    void refreshAll();
    const onFocus = () => void refreshAll();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const incomingFailures = (recents as RecentCall[])
    .filter((r) => r.direction === "incoming" && (r.status === "missed" || r.status === "cancelled"))
    .slice(0, 10);

  // Aggregate health: ok if all three checks pass, warn if any "warn", bad otherwise.
  const tones: CheckTone[] = [
    permTone(push),
    fsi && fsi.required ? (fsi.granted ? "ok" : "bad") : "ok",
    bg ? (bg.recommended ? (bg.batteryOptIgnored ? "warn" : "bad") : "ok") : "info",
  ];
  const overall: CheckTone = tones.includes("bad")
    ? "bad"
    : tones.includes("warn")
      ? "warn"
      : tones.includes("info")
        ? "info"
        : "ok";

  return (
    <AppShell title="Diagnostics" showBack>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" /> Settings
          </Link>
          <div className="ml-auto" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setRefreshKey((k) => k + 1);
              void refetchRecents();
            }}
            className="h-8"
            disabled={busy !== null}
          >
            <RefreshCw className="mr-1.5 size-3.5" /> Refresh
          </Button>
        </div>

        {/* Overall summary */}
        <Card className="glass p-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex size-10 items-center justify-center rounded-full ${
                overall === "ok"
                  ? "bg-emerald-500/15 text-emerald-500"
                  : overall === "warn"
                    ? "bg-amber-500/15 text-amber-500"
                    : overall === "bad"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-foreground"
              }`}
            >
              {overall === "ok" ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Call reliability</p>
              <p className="text-xs text-muted-foreground">
                {overall === "ok"
                  ? "All systems set — incoming calls should ring even when Talkora is closed."
                  : overall === "warn"
                    ? "One or more settings can still be improved."
                    : overall === "bad"
                      ? "Something is blocking incoming calls. Fix the items below."
                      : "Checking…"}
              </p>
            </div>
            <ToneBadge tone={overall}>
              {overall === "ok"
                ? "Healthy"
                : overall === "warn"
                  ? "Needs review"
                  : overall === "bad"
                    ? "Action needed"
                    : "Unknown"}
            </ToneBadge>
          </div>
        </Card>

        {/* Individual checks */}
        <Card className="glass p-4">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <p className="text-sm font-semibold">Permission checks</p>
          </div>
          <div className="space-y-2">
            {/* Notifications */}
            <CheckRow
              icon={push === "denied" ? <BellOff className="size-4" /> : <Bell className="size-4" />}
              title="Notifications"
              tone={permTone(push)}
              badge={permBadge(push)}
              detail={
                push === "granted"
                  ? "Talkora can show incoming call rings and message alerts."
                  : push === "denied"
                    ? "Blocked — you won't get any call or chat notifications. Open Settings to allow."
                    : push === "prompt"
                      ? "Not yet decided. Allow to receive call rings."
                      : "Not supported on this device."
              }
              actions={
                push === "denied" ? (
                  <Button
                    size="sm"
                    onClick={async () => {
                      setBusy("push");
                      await openAppSettings();
                      setBusy(null);
                    }}
                    disabled={busy !== null || !isNative()}
                    className="h-7"
                  >
                    <SettingsIcon className="mr-1.5 size-3.5" /> Open Settings
                  </Button>
                ) : push === "prompt" ? (
                  <Button
                    size="sm"
                    onClick={async () => {
                      setBusy("push");
                      const next = await requestPushPermission();
                      setPush(next);
                      setBusy(null);
                    }}
                    disabled={busy !== null}
                    className="h-7"
                  >
                    <Bell className="mr-1.5 size-3.5" /> Enable
                  </Button>
                ) : null
              }
            />

            {/* Full-screen intent (Android 14+) */}
            <CheckRow
              icon={<PhoneIncoming className="size-4" />}
              title="Full-screen incoming calls"
              tone={fsi ? (fsi.required ? (fsi.granted ? "ok" : "bad") : "ok") : "info"}
              badge={
                fsi
                  ? fsi.required
                    ? fsi.granted
                      ? "Allowed"
                      : "Blocked"
                    : "Not required"
                  : "Unknown"
              }
              detail={
                fsi
                  ? fsi.required
                    ? fsi.granted
                      ? "Calls can pop the full call screen even when locked."
                      : "Android 14+ is hiding the full-screen ringer. Grant to make calls pop the full screen."
                    : "Your Android version grants this automatically."
                  : "Only checked on the native app."
              }
              actions={
                fsi && fsi.required && !fsi.granted ? (
                  <Button
                    size="sm"
                    onClick={async () => {
                      setBusy("fsi");
                      await openFullScreenIntentSettings();
                      setBusy(null);
                    }}
                    disabled={busy !== null}
                    className="h-7"
                  >
                    <SettingsIcon className="mr-1.5 size-3.5" /> Open Settings
                  </Button>
                ) : null
              }
            />

            {/* Background reliability */}
            <CheckRow
              icon={<BatteryCharging className="size-4" />}
              title="Background reliability"
              tone={bg ? (bg.recommended ? (bg.batteryOptIgnored ? "warn" : "bad") : "ok") : "info"}
              badge={
                bg
                  ? bg.recommended
                    ? bg.batteryOptIgnored
                      ? "Improve"
                      : "Action needed"
                    : "Healthy"
                  : "Unknown"
              }
              detail={
                bg ? (
                  <span>
                    Device: <strong>{VENDOR_LABEL[bg.vendor]}</strong>
                    {" · "}
                    Battery exemption:{" "}
                    <strong>{bg.batteryOptIgnored ? "On" : "Off"}</strong>
                    {bg.autostartSupported ? (
                      <>
                        {" · "}Autostart deep-link available
                      </>
                    ) : null}
                  </span>
                ) : (
                  "Only checked on the native app."
                )
              }
              actions={
                bg && bg.recommended ? (
                  <>
                    {!bg.batteryOptIgnored && (
                      <Button
                        size="sm"
                        onClick={async () => {
                          setBusy("battery");
                          await requestIgnoreBatteryOptimizations();
                          const next = await getBackgroundReliabilityStatus();
                          setBg(next);
                          setBusy(null);
                        }}
                        disabled={busy !== null}
                        className="h-7"
                      >
                        <BatteryCharging className="mr-1.5 size-3.5" /> Allow battery
                      </Button>
                    )}
                    {bg.autostartSupported && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          setBusy("autostart");
                          await openAutostartSettings();
                          setBusy(null);
                        }}
                        disabled={busy !== null}
                        className="h-7"
                      >
                        <RotateCcw className="mr-1.5 size-3.5" /> Autostart
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        setBusy("batterylist");
                        await openBatterySettings();
                        setBusy(null);
                      }}
                      disabled={busy !== null}
                      className="h-7"
                    >
                      Battery settings
                    </Button>
                  </>
                ) : null
              }
            />
          </div>

          <div className="mt-3 text-[11px] text-muted-foreground">
            Platform: <strong>{isNative() ? platform() : "web"}</strong>
            {bg ? <> · Vendor: <strong>{bg.vendor}</strong></> : null}
          </div>
        </Card>

        {/* Recent incoming-call failures */}
        <Card className="glass p-4">
          <div className="mb-3 flex items-center gap-2">
            <PhoneMissed className="size-4 text-primary" />
            <p className="text-sm font-semibold">Recent incoming-call issues</p>
            <Badge variant="secondary" className="ml-auto">
              {incomingFailures.length}
            </Badge>
          </div>
          {recentsLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : incomingFailures.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No missed or cancelled incoming calls in your last 100 calls. 🎉
            </p>
          ) : (
            <ul className="space-y-2">
              {incomingFailures.map((c) => {
                const reasonLabel =
                  c.status === "cancelled"
                    ? "Caller cancelled"
                    : c.missed_reason === "expired"
                      ? "No answer (expired)"
                      : c.missed_reason === "callee_rejected"
                        ? "You declined"
                        : c.missed_reason === "caller_cancelled"
                          ? "Caller cancelled"
                          : "Missed";
                const tone: CheckTone =
                  c.missed_reason === "expired" ? "bad" : "warn";
                return (
                  <li
                    key={c.id}
                    className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-2.5"
                  >
                    <div
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                        tone === "bad"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-amber-500/15 text-amber-500"
                      }`}
                    >
                      <PhoneMissed className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {c.partner.username ?? "Unknown user"}
                        </p>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {c.kind}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {reasonLabel} ·{" "}
                        {formatDistanceToNow(new Date(c.started_at), { addSuffix: true })}
                      </p>
                    </div>
                    <ToneBadge tone={tone}>
                      {c.missed_reason === "expired" ? "Likely killed" : "Missed"}
                    </ToneBadge>
                  </li>
                );
              })}
            </ul>
          )}
          {incomingFailures.some((c) => c.missed_reason === "expired") && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-600 dark:text-amber-400">
              Expired calls usually mean Android killed Talkora before the ring
              could reach you. Enable battery exemption + Autostart above to
              fix this.
            </p>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
