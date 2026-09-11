import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MessageCircle, Shield, Coins, Sparkles, Users, Heart } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { supabase } from "@/integrations/supabase/client";
import talkoraLogo from "@/assets/talkora-logo.png.asset.json";

const SB_STORAGE_KEY = `sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID}-auth-token`;

function hasStoredSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(SB_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const token = parsed?.access_token ?? parsed?.currentSession?.access_token;
    const expiresAt = parsed?.expires_at ?? parsed?.currentSession?.expires_at;
    if (!token) return false;
    if (typeof expiresAt === "number" && expiresAt * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: `${APP_NAME} — Voice Chat & Live Rooms` },
      { name: "description", content: "Talkora — free 1-on-1 chat with verified members. Safe, moderated and 18+ only." },
      { property: "og:title", content: `${APP_NAME} — Voice Chat & Live Rooms` },
      { property: "og:description", content: "Join voice rooms, chat & meet new friends safely on Talkora." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  // Synchronous check on first render — avoids landing-page flash for signed-in users.
  const [authed, setAuthed] = useState<boolean>(() => hasStoredSession());

  useEffect(() => {
    // Confirm with Supabase (handles refresh + edge cases).
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setAuthed(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
      if (session) navigate({ to: "/home", replace: true });
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [navigate]);

  if (authed) {
    return <Navigate to="/home" replace />;
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
          Free chat.<br /><span className="text-gradient">Real conversations.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          {APP_NAME} is a safe community where verified members chat 1-on-1 and make new friends. <strong className="text-foreground">Completely free</strong> to join and chat.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/auth"><Button size="lg" className="brand-gradient text-primary-foreground">Get started — free</Button></Link>
          <a href="#how" className="text-sm text-muted-foreground hover:text-foreground">How it works ↓</a>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 pb-24 grid gap-4 md:grid-cols-3">
        {[
          { icon: MessageCircle, t: "Realtime chat", d: "1-on-1 messaging with verified members across the world." },
          { icon: Coins, t: "Free to use", d: "No coins, no payments. Every chat in this version is free." },
          { icon: Shield, t: "Strong safety", d: "18+ only. One-tap block & report. Active human moderation." },
          { icon: Users, t: "Verified members", d: "Friend requests keep your inbox free from strangers." },
          { icon: Sparkles, t: "Coming soon", d: "Voice & video calls, live rooms, games and rewards." },
          { icon: Heart, t: "Made for everyone", d: "Free signup and free chat for every member." },
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
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          <Link to="/privacy" className="hover:text-foreground">Privacy Policy</Link>
          <span aria-hidden>·</span>
          <Link to="/terms" className="hover:text-foreground">Terms of Service</Link>
          <span aria-hidden>·</span>
          <Link to="/delete-account" className="hover:text-foreground">Delete Account</Link>
        </div>

      </footer>
    </div>
  );
}
