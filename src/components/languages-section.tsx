import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listOnlineCreators } from "@/lib/presence.functions";
import { APP_LANGUAGES } from "@/lib/constants";
import { LiveCreatorsStrip } from "@/components/live-creators-strip";
import { Badge } from "@/components/ui/badge";
import { Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function LanguagesSection({
  onCall,
}: {
  onCall: (userId: string, kind: "voice" | "video") => void;
}) {
  const onlineCreators = useServerFn(listOnlineCreators);
  const { data } = useQuery({
    queryKey: ["online-creators"],
    queryFn: () => onlineCreators(),
    staleTime: 30_000,
  });
  const creators = data?.creators ?? [];

  // Only show languages that actually have creators (plus "All")
  const availableLangs = useMemo(() => {
    const set = new Set<string>();
    for (const c of creators) if (c.language) set.add(c.language);
    return APP_LANGUAGES.filter((l) => set.has(l.code));
  }, [creators]);

  const [selected, setSelected] = useState<string>("all");
  // `paused` is the *effective* pause state; `userPaused` is the sticky
  // tap-to-pause toggle. Hover & tab-hidden pause transiently without
  // affecting userPaused, so returning focus resumes smoothly.
  const [userPaused, setUserPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [hiddenPaused, setHiddenPaused] = useState(false);
  const paused = userPaused || hoverPaused || hiddenPaused;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0); // preserved across pause/resume for smooth continuation

  // Resume when the tab regains visibility.
  useEffect(() => {
    const onVis = () => setHiddenPaused(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Auto-slide chips: translate the track leftwards continuously while unpaused.
  useEffect(() => {
    if (paused || availableLangs.length < 3) return;
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    const step = () => {
      offsetRef.current -= 0.4; // px per frame ≈ slow drift
      const half = el.scrollWidth / 2;
      if (-offsetRef.current >= half) offsetRef.current = 0;
      el.style.transform = `translateX(${offsetRef.current}px)`;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [paused, availableLangs.length]);


  const filtered = useMemo(() => {
    if (selected === "all") return creators;
    return creators.filter((c: any) => c.language === selected);
  }, [creators, selected]);

  if (availableLangs.length === 0) return null;

  // Duplicate chips so the marquee can loop seamlessly.
  const loopChips = [...availableLangs, ...availableLangs];

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Globe2 className="size-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider">Languages</h2>
          <Badge variant="secondary" className="text-[10px]">{availableLangs.length}</Badge>
        </div>
        {selected !== "all" && (
          <button
            onClick={() => setSelected("all")}
            className="text-xs text-primary font-medium"
          >
            Clear
          </button>
        )}
      </div>

      {/* Auto-sliding chip rail. Tap toggles a sticky pause; hover pauses transiently on desktop. */}
      <div
        className="relative overflow-hidden -mx-1 px-1 mb-3"
        onMouseEnter={() => setHoverPaused(true)}
        onMouseLeave={() => setHoverPaused(false)}
        onPointerDown={(e) => {
          // Only toggle when the rail background is tapped, not a chip.
          if ((e.target as HTMLElement).closest("button")) return;
          setUserPaused((p) => !p);
        }}
      >
        <div
          ref={trackRef}
          className="flex gap-2 w-max will-change-transform"
        >
          <button
            onClick={() => setSelected("all")}
            className={cn(
              "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors",
              selected === "all"
                ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/30"
                : "bg-card/60 border-border hover:bg-card",
            )}
          >
            All
          </button>
          {loopChips.map((l, i) => {
            const active = selected === l.code;
            return (
              <button
                key={`${l.code}-${i}`}
                onClick={() => { setSelected(l.code); setUserPaused(true); }}
                className={cn(
                  "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/30"
                    : "bg-card/60 border-border hover:bg-card",
                )}
              >
                {l.name}
              </button>
            );
          })}
        </div>
        {/* edge fade */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent" />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-7 px-4 border border-dashed rounded-xl bg-card/30">
          <Globe2 className="size-6 text-muted-foreground/70" />
          <p className="text-sm font-medium">
            No live creators in{" "}
            <span className="text-foreground">
              {APP_LANGUAGES.find((l) => l.code === selected)?.name ?? "this language"}
            </span>{" "}
            right now.
          </p>
          <p className="text-xs text-muted-foreground">Try another language or see everyone who's live.</p>
          <button
            onClick={() => setSelected("all")}
            className="mt-1 text-xs font-semibold text-primary hover:underline"
          >
            Show all live creators →
          </button>
        </div>
      ) : (
        <LiveCreatorsStrip users={filtered} loading={false} onCall={onCall} />
      )}
    </div>
  );
}
