import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, Link, createRootRouteWithContext, useRouter,
  HeadContent, Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "sonner";
import { APP_NAME } from "@/lib/constants";
import { LanguageProvider } from "@/lib/i18n";
import talkoraLogo from "@/assets/talkora-logo.png.asset.json";
import { installPerfTracker } from "@/lib/perf-tracker";
import { SplashScreen } from "@/components/splash-screen";
import { initA11y } from "@/lib/a11y";



function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-gradient">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">This page doesn't exist.</p>
        <Link to="/" className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Go home</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</button>
          <a href="/" className="rounded-md border border-input px-4 py-2 text-sm">Home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: `${APP_NAME} — Voice Chat & Live Rooms` },
      { name: "description", content: "Talkora — chat and make free voice & video calls with new people in a safe, verified 18+ community." },
      { name: "theme-color", content: "#1a1224" },
      { name: "application-name", content: APP_NAME },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      { property: "og:site_name", content: APP_NAME },
      { property: "og:title", content: `${APP_NAME} — Voice Chat & Live Rooms` },
      { property: "og:description", content: "Talkora — chat and make free voice & video calls with new people in a safe, verified 18+ community." },
      { property: "og:type", content: "website" },
      { property: "og:image", content: `https://talkoraapp.com${talkoraLogo.url}?v=${talkoraLogo.asset_id}` },
      { property: "og:image:secure_url", content: `https://talkoraapp.com${talkoraLogo.url}?v=${talkoraLogo.asset_id}` },
      { property: "og:image:type", content: talkoraLogo.content_type },
      { property: "og:image:width", content: "512" },
      { property: "og:image:height", content: "512" },
      { property: "og:image:alt", content: `${APP_NAME} logo` },
      { property: "og:url", content: "https://talkoraapp.com" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: `${APP_NAME} — Voice Chat & Live Rooms` },
      { name: "twitter:description", content: "Talkora — chat and make free voice & video calls with new people in a safe, verified 18+ community." },
      { name: "twitter:image", content: `https://talkoraapp.com${talkoraLogo.url}?v=${talkoraLogo.asset_id}` },

    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preload", href: `${talkoraLogo.url}?v=${talkoraLogo.asset_id}`, as: "image", type: "image/png", fetchpriority: "high" },
      { rel: "icon", type: "image/png", sizes: "any", href: `${talkoraLogo.url}?v=${talkoraLogo.asset_id}` },
      { rel: "shortcut icon", type: "image/png", href: `${talkoraLogo.url}?v=${talkoraLogo.asset_id}` },
      { rel: "apple-touch-icon", sizes: "180x180", href: `${talkoraLogo.url}?v=${talkoraLogo.asset_id}` },
      { rel: "mask-icon", href: `${talkoraLogo.url}?v=${talkoraLogo.asset_id}`, color: "#1a1224" },
      { rel: "manifest", href: `/manifest.webmanifest?v=${talkoraLogo.asset_id}` },
    ],


  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    initA11y();
    installPerfTracker(router);

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <SplashScreen />
        <Outlet />
        <Toaster theme="dark" position="top-center" richColors />
      </LanguageProvider>
    </QueryClientProvider>
  );
}

