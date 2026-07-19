import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Accessibility, Contrast, Type, Zap } from "lucide-react";
import {
  A11Y_DEFAULTS,
  applyA11yPrefs,
  readA11yPrefs,
  writeA11yPrefs,
  type A11yPrefs,
  type A11yTextScale,
} from "@/lib/a11y";

const SCALE_OPTIONS: { value: A11yTextScale; label: string; sample: string }[] = [
  { value: "default", label: "Default", sample: "Aa" },
  { value: "lg", label: "Large (112%)", sample: "Aa" },
  { value: "xl", label: "Extra large (125%)", sample: "Aa" },
];

export function AccessibilitySettingsCard() {
  const [prefs, setPrefs] = useState<A11yPrefs>(A11Y_DEFAULTS);

  useEffect(() => {
    const p = readA11yPrefs();
    setPrefs(p);
    applyA11yPrefs(p);
  }, []);

  function update(patch: Partial<A11yPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeA11yPrefs(next);
    applyA11yPrefs(next);
  }

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Accessibility className="size-5 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold">Accessibility</h2>
      </div>

      {/* Contrast */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Label htmlFor="a11y-contrast" className="flex items-center gap-2 text-sm font-medium">
            <Contrast className="size-4" aria-hidden="true" />
            High contrast
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            AAA-level contrast for text, buttons, and borders. Removes decorative glows.
          </p>
        </div>
        <Switch
          id="a11y-contrast"
          checked={prefs.contrast === "high"}
          onCheckedChange={(v) => update({ contrast: v ? "high" : "default" })}
          aria-label="Toggle high contrast theme"
        />
      </div>

      {/* Text scale */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Type className="size-4" aria-hidden="true" />
          <span className="text-sm font-medium">Text size</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Scales every text and spacing across the app.
        </p>
        <div
          role="radiogroup"
          aria-label="Text size"
          className="grid grid-cols-3 gap-2"
        >
          {SCALE_OPTIONS.map((opt) => {
            const selected = prefs.textScale === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => update({ textScale: opt.value })}
                className={[
                  "flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-3 text-xs transition-colors min-h-16",
                  selected
                    ? "border-primary bg-primary-soft text-foreground"
                    : "border-border bg-surface hover:bg-muted",
                ].join(" ")}
              >
                <span
                  className={
                    opt.value === "default"
                      ? "text-base font-semibold"
                      : opt.value === "lg"
                        ? "text-lg font-semibold"
                        : "text-xl font-semibold"
                  }
                >
                  {opt.sample}
                </span>
                <span className="text-[11px] text-muted-foreground">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Motion */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Label htmlFor="a11y-motion" className="flex items-center gap-2 text-sm font-medium">
            <Zap className="size-4" aria-hidden="true" />
            Reduce motion
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Turns off transitions and animations. Helpful for motion sensitivity.
          </p>
        </div>
        <Switch
          id="a11y-motion"
          checked={prefs.motion === "reduced"}
          onCheckedChange={(v) => update({ motion: v ? "reduced" : "system" })}
          aria-label="Reduce motion"
        />
      </div>
    </Card>
  );
}
