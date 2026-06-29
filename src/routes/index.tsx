import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MessageCircle, Shield, Coins, Sparkles, Users, Heart } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { supabase } from "@/integrations/supabase/client";
import talkoraLogo from "@/assets/talkora-logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `${APP_NAME} — Voice Chat & Live Rooms` },
      { name: "description", content: "Talkora — join voice rooms, chat with friends and meet new people safely. Get 5 free minutes on signup." },
      { property: "og:title", content: `${APP_NAME} — Voice Chat & Live Rooms` },
      { property: "og:description", content: "Join voice rooms, chat & meet new friends safely on Talkora." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        navigate({ to: "/home", replace: true });
      } else {
        setChecking(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigate({ to: "/home", replace: true });
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [navigate]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="size-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (

    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-bold text-lg">
          <img src={talkoraLogo.url} alt={`${APP_NAME} logo`} width={32} height={32} className="size-8 rounded-lg" />
          {APP_NAME}
        </div>
        <Link to="/auth"><Button variant="ghost">Sign in</Button></Link>
      </header>

      <section className="mx-auto max-w-4xl px-6 pt-12 pb-20 text-center">
        <span className="inline-flex items-center gap-1 rounded-full glass px-3 py-1 text-xs text-muted-foreground">
          <Heart className="size-3 text-primary" /> Safe · Verified · 18+
        </span>
        <h1 className="mt-6 text-5xl md:text-7xl font-bold tracking-tight">
          Voice rooms.<br /><span className="text-gradient">Real conversations.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          {APP_NAME} is a premium voice-first community where verified members chat, host live rooms and meet new friends — safely. Get <strong className="text-foreground">5 free minutes</strong> on signup.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/auth"><Button size="lg" className="brand-gradient text-primary-foreground">Get started — free</Button></Link>
          <a href="#how" className="text-sm text-muted-foreground hover:text-foreground">How it works ↓</a>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 pb-24 grid gap-4 md:grid-cols-3">
        {[
          { icon: MessageCircle, t: "Realtime chat", d: "1-on-1 messaging with verified members across the world." },
          { icon: Coins, t: "Coin economy", d: "Recharge once and chat freely. Up to 50% bonus on your first deposit." },
          { icon: Shield, t: "Strong safety", d: "18+ only. One-tap block & report. Active human moderation." },
          { icon: Users, t: "Creator program", d: "Eligible members can earn coins from chats. KYC required to withdraw." },
          { icon: Sparkles, t: "Coming soon", d: "HD voice & video calls, live rooms and mini games." },
          { icon: Heart, t: "Made for everyone", d: "Free signup for all. Girls always join free." },
        ].map((f) => (
          <Card key={f.t} className="glass p-6">
            <f.icon className="size-6 text-primary" />
            <h3 className="mt-3 font-semibold">{f.t}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{f.d}</p>
          </Card>
        ))}
      </section>

      <footer className="border-t border-border/50 py-6 text-center text-xs text-muted-foreground space-y-2">
        <div>© {new Date().getFullYear()} {APP_NAME}. 18+ only. Be kind. Be safe.</div>
        <div className="flex justify-center gap-4">
          <Link to="/privacy" className="hover:text-foreground">Privacy Policy</Link>
          <span>·</span>
          <Link to="/terms" className="hover:text-foreground">Terms of Service</Link>
        </div>
      </footer>
    </div>
  );
}
