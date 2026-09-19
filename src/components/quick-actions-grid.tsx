import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Phone, Video, Gamepad2, Radio } from "lucide-react";

const ACTIONS = [
  {
    label: "Voice Call",
    icon: Phone,
    to: "/connect" as const,
    desc: "Instant audio match",
    gradient: "from-emerald-500/30 to-teal-500/10",
    iconColor: "text-emerald-400",
  },
  {
    label: "Video Call",
    icon: Video,
    to: "/connect" as const,
    desc: "HD face-to-face",
    gradient: "from-fuchsia-500/30 to-pink-500/10",
    iconColor: "text-fuchsia-400",
  },
  {
    label: "Mystery Game",
    icon: Gamepad2,
    to: "/connect" as const,
    desc: "Solve & flirt",
    gradient: "from-amber-500/30 to-orange-500/10",
    iconColor: "text-amber-400",
  },
  {
    label: "Live Rooms",
    icon: Radio,
    to: "/rooms/new" as const,
    desc: "Join the party",
    gradient: "from-sky-500/30 to-indigo-500/10",
    iconColor: "text-sky-400",
  },
];

export function QuickActionsGrid() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {ACTIONS.map((a) => (
        <Link key={a.label} to={a.to}>
          <Card
            className={`glass relative overflow-hidden p-4 h-full hover:border-primary/50 transition bg-gradient-to-br ${a.gradient}`}
          >
            <div className="absolute -right-4 -bottom-4 size-20 rounded-full bg-white/5 blur-2xl" />
            <a.icon className={`size-6 mb-2 ${a.iconColor}`} />
            <p className="font-semibold text-sm">{a.label}</p>
            <p className="text-[11px] text-muted-foreground">{a.desc}</p>
          </Card>
        </Link>
      ))}
    </div>
  );
}
