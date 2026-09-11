import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/constants";

const LAST_UPDATED = "June 27, 2026";
const CONTACT_EMAIL = "support@talkora.app"; // TODO: replace with your verified support email
const COMPANY_NAME = `${APP_NAME}`; // TODO: replace with your registered legal entity if different
const JURISDICTION = "India"; // TODO: replace if you operate from a different jurisdiction

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: `Privacy Policy — ${APP_NAME}` },
      { name: "description", content: `How ${APP_NAME} collects, uses and protects your information.` },
      { property: "og:title", content: `Privacy Policy — ${APP_NAME}` },
      { property: "og:description", content: `How ${APP_NAME} collects, uses and protects your information.` },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
        <Link to="/" className="font-bold text-lg">{APP_NAME}</Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link to="/terms" className="hover:text-foreground">Terms</Link>
          <Link to="/delete-account" className="hover:text-foreground">Delete Account</Link>
        </nav>
      </header>


      <main className="mx-auto max-w-3xl px-6 pb-20 prose-content">
        <h1 className="text-4xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        <p className="mt-6 text-muted-foreground">
          This Privacy Policy is maintained by {COMPANY_NAME} to explain how we collect,
          use and safeguard information when you use the {APP_NAME} mobile and web
          application (the “Service”). By using the Service you agree to this Policy.
        </p>

        <Section title="1. Information we collect">
          <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
            <li><strong className="text-foreground">Account data:</strong> email, username, gender, date of birth, country, state, language, profile photo.</li>
            <li><strong className="text-foreground">Communication data:</strong> chat messages and reports filed.</li>
            <li><strong className="text-foreground">Payments:</strong> the current version is completely free — we do not collect payment, card, UPI or billing information.</li>
            <li><strong className="text-foreground">Device & usage data:</strong> device model, OS version, IP address, app version, crash logs, basic analytics events.</li>
            <li><strong className="text-foreground">Optional verification data:</strong> if you opt in to creator verification, we may collect identity documents.</li>
          </ul>
        </Section>

        <Section title="2. How we use your information">
          <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
            <li>Provide free one-to-one text chat features.</li>
            <li>Detect and prevent fraud, abuse, harassment and policy violations.</li>
            <li>Respond to reports and enforce community guidelines (warnings, bans).</li>
            <li>Send service announcements and support responses.</li>
            <li>Improve product performance and stability.</li>
          </ul>
        </Section>

        <Section title="3. Age restriction (18+)">
          <p className="text-muted-foreground">
            {APP_NAME} is strictly for users <strong className="text-foreground">18 years or older</strong>. We do not knowingly
            collect personal data from anyone under 18. If we learn that a minor has
            created an account, we will terminate it and delete the associated data.
          </p>
        </Section>

        <Section title="4. Sharing of information">
          <p className="text-muted-foreground">We do not sell your personal data. We share limited data only with:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2 text-muted-foreground">
            <li><strong className="text-foreground">Service providers</strong> who help us operate (hosting, database, authentication, analytics) under strict contractual obligations.</li>
            <li><strong className="text-foreground">Law enforcement</strong> when required by valid legal process in {JURISDICTION}.</li>
            <li><strong className="text-foreground">Other users</strong> — only your public profile fields (username, gender, country, state, follower / following counts). Your DOB is never shown.</li>
          </ul>
        </Section>

        <Section title="5. Data security">
          <p className="text-muted-foreground">
            We use industry-standard safeguards including encrypted transport (HTTPS),
            row-level security on our database, hashed authentication tokens and access
            controls. No system is 100% secure; please use a strong, unique password
            and keep your device safe.
          </p>
        </Section>

        <Section title="6. Data retention">
          <p className="text-muted-foreground">
            We retain account data for as long as your account is active. If you delete
            your account, we remove personal data within 30 days, except where retention
            is required to comply with law, resolve disputes, prevent fraud, or enforce
            our agreements.
          </p>
          <p className="text-muted-foreground mt-2">
            <strong className="text-foreground">KYC documents (PAN, Aadhaar, selfie):</strong>{" "}
            stored in an encrypted, access-restricted bucket and visible only to you and
            authorised reviewers. After review, documents are automatically deleted from
            our storage — within 7 days of approval and within 30 days of rejection.
            Verification status and minimal audit metadata (decision, reviewer, timestamp)
            are retained to comply with KYC/AML and tax obligations.
          </p>
        </Section>

        <Section title="7. Your rights">
          <p className="text-muted-foreground">
            Subject to applicable law, you may request access, correction, deletion or
            export of your personal data, or withdraw consent. Contact us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">{CONTACT_EMAIL}</a>.
          </p>
        </Section>

        <Section title="8. Cookies & local storage">
          <p className="text-muted-foreground">
            We use cookies and local storage to keep you signed in, remember
            preferences (language, theme) and measure aggregate usage. You can clear
            them from your browser or device at any time.
          </p>
        </Section>

        <Section title="9. International transfers">
          <p className="text-muted-foreground">
            Your data may be processed on servers located outside {JURISDICTION}. By
            using the Service you consent to such transfers, which are protected by
            contractual safeguards with our processors.
          </p>
        </Section>

        <Section title="10. Changes to this policy">
          <p className="text-muted-foreground">
            We may update this Policy from time to time. Material changes will be
            announced inside the app. The “Last updated” date above always reflects the
            current version.
          </p>
        </Section>

        <Section title="11. Contact us">
          <p className="text-muted-foreground">
            Questions or privacy requests? Email{" "}
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
