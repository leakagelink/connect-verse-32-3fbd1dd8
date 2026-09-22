import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { ShieldAlert, Ban, Mail, Scale, Eye, FileWarning } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { CHILD_SAFETY_EMAIL, SUPPORT_EMAIL } from "@/lib/billing-config";

export const Route = createFileRoute("/child-safety")({
  component: ChildSafety,
  head: () => ({
    meta: [
      { title: `Child Safety Standards — ${APP_NAME}` },
      {
        name: "description",
        content:
          "Talkora's child safety standards: zero tolerance for child sexual abuse and exploitation, 18+ only access, reporting channels and enforcement.",
      },
      { property: "og:title", content: `Child Safety Standards — ${APP_NAME}` },
      {
        property: "og:description",
        content:
          "How Talkora prevents, detects and reports child sexual abuse and exploitation (CSAE), and how to contact our safety team.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ShieldAlert;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="glass p-5">
      <div className="flex items-center gap-2">
        <Icon className="size-5 text-primary" />
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="mt-3 space-y-2 text-sm text-muted-foreground">{children}</div>
    </Card>
  );
}

function ChildSafety() {
  return (
    <div className="min-h-screen bg-mesh px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Child Safety Standards</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {APP_NAME} has zero tolerance for child sexual abuse and exploitation (CSAE).
            This page explains our standards, how we enforce them, and how anyone can
            report a concern.
          </p>
        </div>

        <Section icon={Ban} title="18+ only — no minors allowed">
          <p>
            {APP_NAME} is strictly for adults aged 18 and above. Users must confirm their
            date of birth during sign-up, and accounts that appear to belong to a minor are
            suspended immediately while we review them.
          </p>
          <p>
            The current release has no payments, coins or payouts. If monetization is
            introduced later, identity verification with a government-issued ID will be
            required before any payout is enabled.
          </p>
        </Section>

        <Section icon={FileWarning} title="Prohibited content and behaviour">
          <ul className="list-disc space-y-1 pl-5">
            <li>Child sexual abuse material (CSAM) of any kind, real or generated.</li>
            <li>Sexualising, grooming, or soliciting anyone under 18.</li>
            <li>Sharing, requesting or linking to CSAE content.</li>
            <li>Impersonating a minor, or roleplay that sexualises minors.</li>
            <li>Attempting to move a suspected minor to off-platform contact.</li>
          </ul>
        </Section>

        <Section icon={Eye} title="How we prevent and detect abuse">
          <ul className="list-disc space-y-1 pl-5">
            <li>Automated keyword and pattern filters block banned and high-risk content in chat.</li>
            <li>In-app Report and Block are available on every profile, chat and call.</li>
            <li>An in-call SOS button escalates urgent safety incidents to our team.</li>
            <li>Sharing phone numbers, emails and social handles is blocked in chat.</li>
            <li>Confirmed safety strikes lead to automatic account bans.</li>
          </ul>
        </Section>

        <Section icon={ShieldAlert} title="Reporting CSAE">
          <p>
            Inside the app: open the profile, chat or call and use{" "}
            <span className="font-semibold text-foreground">Report</span>, choosing
            “Child safety / child endangerment” or “Underage user” as the reason. Reports reach our moderation
            queue immediately.
          </p>
          <p className="flex items-center gap-2">
            <Mail className="size-4" />
            Child safety team:{" "}
            <a className="underline" href={`mailto:${CHILD_SAFETY_EMAIL}`}>
              {CHILD_SAFETY_EMAIL}
            </a>
          </p>
          <p className="flex items-center gap-2">
            <Mail className="size-4" />
            General support:{" "}
            <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </p>
          <p>
            If a child is in immediate danger, contact local law enforcement first. In
            India you can also reach the CHILDLINE helpline on 1098 or the National Cyber
            Crime Reporting Portal at cybercrime.gov.in.
          </p>
        </Section>

        <Section icon={Scale} title="Enforcement and cooperation">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Accounts involved in CSAE are permanently banned without warning.
            </li>
            <li>
              Suspected CSAM is preserved, escalated internally, and reported to the
              relevant authorities as required by applicable law.
            </li>
            <li>
              We respond to lawful requests from law enforcement and child protection
              agencies.
            </li>
            <li>
              Banned users may appeal through the in-app appeal form; CSAE bans are not
              reversed.
            </li>
          </ul>
        </Section>

        <p className="pt-2 text-center text-xs text-muted-foreground">
          See also{" "}
          <Link className="underline" to="/community-guidelines">
            Community Guidelines
          </Link>
          ,{" "}
          <Link className="underline" to="/safety">
            Safety Centre
          </Link>{" "}
          and{" "}
          <Link className="underline" to="/privacy">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
