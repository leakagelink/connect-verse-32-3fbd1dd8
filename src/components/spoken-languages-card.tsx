import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyProfile, updateMySpokenLanguages } from "@/lib/onboarding.functions";
import { APP_LANGUAGES } from "@/lib/constants";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Languages, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

/**
 * Creator-only: pick the additional languages you can talk in.
 * Users searching/calling in those languages will be matched to you.
 */
export function SpokenLanguagesCard() {
  const profileFn = useServerFn(getMyProfile);
  const updateFn = useServerFn(updateMySpokenLanguages);
  const qc = useQueryClient();
  const { t } = useT();

  const { data } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });
  const p: any = (data as any)?.profile;
  const isCreator = !!p?.is_creator;

  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!p) return;
    // Seed from DB; ensure primary language is always present.
    const fromDb: string[] = Array.isArray(p.languages) ? p.languages : [];
    const merged = Array.from(new Set([p.language, ...fromDb].filter(Boolean)));
    setSelected(merged);
  }, [p?.id, p?.language, JSON.stringify(p?.languages)]);

  const mut = useMutation({
    mutationFn: (langs: string[]) => updateFn({ data: { languages: langs } }),
    onSuccess: () => {
      toast.success(t("settings.spokenLangsSaved") || "Languages updated");
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["online-creators"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!isCreator) return null;

  const toggle = (code: string) => {
    // Primary language cannot be removed — it's always part of the set.
    if (code === p.language) return;
    const next = selected.includes(code)
      ? selected.filter((c) => c !== code)
      : [...selected, code];
    setSelected(next);
    mut.mutate(next);
  };

  return (
    <Card className="glass mt-4 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Languages className="size-4 text-primary" />
        <p className="text-sm font-semibold">
          {t("settings.spokenLangsTitle") || "Languages you can talk in"}
        </p>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {t("settings.spokenLangsHint") ||
          "Users matching any of these languages will see you in Connect."}
      </p>
      <div className="flex flex-wrap gap-2">
        {APP_LANGUAGES.map((l) => {
          const active = selected.includes(l.code);
          const isPrimary = l.code === p.language;
          return (
            <button
              key={l.code}
              type="button"
              disabled={mut.isPending || isPrimary}
              onClick={() => toggle(l.code)}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              } ${isPrimary ? "opacity-90" : ""}`}
              aria-pressed={active}
            >
              {active ? <Check className="size-3" /> : <Plus className="size-3" />}
              <span>{l.name}</span>
              {isPrimary && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  Primary
                </Badge>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
