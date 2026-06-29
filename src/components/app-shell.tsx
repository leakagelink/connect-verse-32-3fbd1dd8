import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Home, MessageCircle, Wallet, User, Shield, Coins, Sparkles, Zap, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMyProfile } from "@/lib/onboarding.functions";
import { APP_NAME } from "@/lib/constants";
import talkoraLogo from "@/assets/talkora-logo.png.asset.json";
import { SafetySignalsProbe } from "@/components/safety-signals-probe";
import { NotificationsBell } from "@/components/notifications-bell";
import { applyChromeForApp, startPushAutoRegister, isNative } from "@/lib/native";
import { registerDeviceToken } from "@/lib/push.functions";
import { installDeepLinkHandler } from "@/lib/deep-links";
import { useT, syncStoredLocale, type Locale } from "@/lib/i18n";
import { IncomingCallDialog } from "@/components/incoming-call-dialog";



export function AppShell({ children, isAdmin }: { children: ReactNode; isAdmin?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const profileFn = useServerFn(getMyProfile);
  const registerTokenFn = useServerFn(registerDeviceToken);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });
  const balance = me?.walletBalance ?? 0;
  const unread = me?.unreadCount ?? 0;
  const admin = isAdmin ?? me?.isAdmin;
  const { t, setLocale, locale } = useT();

  // Phase 4 — Capacitor: status-bar colour, splash hide, push token registration.
  // Phase 10 — deep-link bridge (talkora:// → in-app route).
  useEffect(() => {
    let dispose: (() => void) | undefined;
    try {
      void applyChromeForApp().catch((e) => console.warn("[native] chrome failed", e));
      dispose = installDeepLinkHandler(router);
    } catch (e) {
      console.warn("[native] init failed", e);
    }
    // Push notifications: auto-register on every launch + on every resume.
    // Picks up FCM token rotations (reinstall / clear-data / 28-day refresh)
    // and immediately replaces the stale token on the server.
    if (isNative()) {
      try {
        startPushAutoRegister(async ({ token, platform }) => {
          try {
            await registerDeviceToken({ data: { token, platform } });
          } catch (e) {
            console.warn("[push] registerDeviceToken failed", e);
          }
        });
      } catch (e) {
        console.warn("[push] auto-register start failed", e);
      }
    }
    return dispose;
  }, [router]);


  // Phase 10 — sync stored locale from profile.app_language whenever it changes.
  useEffect(() => {
    const lang = me?.profile?.language as string | undefined;
    if (lang && lang !== locale) {
      syncStoredLocale(lang);
      setLocale(lang as Locale);
    }
  }, [me?.profile?.language, locale, setLocale]);

  const nav = [
    { to: "/home", label: t("nav.discover"), icon: Home },
    { to: "/chat", label: t("nav.chats"), icon: MessageCircle },
    { to: "/wallet", label: t("nav.wallet"), icon: Wallet },
    { to: "/settings", label: t("nav.profile"), icon: User },
  ] as const;


  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-40 glass border-b backdrop-blur-xl safe-top">
        <div className="mx-auto grid max-w-3xl grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 px-2 py-2 sm:px-4 sm:py-2.5">
          <Link to="/home" className="flex shrink-0 items-center" aria-label={`${APP_NAME} home`}>
            <img src={talkoraLogo.url} alt={`${APP_NAME} logo`} width={32} height={32} className="size-8 rounded-md" />
          </Link>
          <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-2">
            <Link
              to="/recharge"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coin/15 px-2 py-1 text-[11px] font-semibold text-coin hover:bg-coin/25 transition sm:px-2.5 sm:text-xs"
              title="Available coins"
            >
              <Coins className="size-3.5" />
              <span className="truncate max-w-[72px] sm:max-w-none">{balance.toLocaleString("en-IN")}</span>
              <span className="ml-0.5 rounded-full bg-coin/30 px-1.5 text-[10px]">+</span>
            </Link>
            <Link
              to="/chat"
              className={cn(
                "relative inline-flex size-8 shrink-0 items-center justify-center rounded-full transition sm:size-9",
                pathname.startsWith("/chat") ? "bg-primary/15 text-primary" : "hover:bg-muted text-foreground/80"
              )}
              title="Inbox"
            >
              <MessageCircle className="size-4 sm:size-[18px]" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <NotificationsBell active={pathname.startsWith("/notifications")} />

            <Link
              to="/recents"
              className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-full transition sm:size-9",
                pathname.startsWith("/recents") ? "bg-primary/15 text-primary" : "hover:bg-muted text-foreground/80"
              )}
              title="Recents · call history"
            >
              <History className="size-4 sm:size-[18px]" />
            </Link>

            <Link
              to="/settings"
              className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-full transition sm:size-9",
                pathname.startsWith("/settings") ? "bg-primary/15 text-primary" : "hover:bg-muted text-foreground/80"
              )}
              title="Profile"
            >
              <User className="size-4 sm:size-[18px]" />
            </Link>
          </div>
        </div>
      </header>


      <main className="mx-auto max-w-3xl px-4 pt-4">{children}</main>
      <SafetySignalsProbe />
      <IncomingCallDialog disabled={pathname.startsWith("/call/")} />

      <nav className="fixed inset-x-0 bottom-0 z-50 glass border-t safe-bottom">
        <div className="mx-auto flex max-w-3xl items-stretch justify-around gap-0.5 px-1 relative">

          {nav.slice(0, 2).map((n) => {
            const active = pathname.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link key={n.to} to={n.to} className={cn(
                "flex flex-1 min-w-0 flex-col items-center gap-0.5 py-2 text-[10px] sm:text-xs transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}>
                <Icon className="size-5 shrink-0" />
                <span className="truncate max-w-full">{n.label}</span>
              </Link>
            );
          })}

          {/* Highlighted Connect CTA */}
          <Link
            to="/connect"
            className="flex flex-1 min-w-0 flex-col items-center justify-end py-1 text-[10px] sm:text-xs"
          >
            <div className={cn(
              "-mt-5 size-12 sm:size-14 rounded-full brand-gradient shadow-lg shadow-primary/40 flex items-center justify-center ring-4 ring-background transition-transform shrink-0",
              pathname.startsWith("/connect") ? "scale-110" : "hover:scale-105 animate-pulse"
            )}>
              <Zap className="size-5 sm:size-6 text-primary-foreground" fill="currentColor" />
            </div>
            <span className={cn(
              "mt-0.5 font-semibold truncate max-w-full",
              pathname.startsWith("/connect") ? "text-primary" : "text-foreground"
            )}>Connect</span>
          </Link>

          {nav.slice(2).map((n) => {
            const active = pathname.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link key={n.to} to={n.to} className={cn(
                "flex flex-1 min-w-0 flex-col items-center gap-0.5 py-2 text-[10px] sm:text-xs transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}>
                <Icon className="size-5 shrink-0" />
                <span className="truncate max-w-full">{n.label}</span>
              </Link>
            );
          })}
          {admin && (
            <Link to="/admin" className={cn(
              "flex flex-1 min-w-0 flex-col items-center gap-0.5 py-2 text-[10px] sm:text-xs transition-colors",
              pathname.startsWith("/admin") ? "text-accent" : "text-muted-foreground hover:text-foreground"
            )}>
              <Shield className="size-5 shrink-0" />
              <span className="truncate max-w-full">Admin</span>
            </Link>
          )}
        </div>
      </nav>
    </div>
  );
}
