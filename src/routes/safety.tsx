import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/constants";

export const Route = createFileRoute("/safety")({
  head: () => ({
    meta: [
      { title: `Safety Center — ${APP_NAME}` },
      { name: "description", content: `Stay safe on ${APP_NAME}: tips for chats, calls and rooms, blocking, reporting and how we protect women creators.` },
      { property: "og:title", content: `Safety Center — ${APP_NAME}` },
      { property: "og:description", content: `Safety tips and tools on ${APP_NAME}.` },
      { property: "og:url", content: "https://talkoraapp.com/safety" },
    ],
    links: [{ rel: "canonical", href: "https://talkoraapp.com/safety" }],
  }),
  component: Page,
});

function Page() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
        <Link to="/" className="font-bold text-lg">{APP_NAME}</Link>
        <div className="flex gap-4 text-sm text-muted-foreground">
          <Link to="/community-guidelines" className="hover:text-foreground">Guidelines</Link>
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-20 space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">Safety Center</h1>
        <p className="text-muted-foreground">Your safety is our top priority. Here's how {APP_NAME} protects you and how you can protect yourself.</p>

        <Section title="Tools we give you">
          <li><strong>Block</strong> — instantly stop any user from contacting you. Find blocked users in Settings.</li>
          <li><strong>Report</strong> — flag any profile, message or call. Reports are reviewed 24/7.</li>
          <li><strong>End call anytime</strong> — every call shows a clear End button with confirmation.</li>
          <li><strong>Verified badges</strong> — see verification status before you start a call.</li>
          <li><strong>No DOB sharing</strong> — your date of birth is never shown to other users.</li>
        </Section>

        <Section title="Special protections for women">
          <li>Women creators receive priority moderation on every report they file.</li>
          <li>Male users are charged coins to send the first message — this drastically reduces unwanted spam.</li>
          <li>Free account creation and earnings for women, with manual KYC review before withdrawals.</li>
          <li>One-tap block & report from any call, chat or room.</li>
        </Section>

        <Section title="Tips before you call or chat">
          <li>Never share personal information (phone, address, bank, OTP, full name).</li>
          <li>Don't send money to anyone you meet here — no exceptions.</li>
          <li>Don't move off-platform (WhatsApp, Telegram, Instagram). We can't protect you there, and asking is a guideline violation.</li>
          <li>Trust your instincts. If something feels off, end the call and report.</li>
        </Section>

        <Section title="If something goes wrong">
          <li>Tap <strong>Report</strong> on the user's profile or call screen.</li>
          <li>Email <a className="underline" href="mailto:safety@talkora.app">safety@talkora.app</a> for urgent safety issues.</li>
          <li>For threats of violence or crimes in progress, call local emergency services (Police 112, Women Helpline 1091, Cyber Crime 1930).</li>
        </Section>

        <Section title="If you need someone to talk to">
          <li>iCall — 9152987821 (Mon–Sat, 8am–10pm)</li>
          <li>AASRA — 9820466726 (24×7)</li>
          <li>Vandrevala Foundation — 1860 2662 345 (24×7)</li>
        </Section>

        <p className="text-sm text-muted-foreground pt-4">
          See also: <Link to="/community-guidelines" className="underline">Community Guidelines</Link> · <Link to="/privacy" className="underline">Privacy Policy</Link>
        </p>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      <ul className="list-disc pl-6 space-y-1 text-sm text-foreground/90">{children}</ul>
    </section>
  );
}
