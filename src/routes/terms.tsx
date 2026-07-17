import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/constants";

const LAST_UPDATED = "June 27, 2026";
const CONTACT_EMAIL = "support@talkora.app"; // TODO: replace with your verified support email
const COMPANY_NAME = `${APP_NAME}`; // TODO: replace with your registered legal entity if different
const JURISDICTION = "India"; // TODO: replace if you operate from a different jurisdiction

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: `Terms of Service — ${APP_NAME}` },
      { name: "description", content: `Rules and conditions for using ${APP_NAME}.` },
      { property: "og:title", content: `Terms of Service — ${APP_NAME}` },
      { property: "og:description", content: `Rules and conditions for using ${APP_NAME}.` },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
        <Link to="/" className="font-bold text-lg">{APP_NAME}</Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link to="/delete-account" className="hover:text-foreground">Delete Account</Link>
        </nav>
      </header>


      <main className="mx-auto max-w-3xl px-6 pb-20">
        <h1 className="text-4xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        <p className="mt-6 text-muted-foreground">
          These Terms of Service (“Terms”) govern your access to and use of {APP_NAME}
          (the “Service”), operated by {COMPANY_NAME}. By creating an account or using
          the Service you agree to be bound by these Terms.
        </p>

        <Section title="1. Eligibility">
          <p className="text-muted-foreground">
            You must be at least <strong className="text-foreground">18 years old</strong> to use {APP_NAME}.
            You confirm that the information you provide at signup (including date of
            birth, gender and country) is accurate. Accounts found to belong to minors
            will be permanently terminated.
          </p>
        </Section>

        <Section title="2. Account & security">
          <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
            <li>One account per person. Multiple accounts may be banned.</li>
            <li>You are responsible for all activity on your account.</li>
            <li>Keep your login credentials confidential. Notify us immediately of any unauthorized use.</li>
            <li>We may suspend or terminate accounts that violate these Terms or our community guidelines.</li>
          </ul>
        </Section>

        <Section title="3. Community guidelines">
          <p className="text-muted-foreground">The following are strictly prohibited:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2 text-muted-foreground">
            <li>Harassment, threats, hate speech, bullying or discrimination.</li>
            <li>Nudity, sexually explicit content, or solicitation of any kind.</li>
            <li>Impersonation, fake profiles or misleading information.</li>
            <li>Sharing other users’ personal information without consent.</li>
            <li>Sharing off-platform contact details (WhatsApp, Telegram, Instagram, phone numbers) to bypass safety controls.</li>
            <li>Fraud, chargeback abuse, exploitation of bonuses, or any attempt to manipulate the coin economy.</li>
            <li>Spam, advertising, scams, malware or links to harmful content.</li>
            <li>Any illegal activity under the laws of {JURISDICTION}.</li>
          </ul>
          <p className="mt-3 text-muted-foreground">
            Violations may result in warnings, temporary suspension, permanent ban,
            forfeiture of coin balance, and / or reporting to law enforcement.
          </p>
        </Section>

        <Section title="4. Coins & virtual items">
          <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
            <li>Coins are a non-refundable virtual item used inside the Service.</li>
            <li>Coins have no real-world monetary value and cannot be transferred between accounts.</li>
            <li>Bonus coins are promotional and may have expiry or usage conditions.</li>
            <li>We may modify coin pricing, plans and bonus rates at any time.</li>
            <li>Coin balances of suspended or banned accounts may be forfeited.</li>
          </ul>
        </Section>

        <Section title="5. Free minutes">
          <p className="text-muted-foreground">
            New accounts receive 5 free minutes of call time as a one-time welcome
            benefit. Free minutes are non-transferable and have no cash value.
          </p>
        </Section>

        <Section title="6. Creator earnings & withdrawals">
          <p className="text-muted-foreground">
            Eligible verified creators may earn coins from chats, calls and gifts.
            Withdrawal is subject to KYC verification, minimum payout thresholds,
            applicable taxes, and our anti-fraud review. We may withhold or reverse
            payouts linked to policy violations.
          </p>
        </Section>

        <Section title="7. Reports & moderation">
          <p className="text-muted-foreground">
            You can report any user or content. We review reports and take action at
            our discretion, including content removal, account suspension or
            permanent ban. Our decisions are final.
          </p>
        </Section>

        <Section title="8. Intellectual property">
          <p className="text-muted-foreground">
            All software, branding, designs and content of the Service are owned by
            {" "}{COMPANY_NAME} or its licensors. You retain ownership of content you
            create, but grant us a worldwide, royalty-free license to host, display
            and distribute it within the Service for the purpose of operating it.
          </p>
        </Section>

        <Section title="9. Termination">
          <p className="text-muted-foreground">
            You may delete your account at any time from the app settings. We may
            suspend or terminate your access without notice if you violate these
            Terms. Sections that by their nature should survive termination
            (payment, IP, disclaimers, limitation of liability) will survive.
          </p>
        </Section>

        <Section title="10. Disclaimers">
          <p className="text-muted-foreground">
            The Service is provided “AS IS” without warranties of any kind, express
            or implied. We do not guarantee uninterrupted, error-free or secure
            operation. You interact with other users at your own risk.
          </p>
        </Section>

        <Section title="11. Limitation of liability">
          <p className="text-muted-foreground">
            To the maximum extent permitted by law, {COMPANY_NAME} shall not be
            liable for indirect, incidental, special, consequential or punitive
            damages, or for any loss of profits, data or goodwill arising from your
            use of the Service. Our total aggregate liability shall not exceed the
            amount you paid us in the 3 months prior to the claim.
          </p>
        </Section>

        <Section title="12. Governing law & disputes">
          <p className="text-muted-foreground">
            These Terms are governed by the laws of {JURISDICTION}. Any dispute
            shall be subject to the exclusive jurisdiction of the competent courts
            of {JURISDICTION}.
          </p>
        </Section>

        <Section title="13. Changes to these Terms">
          <p className="text-muted-foreground">
            We may update these Terms from time to time. Material changes will be
            announced inside the app. Continued use after changes constitutes
            acceptance.
          </p>
        </Section>

        <Section title="14. Contact">
          <p className="text-muted-foreground">
            For any questions about these Terms, email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">{CONTACT_EMAIL}</a>.
          </p>
        </Section>

        <p className="mt-12 text-xs text-muted-foreground">
          This document is provided as a starting template and is not legal advice.
          You should have it reviewed by a qualified lawyer for your jurisdiction
          before publishing.
        </p>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
