import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyProfile, updateMyLanguage } from "@/lib/onboarding.functions";
import { listBlockedUsers } from "@/lib/account.functions";
import { unblockUser } from "@/lib/reports.functions";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LogOut, Shield, Languages, MapPin, Globe, UserCircle, Coins, ShieldAlert, FileText, HeartHandshake, BadgeIndianRupee, ChevronRight, UserX, Trash2, Download } from "lucide-react";
import { APP_LANGUAGES } from "@/lib/constants";
import { CreatorSafetyCard } from "@/components/creator-safety-card";
import { SpokenLanguagesCard } from "@/components/spoken-languages-card";
import { NotificationPrefsCard } from "@/components/notification-prefs-card";
import { CallSoundReadinessCard } from "@/components/call-sound-readiness-card";
import { PermissionDebugPanel } from "@/components/permission-debug-panel";
import { AvatarUploadCard } from "@/components/avatar-upload-card";
import { AiAvatarPicker } from "@/components/ai-avatar-picker";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
});

function Settings() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t, setLocale } = useT();
  const profileFn = useServerFn(getMyProfile);
  const langFn = useServerFn(updateMyLanguage);
  const blockedFn = useServerFn(listBlockedUsers);
  const unblockFn = useServerFn(unblockUser);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });
  const { data: blocked = [], isLoading: blockedLoading, isError: blockedError, refetch: refetchBlocked } = useQuery({
    queryKey: ["blocked-users"],
    queryFn: () => blockedFn(),
    retry: 1,
  });

  const langMut = useMutation({
    mutationFn: (language: string) => langFn({ data: { language } }),
    onSuccess: () => {
      toast.success(t("settings.langUpdated"));
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const unblockMut = useMutation({
    mutationFn: (targetUserId: string) => unblockFn({ data: { targetUserId } }),
    onSuccess: () => {
      toast.success("User unblocked");
      qc.invalidateQueries({ queryKey: ["blocked-users"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  // Realtime: refresh own follower/following counts instantly when someone
  // follows me, or I follow/unfollow someone — no page reload needed.
  const myId = me?.profile?.id as string | undefined;
  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      .channel(`settings-follows:${myId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "follows", filter: `following_id=eq.${myId}` },
        () => { qc.invalidateQueries({ queryKey: ["me"] }); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "follows", filter: `follower_id=eq.${myId}` },
        () => { qc.invalidateQueries({ queryKey: ["me"] }); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [myId, qc]);

  const p = me?.profile;

  return (
    <AppShell isAdmin={me?.isAdmin}>
      <h1 className="text-2xl font-bold mb-4">{t("settings.heading")}</h1>

      <Card className="glass p-6">
        <div className="flex items-center gap-4">
          <Avatar className="size-20">
            {p?.avatar_url && <AvatarImage src={p.avatar_url} />}
            <AvatarFallback className="brand-gradient text-primary-foreground font-bold text-2xl">
              {(p?.username ?? "?").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-semibold truncate">{p?.username ?? "—"}</p>
              {p?.is_creator && <Badge variant="secondary">Creator</Badge>}
              {me?.isAdmin && (
                <Badge className="bg-accent text-accent-foreground">
                  <Shield className="size-3 mr-1" />Admin
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground capitalize mt-0.5">
              {[p?.gender].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>

        {/* Followers / Following / Coins */}
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/40 py-3">
            <p className="text-lg font-bold">{me?.followerCount ?? 0}</p>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("settings.followers")}</p>
          </div>
          <div className="rounded-lg bg-muted/40 py-3">
            <p className="text-lg font-bold">{me?.followingCount ?? 0}</p>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("settings.following")}</p>
          </div>
          <div className="rounded-lg bg-coin/10 py-3">
            <p className="text-lg font-bold text-coin flex items-center justify-center gap-1">
              <Coins className="size-4" />
              {(me?.walletBalance ?? 0).toLocaleString("en-IN")}
            </p>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("settings.coins")}</p>
          </div>
        </div>
      </Card>

      {/* Profile photo (optional, with creator nudge for female users) */}
      <AvatarUploadCard
        username={p?.username}
        avatarUrl={p?.avatar_url}
        gender={p?.gender}
      />

      {p?.id && (
        <AiAvatarPicker
          userId={p.id}
          currentStyle={p.ai_avatar_style}
          gender={p.gender}
          hasPhoto={!!p.avatar_path}
        />
      )}


      {/* Profile details */}
      <Card className="glass mt-4 p-4 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("settings.profileDetails")}</p>
        <Row icon={<UserCircle className="size-4" />} label={t("onb.username")} value={p?.username ?? "—"} />
        <Row icon={<Globe className="size-4" />} label={t("onb.country")} value={p?.country ?? "—"} />
        <Row icon={<MapPin className="size-4" />} label={t("onb.state")} value={p?.state ?? "—"} />
        <Row icon={<Languages className="size-4" />} label={t("settings.languageRow")} value={labelForLang(p?.language)} />
      </Card>

      {/* App language */}
      <Card className="glass mt-4 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Languages className="size-4 text-primary" />
          <p className="text-sm font-semibold">{t("settings.appLang")}</p>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{t("settings.appLangHint")}</p>
        <Select
          value={p?.language ?? "en"}
          onValueChange={(v) => {
            setLocale(v as any);
            langMut.mutate(v);
          }}
          disabled={langMut.isPending}
        >
          <SelectTrigger><SelectValue placeholder={t("settings.selectLang")} /></SelectTrigger>
          <SelectContent>
            {APP_LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {/* Creator: additional spoken languages for matching */}
      <SpokenLanguagesCard />

      {/* Notification preferences */}
      <NotificationPrefsCard />

      {/* Ringtone volume / DND / channel-bypass readiness */}
      <CallSoundReadinessCard />

      {/* Creator safety: availability + country/state blocks (only renders if is_creator) */}
      <CreatorSafetyCard />

      {/* Mic / Camera permission diagnostics */}
      <div className="mt-4">
        <PermissionDebugPanel />
      </div>

      {/* Call reliability diagnostics */}
      <Card className="glass mt-4 p-4">
        <Link
          to="/diagnostics"
          className="flex items-center gap-3"
          aria-label="Open call reliability diagnostics"
        >
          <Shield className="size-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Call reliability diagnostics</p>
            <p className="text-xs text-muted-foreground">
              Check notifications, full-screen calls, battery, and recent missed calls.
            </p>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      </Card>



      {/* Blocked users */}
      <Card className="glass mt-4 p-4">
        <div className="flex items-center gap-2 mb-3">
          <UserX className="size-4 text-primary" />
          <p className="text-sm font-semibold">Blocked users</p>
          <Badge variant="secondary" className="ml-auto">{blocked.length}</Badge>
        </div>
        {blockedLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : blockedError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
            <p className="text-xs text-destructive">Couldn't load your blocked users list. Please try again.</p>
            <Button size="sm" variant="outline" onClick={() => refetchBlocked()}>Retry</Button>
          </div>
        ) : blocked.length === 0 ? (
          <p className="text-xs text-muted-foreground">You haven't blocked anyone. Use the block button on any profile, chat or call.</p>
        ) : (
          <ul className="space-y-2">
            {blocked.map((b) => (
              <li key={b.userId} className="flex items-center gap-3">
                <Avatar className="size-8">
                  {b.avatarUrl && <AvatarImage src={b.avatarUrl} />}
                  <AvatarFallback className="text-xs">{b.username.slice(0,2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="text-sm flex-1 truncate">{b.username}</span>
                <Button size="sm" variant="ghost" onClick={() => unblockMut.mutate(b.userId)} disabled={unblockMut.isPending}>
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Safety & legal links */}
      <Card className="glass mt-4 p-2">
        <LinkRow to="/safety" icon={<ShieldAlert className="size-4 text-primary" />} label="Safety Center" />
        <LinkRow to="/community-guidelines" icon={<HeartHandshake className="size-4 text-primary" />} label="Community Guidelines" />
        <LinkRow to="/privacy" icon={<Shield className="size-4 text-primary" />} label="Privacy Policy" />
        <LinkRow to="/terms" icon={<FileText className="size-4 text-primary" />} label="Terms of Service" />
        <LinkRow to="/refund-policy" icon={<BadgeIndianRupee className="size-4 text-primary" />} label="Refund Policy" />
        <LinkRow to="/data-export" icon={<Download className="size-4 text-primary" />} label="Download my data" />
      </Card>

      <Button onClick={signOut} variant="outline" className="mt-6 w-full">
        <LogOut className="size-4 mr-2" /> Sign out
      </Button>

      <Link
        to="/account-delete"
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-destructive/40 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 transition"
      >
        <Trash2 className="size-4" /> Delete my account
      </Link>

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        Support: <a className="underline" href="mailto:support@talkora.app">support@talkora.app</a><br />
        Grievance Officer (India): grievance@talkora.app
      </p>
    </AppShell>
  );
}

function LinkRow({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm hover:bg-muted/40 transition">
      {icon}
      <span className="flex-1">{label}</span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-muted-foreground">{icon}{label}</span>
      <span className="font-medium truncate max-w-[60%] text-right">{value}</span>
    </div>
  );
}

function labelForLang(code?: string | null) {
  if (!code) return "—";
  return APP_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
