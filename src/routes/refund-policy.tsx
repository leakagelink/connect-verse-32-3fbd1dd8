import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/constants";

export const Route = createFileRoute("/refund-policy")({
  head: () => ({
    meta: [
      { title: `Refund & Cancellation Policy — ${APP_NAME}` },
      { name: "description", content: `Refund and cancellation policy for ${APP_NAME} coin purchases.` },
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
        <h1 className="text-4xl font-bold tracking-tight">Refund & Cancellation Policy</h1>
        <p>Coins purchased on {APP_NAME} are a <strong>consumable digital good</strong> used to access voice calls, video calls, chat messages, gifts and in-app games. Because coins are consumed instantly and have no shelf life, the following terms apply:</p>

        <h2 className="text-xl font-semibold mt-6">1. All sales are final</h2>
        <p>Coin purchases are non-refundable once credited to your wallet, except where required by applicable law or in the cases listed below.</p>

        <h2 className="text-xl font-semibold mt-6">2. We will refund</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Payment debited but coins not credited</strong> within 24 hours — full refund to the original payment method within 5–7 business days.</li>
          <li><strong>Duplicate / accidental double charge</strong> for the same order — refund of the duplicate amount.</li>
          <li><strong>Unauthorised transaction</strong> reported within 7 days, after verification.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">3. We will not refund</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Coins already spent on calls, chats, gifts, or games.</li>
          <li>Bonus coins from promotional offers (first / second / third deposit bonuses).</li>
          <li>Coins lost due to account ban for community-guideline violations.</li>
          <li>Dissatisfaction with another user's behaviour during a paid call — instead, please report the user; coins for confirmed harassment incidents may be credited back as goodwill at our discretion.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">4. Cancellation</h2>
        <p>Coin orders cannot be cancelled once payment has been initiated, as coins are credited within seconds. You may stop using the service at any time without notice.</p>

        <h2 className="text-xl font-semibold mt-6">5. Google Play purchases</h2>
        <p>If you purchased coins through Google Play billing, Google's standard refund window applies. Request the refund through your Google Play order history; we will honour any refund issued by Google and may deduct the corresponding coin balance.</p>

        <h2 className="text-xl font-semibold mt-6">6. How to request</h2>
        <p>Email <a className="underline" href="mailto:support@talkora.app">support@talkora.app</a> from your registered email with your order ID, payment screenshot and the reason. We respond within 48 hours.</p>

        <p className="text-muted-foreground pt-6">Last updated: June 27, 2026</p>
      </main>
    </div>
  );
}
