import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/constants";

export const Route = createFileRoute("/community-guidelines")({
  head: () => ({
    meta: [
      { title: `Community Guidelines — ${APP_NAME}` },
      { name: "description", content: `${APP_NAME} community rules: stay safe, be respectful, no harassment, nudity, hate, scams or illegal activity.` },
      { property: "og:title", content: `Community Guidelines — ${APP_NAME}` },
      { property: "og:description", content: `Rules that keep ${APP_NAME} safe and respectful for everyone.` },
      { property: "og:url", content: "https://talkoraapp.com/community-guidelines" },
    ],
    links: [{ rel: "canonical", href: "https://talkoraapp.com/community-guidelines" }],
  }),
  component: Page,
});

function Page() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
        <Link to="/" className="font-bold text-lg">{APP_NAME}</Link>
        <div className="flex gap-4 text-sm text-muted-foreground">
          <Link to="/safety" className="hover:text-foreground">Safety</Link>
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link to="/terms" className="hover:text-foreground">Terms</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-20 space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">Community Guidelines</h1>
        <p className="text-muted-foreground">{APP_NAME} is an 18+ community for voice chat, calls and live rooms. These rules apply to every message, call, room and profile.</p>

        <Section title="1. Be respectful">
          <li>No harassment, bullying, threats, stalking or hate speech.</li>
          <li>No discrimination based on race, religion, caste, gender, sexual orientation, disability or nationality.</li>
          <li>Treat every member with dignity. Disagreements are fine; abuse is not.</li>
        </Section>

        <Section title="2. No sexual or nude content">
          <li>No nudity, sexually explicit content, sexual solicitation or pornographic material in profiles, chat, calls or rooms.</li>
          <li>No sexual content involving minors under any circumstance — such content is reported to authorities immediately.</li>
        </Section>

        <Section title="3. Protect minors">
          <li>{APP_NAME} is strictly 18+. Accounts found to belong to minors are permanently banned.</li>
          <li>If you suspect a user is a minor, report them immediately.</li>
        </Section>

        <Section title="4. No illegal activity">
          <li>No drugs, weapons, terrorism, human trafficking, prostitution, or any activity illegal in India or your jurisdiction.</li>
          <li>No promotion of self-harm or suicide. If you or someone you know is in crisis, contact iCall (9152987821) or AASRA (9820466726).</li>
        </Section>

        <Section title="5. No scams, spam or impersonation">
          <li>No money requests, investment schemes, gift-card fraud, phishing or pyramid schemes.</li>
          <li>No impersonating other people, brands or {APP_NAME} staff.</li>
          <li>No spam, bots, mass-messaging or off-platform promotion.</li>
        </Section>

        <Section title="6. Privacy of others">
          <li>Do not share another user's personal information (phone, address, photos) without consent.</li>
          <li>Do not record, screenshot or stream private calls without the other person's consent.</li>
        </Section>

        <Section title="7. Authentic accounts">
          <li>One person, one account. No fake profiles or AI-generated identities pretending to be real people.</li>
        </Section>

        <Section title="8. Enforcement">
          <li>Violations may result in warnings, content removal, temporary suspension, or permanent ban.</li>
          <li>Severe violations (CSAM, threats of violence, fraud) are reported to law enforcement.</li>
          <li>You can report any user from their profile or any chat / call screen. Reports are reviewed by our moderation team.</li>
        </Section>

        <p className="text-sm text-muted-foreground pt-4">
          Questions? Email <a className="underline" href="mailto:support@talkora.app">support@talkora.app</a>.
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
