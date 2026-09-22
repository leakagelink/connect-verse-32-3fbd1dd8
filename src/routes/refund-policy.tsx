import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/constants";

export const Route = createFileRoute("/refund-policy")({
  head: () => ({
    meta: [
      { title: `Refund & Cancellation Policy — ${APP_NAME}` },
      { name: "description", content: `Refund and cancellation policy for ${APP_NAME}. The app is currently free — there are no purchases.` },
      { property: "og:title", content: `Refund & Cancellation Policy — ${APP_NAME}` },
      { property: "og:url", content: "https://talkoraapp.com/refund-policy" },
    ],
    links: [{ rel: "canonical", href: "https://talkoraapp.com/refund-policy" }],
  }),
  component: Page,
});

function Page() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
        <Link to="/" className="font-bold text-lg">{APP_NAME}</Link>
        <Link to="/terms" className="text-sm text-muted-foreground hover:text-foreground">Terms</Link>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-20 space-y-5 text-sm">
        <h1 className="text-4xl font-bold tracking-tight">Refund &amp; Cancellation Policy</h1>
        <p>
          {APP_NAME} is currently <strong>free to use</strong>. There are no in-app
          purchases, coins, subscriptions or paid features, so there is nothing to
          charge, cancel or refund.
        </p>

        <h2 className="text-xl font-semibold mt-6">1. No payments today</h2>
        <p>We do not collect any payment for chat, voice calls, video calls or any other feature. If you ever see a charge claiming to be from {APP_NAME}, please contact us immediately — it did not come from us.</p>

        <h2 className="text-xl font-semibold mt-6">2. If paid features arrive later</h2>
        <p>If we introduce paid features in future, purchases will be handled by Google Play in the Android app. Google Play&apos;s refund rules would then apply, and this page will be updated with the full refund process before any purchase is possible.</p>

        <h2 className="text-xl font-semibold mt-6">3. Contact</h2>
        <p>Email <a className="underline" href="mailto:support@talkora.app">support@talkora.app</a> with any billing question. We respond within 48 hours.</p>

        <p className="text-muted-foreground pt-6">Last updated: {new Date().getFullYear()}</p>
      </main>
    </div>
  );
}
