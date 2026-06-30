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
    <div className="min-h-screen grid place-items-center px-4 py-8">
      <Card className="glass w-full max-w-lg p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">{t("onb.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("onb.subtitle")}</p>
        </div>
        <div><Label>{t("onb.username")}</Label><Input value={username} onChange={(e) => setU(e.target.value)} placeholder={t("onb.usernamePh")} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("onb.gender")}</Label>
            <Select value={gender} onValueChange={(v) => setG(v as any)}>
              <SelectTrigger><SelectValue placeholder={t("onb.selectPlaceholder")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="female">{t("onb.female")}</SelectItem>
                <SelectItem value="male">{t("onb.male")}</SelectItem>
                <SelectItem value="other">{t("onb.other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>{t("onb.dob")}</Label><Input type="date" value={dob} onChange={(e) => setD(e.target.value)} max={new Date().toISOString().slice(0,10)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("onb.country")}</Label>
            <Select value={country} onValueChange={(v) => { setC(v); setSt(""); }}>
              <SelectTrigger><SelectValue placeholder={t("onb.selectCountry")} /></SelectTrigger>
              <SelectContent className="max-h-72">
                {COUNTRIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("onb.state")}</Label>
            {STATES_BY_COUNTRY[country]?.length ? (
              <Select value={state} onValueChange={setSt}>
                <SelectTrigger><SelectValue placeholder={t("onb.selectState")} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {STATES_BY_COUNTRY[country].map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={state} onChange={(e) => setSt(e.target.value)} placeholder={t("onb.statePh")} />
            )}
          </div>
        </div>
        <div>
          <Label>{t("onb.language")}</Label>
          <Select value={language} onValueChange={setL}>
            <SelectTrigger><SelectValue placeholder={t("settings.selectLang")} /></SelectTrigger>
            <SelectContent className="max-h-72">
              {APP_LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("onb.langHint")}</p>
        </div>

        {gender === "female" && (
          <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent/10 p-3">
            <div>
              <p className="text-sm font-medium">{t("onb.joinCreator")}</p>
              <p className="text-xs text-muted-foreground">{t("onb.joinCreatorHint")}</p>
            </div>
            <Switch checked={creator} onCheckedChange={setCr} />
          </div>
        )}

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox checked={accept} onCheckedChange={(v) => setA(!!v)} className="mt-0.5" />
          <span className="text-muted-foreground">{t("onb.guidelines")}</span>
        </label>

        <Button onClick={submit} disabled={busy || !accept} className="w-full brand-gradient text-primary-foreground">
          {t("onb.cta")}
        </Button>
      </Card>
    </div>
  );
}
