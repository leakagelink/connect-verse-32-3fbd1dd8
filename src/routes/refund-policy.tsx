import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/constants";

export const Route = createFileRoute("/refund-policy")({
  head: () => ({
    meta: [
      { title: `Refund & Cancellation Policy — ${APP_NAME}` },
      { name: "description", content: `${APP_NAME} is currently free to use — no purchases, no payments, nothing to refund.` },
      { property: "og:title", content: `Refund & Cancellation Policy — ${APP_NAME}` },
      { property: "og:description", content: `${APP_NAME} is currently free to use — no purchases, no payments, nothing to refund.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
        <h1 className="text-4xl font-bold tracking-tight">Refund & Cancellation Policy</h1>

        <h2 className="text-xl font-semibold mt-6">1. {APP_NAME} is currently free</h2>
        <p>
          The current version of {APP_NAME} offers <strong>free one-to-one text chat</strong> only.
          There are no in-app purchases, coins, wallet top-ups, subscriptions or payments of any kind,
          so there is nothing to refund or cancel.
        </p>

        <h2 className="text-xl font-semibold mt-6">2. Charged by mistake?</h2>
        <p>
          Since we do not accept payments, {APP_NAME} will never charge you. If you ever see a charge
          claiming to be from {APP_NAME}, do not pay it — report it to us immediately at{" "}
          <a className="underline" href="mailto:support@talkora.app">support@talkora.app</a> and to your bank.
        </p>

        <h2 className="text-xl font-semibold mt-6">3. If paid features launch later</h2>
        <p>
          If we introduce optional paid features in a future version, this policy will be updated with
          clear refund rules before any purchase is possible, and you will be informed inside the app.
          Purchases made through Google Play would additionally follow Google Play's own refund policy.
        </p>

        <h2 className="text-xl font-semibold mt-6">4. Contact</h2>
        <p>
          Questions? Email <a className="underline" href="mailto:support@talkora.app">support@talkora.app</a>.
          We respond within 48 hours.
        </p>

        <p className="text-muted-foreground pt-6">Last updated: September 11, 2026</p>
      </main>
    </div>
  );
}
