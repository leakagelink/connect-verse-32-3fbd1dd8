import { createFileRoute, isRedirect, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useServerFn } from "@tanstack/react-start";
import { getMyProfile, completeOnboarding } from "@/lib/onboarding.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { COUNTRIES, STATES_BY_COUNTRY } from "@/lib/locations";
import { APP_LANGUAGES } from "@/lib/constants";
import { useT } from "@/lib/i18n";
import { AI_AVATAR_STYLES, aiAvatarUrl, pickDefaultStyle } from "@/lib/ai-avatar";
import { Check, Shuffle, Lock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/onboarding")({
  beforeLoad: async ({ context }) => {
    const qc = (context as any)?.queryClient;
    try {
      const me = qc
        ? await qc.fetchQuery({
            queryKey: ["me"],
            queryFn: () => getMyProfile(),
            staleTime: 0,
          })
        : await getMyProfile();
      if (me?.profile?.is_banned) throw redirect({ to: "/banned", replace: true });
      if (me?.profile?.onboarded) throw redirect({ to: "/home", replace: true });
    } catch (e: any) {
      if (isRedirect(e)) throw e;
      // network/auth hiccup — let the page render and re-check client-side
    }
  },
  component: Onboarding,
});


function Onboarding() {
  const navigate = useNavigate();
  const getProfile = useServerFn(getMyProfile);
  const onboard = useServerFn(completeOnboarding);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["me"], queryFn: () => getProfile() });
  const { t } = useT();


  const [username, setU] = useState("");
  const [gender, setG] = useState<"male"|"female"|"other"|"">("");
  const [dob, setD] = useState("");
  const [country, setC] = useState("India");
  const [state, setSt] = useState("");
  const [language, setL] = useState("hi");
  const [accept, setA] = useState(false);
  const [creator, setCr] = useState(false);
  const [busy, setBusy] = useState(false);
  // Cute AI avatar — seed lets user "shuffle" the look without changing style.
  const [avatarStyle, setAvatarStyle] = useState<string>("lorelei");
  const [avatarSeedSalt, setAvatarSeedSalt] = useState(0);
  const [avatarLocked, setAvatarLocked] = useState(false);

  useEffect(() => {
    if (data?.profile?.is_banned) navigate({ to: "/banned", replace: true });
    if (data?.profile?.onboarded) navigate({ to: "/home", replace: true });
  }, [data, navigate]);

  // When gender flips, suggest the matching cute default — but never overwrite
  // a style the user has already explicitly locked.
  useEffect(() => {
    if (avatarLocked) return;
    setAvatarStyle(pickDefaultStyle(gender || null, creator));
  }, [gender, creator, avatarLocked]);

  const avatarSeed = useMemo(
    () => `${data?.profile?.id ?? "preview"}|${avatarSeedSalt}`,
    [data?.profile?.id, avatarSeedSalt],
  );
  const previewUrl = useMemo(
    () => aiAvatarUrl(avatarSeed, avatarStyle, gender || null, creator),
    [avatarSeed, avatarStyle, gender, creator],
  );

  async function submit() {
    if (!gender || !dob) return toast.error("Fill all fields");
    setBusy(true);
    try {
      await onboard({ data: { username, gender, dob, country, state: state || undefined, language, acceptGuidelines: true as const, asCreator: creator, aiAvatarStyle: avatarStyle as any } });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.refetchQueries({ queryKey: ["me"] });
      toast.success(t("onb.welcome"));
      navigate({ to: "/home", replace: true });

    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">{t("common.loading")}</div>;

  return (
    <div className="min-h-[100dvh] w-full bg-background sm:grid sm:place-items-center sm:px-4 sm:py-8">
      <Card
        className="glass w-full sm:max-w-lg rounded-none sm:rounded-2xl border-0 sm:border p-4 sm:p-6 space-y-4"
        style={{
          paddingTop: "max(1rem, env(safe-area-inset-top))",
          paddingBottom: "max(6rem, calc(env(safe-area-inset-bottom) + 5.5rem))",
        }}
      >
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">{t("onb.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("onb.subtitle")}</p>
        </div>

        {/* Cute AI avatar — instant preview + style chips + lock-in */}
        <div className="rounded-xl border border-border/50 bg-card/40 p-3 sm:p-4 space-y-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="relative shrink-0">
              <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-full overflow-hidden ring-2 ring-primary/40 bg-muted">
                <img key={previewUrl} src={previewUrl} alt="Your AI avatar" className="h-full w-full object-cover" />
              </div>
              {avatarLocked && (
                <span className="absolute -bottom-1 -right-1 grid place-items-center h-6 w-6 rounded-full bg-primary text-primary-foreground shadow">
                  <Check className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Your cute AI avatar</p>
              <p className="text-xs text-muted-foreground">Pick a style or shuffle. Change later in Settings.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 px-3"
                  onClick={() => { setAvatarSeedSalt((n) => n + 1); setAvatarLocked(false); }}
                >
                  <Shuffle className="h-3.5 w-3.5 mr-1" /> Shuffle
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={avatarLocked ? "secondary" : "default"}
                  className="h-9 px-3"
                  onClick={() => { setAvatarLocked(true); toast.success("Avatar locked in ✨"); }}
                >
                  {avatarLocked ? (<><Check className="h-3.5 w-3.5 mr-1" /> Locked</>) : (<><Lock className="h-3.5 w-3.5 mr-1" /> Confirm</>)}
                </Button>
              </div>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {AI_AVATAR_STYLES.map((s) => {
              const selected = s.id === avatarStyle;
              const thumb = aiAvatarUrl(avatarSeed, s.id, gender || null, creator);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setAvatarStyle(s.id); setAvatarLocked(false); }}
                  className={`flex-shrink-0 snap-start flex flex-col items-center gap-1 rounded-lg p-1.5 transition ${selected ? "ring-2 ring-primary bg-primary/10" : "hover:bg-muted/60 active:bg-muted"}`}
                  aria-label={`Use ${s.label} avatar style`}
                >
                  <img src={thumb} alt="" className="h-11 w-11 rounded-full object-cover bg-muted" />
                  <span className="text-[10px] leading-none text-muted-foreground">{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t("onb.username")}</Label>
          <Input value={username} onChange={(e) => setU(e.target.value)} placeholder={t("onb.usernamePh")} className="h-11 text-base" autoComplete="username" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{t("onb.gender")}</Label>
            <Select value={gender} onValueChange={(v) => setG(v as any)}>
              <SelectTrigger className="h-11"><SelectValue placeholder={t("onb.selectPlaceholder")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="female">{t("onb.female")}</SelectItem>
                <SelectItem value="male">{t("onb.male")}</SelectItem>
                <SelectItem value="other">{t("onb.other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("onb.dob")}</Label>
            <Input type="date" value={dob} onChange={(e) => setD(e.target.value)} max={new Date().toISOString().slice(0,10)} className="h-11 text-base" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{t("onb.country")}</Label>
            <Select value={country} onValueChange={(v) => { setC(v); setSt(""); }}>
              <SelectTrigger className="h-11"><SelectValue placeholder={t("onb.selectCountry")} /></SelectTrigger>
              <SelectContent className="max-h-72">
                {COUNTRIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("onb.state")}</Label>
            {STATES_BY_COUNTRY[country]?.length ? (
              <Select value={state} onValueChange={setSt}>
                <SelectTrigger className="h-11"><SelectValue placeholder={t("onb.selectState")} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {STATES_BY_COUNTRY[country].map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={state} onChange={(e) => setSt(e.target.value)} placeholder={t("onb.statePh")} className="h-11 text-base" />
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>{t("onb.language")}</Label>
          <Select value={language} onValueChange={setL}>
            <SelectTrigger className="h-11"><SelectValue placeholder={t("settings.selectLang")} /></SelectTrigger>
            <SelectContent className="max-h-72">
              {APP_LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("onb.langHint")}</p>
        </div>

        {gender === "female" && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("onb.joinCreator")}</p>
              <p className="text-xs text-muted-foreground">{t("onb.joinCreatorHint")}</p>
            </div>
            <Switch checked={creator} onCheckedChange={setCr} className="shrink-0" />
          </div>
        )}

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox checked={accept} onCheckedChange={(v) => setA(!!v)} className="mt-0.5" />
          <span className="text-muted-foreground">{t("onb.guidelines")}</span>
        </label>

        {/* Sticky CTA on mobile so submit is always reachable above the keyboard/nav */}
        <div
          className="sticky bottom-0 -mx-4 sm:mx-0 px-4 sm:px-0 pt-3 pb-3 sm:pt-0 sm:pb-0 bg-gradient-to-t from-background via-background/95 to-background/0 sm:bg-none"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <Button onClick={submit} disabled={busy || !accept} className="w-full h-12 text-base brand-gradient text-primary-foreground">
            {t("onb.cta")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
