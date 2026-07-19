import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
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
import { PushPermissionGate } from "@/components/push-permission-gate";
import { BackgroundReliabilityGate } from "@/components/background-reliability-gate";



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
  const [isShrunk, setIsShrunk] = useState(false);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const onScroll = () => {
      const now = performance.now();
      if (now - last < 80) return;
      last = now;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setIsShrunk(window.scrollY > 16);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

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
    // and immediately replaces the stale token on the server. Gated by
    // signed-in profile so the protected server fn always has a bearer token.
    if (isNative() && me?.profile?.id) {
      try {
        startPushAutoRegister(async ({ token, platform }) => {
          try {
            await registerTokenFn({ data: { token, platform } });
          } catch (e) {
            console.warn("[push] registerDeviceToken failed", e);
          }
        });
      } catch (e) {
        console.warn("[push] auto-register start failed", e);
      }
    }
    return dispose;
  }, [router, me?.profile?.id, registerTokenFn]);


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
      <header
        className={cn(
          "sticky top-0 z-40 border-b border-primary/10 bg-surface/70 backdrop-blur-xl backdrop-saturate-150 shadow-[0_1px_0_0_color-mix(in_oklab,var(--primary)_10%,transparent),0_8px_24px_-18px_color-mix(in_oklab,var(--primary)_35%,transparent)] transition-[padding] duration-200 ease-out",
          isShrunk ? "pb-1" : "py-2 sm:py-2.5 safe-top"
        )}
        style={{
          paddingTop: isShrunk
            ? "max(env(safe-area-inset-top, 0px), 0.5rem)"
            : "max(env(safe-area-inset-top, 0px), 1.5rem)",
        }}
      >
        {/* soft brand wash so the bar sits inside the palette, not on top of it */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(60% 120% at 0% 0%, color-mix(in oklab, var(--primary) 14%, transparent), transparent 60%), radial-gradient(60% 120% at 100% 0%, color-mix(in oklab, var(--accent) 12%, transparent), transparent 60%)",
          }}
        />
        <div className="mx-auto grid max-w-3xl grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-3 sm:px-4">
          <Link
            to="/home"
            className="flex shrink-0 items-center justify-center gap-2 rounded-full pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 min-h-11 min-w-11 sm:min-w-0"
            aria-label={`${APP_NAME} home`}
          >
            <span className={cn(
              "relative grid place-items-center rounded-xl bg-gradient-brand shadow-[0_6px_16px_-6px_color-mix(in_oklab,var(--primary)_55%,transparent)] transition-[width,height] duration-200 ease-out",
              isShrunk ? "size-8" : "size-9"
            )}>
              <img
                src={talkoraLogo.url}
                alt=""
                width={22}
                height={22}
                className={cn(
                  "rounded-md transition-[width,height] duration-200 ease-out",
                  isShrunk ? "size-5" : "size-[22px]"
                )}
              />
            </span>
            <span className="hidden bg-gradient-brand bg-clip-text text-base font-black tracking-tight text-transparent sm:inline">
              {APP_NAME}
            </span>
          </Link>

          <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-1.5">
            {/* Coin pill — gold gradient, matches palette accent */}
            <Link
              to="/recharge"
              aria-label={`Available coins: ${balance.toLocaleString("en-IN")}. Recharge`}
              className={cn(
                "group shimmer-sweep inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--coin)_45%,transparent)] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--coin)_22%,var(--surface))_0%,var(--surface)_60%,color-mix(in_oklab,var(--primary)_14%,var(--surface))_100%)] pl-2 pr-1 text-xs font-bold text-foreground shadow-[0_4px_12px_-6px_color-mix(in_oklab,var(--coin)_55%,transparent)] transition hover:-translate-y-px hover:shadow-[0_8px_18px_-6px_color-mix(in_oklab,var(--coin)_65%,transparent)]"
              )}
            >
              <Coins className="relative z-10 size-3.5 text-coin" />
              <span className="relative z-10 truncate max-w-[70px] tabular-nums sm:max-w-none">
                {balance.toLocaleString("en-IN")}
              </span>
              <span className="relative z-10 grid size-5 place-items-center rounded-full bg-gradient-brand text-[12px] leading-none text-primary-foreground shadow-sm">
                +
              </span>
            </Link>

            <HeaderIconLink
              to="/chat"
              label="Inbox"
              active={pathname.startsWith("/chat")}
              badge={unread}
              icon={<MessageCircle className="size-[18px]" />}
            />
            <NotificationsBell active={pathname.startsWith("/notifications")} />
            <HeaderIconLink
              to="/recents"
              label="Recents"
              active={pathname.startsWith("/recents")}
              icon={<History className="size-[18px]" />}
            />
            <HeaderIconLink
              to="/settings"
              label="Profile"
              active={pathname.startsWith("/settings")}
              icon={<User className="size-[18px]" />}
            />
          </div>
        </div>
      </header>


      {me?.profile?.id && <PushPermissionGate />}
      {me?.profile?.id && <BackgroundReliabilityGate />}
      <main className="mx-auto max-w-3xl px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]">{children}</main>
      <SafetySignalsProbe />
      <IncomingCallDialog disabled={pathname.startsWith("/call/")} />

      <nav className="fixed inset-x-0 bottom-0 z-50 nav-surface safe-bottom">

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
              <span className="truncate max-w-full">{t("nav.admin")}</span>
            </Link>
          )}
        </div>
      </nav>
    </div>
  );
}

function HeaderIconLink({
  to,
  label,
  icon,
  active,
  badge,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        active
          ? "bg-primary-soft text-primary shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_28%,transparent)]"
          : "text-foreground/75 hover:bg-primary-soft/60 hover:text-foreground",
      )}
    >
      {icon}
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-0.5 h-1 w-1 rounded-full bg-primary shadow-[0_0_8px_color-mix(in_oklab,var(--primary)_70%,transparent)]"
        />
      )}
      {typeof badge === "number" && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 grid min-w-[16px] h-4 px-1 place-items-center rounded-full bg-gradient-brand text-[10px] font-bold leading-none text-primary-foreground shadow-[0_2px_6px_-1px_color-mix(in_oklab,var(--primary)_60%,transparent)]">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

