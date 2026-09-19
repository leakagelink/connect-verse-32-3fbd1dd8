import { Link } from "@tanstack/react-router";
import { ShieldCheck, Lock, Eye, BadgeCheck, Headphones } from "lucide-react";

/**
 * Trust signals strip — shown at the bottom of Home / Discover.
 * Communicates moderation, privacy, and support to build user
 * confidence and meet Play Store trust expectations.
 */
export function TrustBadgesFooter() {
  return (
    <section className="mt-8 mb-6">
      <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="size-4 text-emerald-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">Why Talkora is safe</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
          <Badge icon={<Eye className="size-4" />} label="24×7 Moderated" color="text-emerald-400" />
          <Badge icon={<BadgeCheck className="size-4" />} label="Verified Creators" color="text-sky-400" />
          <Badge icon={<Lock className="size-4" />} label="Private & Encrypted" color="text-violet-400" />
          <Badge icon={<Headphones className="size-4" />} label="In-app SOS" color="text-rose-400" />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          <span>·</span>
          <Link to="/terms" className="hover:text-foreground">Terms</Link>
          <span>·</span>
          <Link to="/community-guidelines" className="hover:text-foreground">Community Guidelines</Link>
          <span>·</span>
          <Link to="/safety" className="hover:text-foreground">Safety Center</Link>
          <span>·</span>
          <Link to="/child-safety" className="hover:text-foreground">Child Safety</Link>
          <span>·</span>
          <Link to="/account-delete" className="hover:text-foreground">Delete Account</Link>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground/80">
          18+ only · AI + human moderation · Report any user from their profile or in-call SOS button.
        </p>
      </div>
    </section>
  );
}

function Badge({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-background/60 border border-border/60 px-2.5 py-2">
      <span className={color}>{icon}</span>
      <span className="text-[11px] font-medium leading-tight">{label}</span>
    </div>
  );
}
