import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/constants";

export const Route = createFileRoute("/delete-account")({
  head: () => ({
    meta: [
      { title: `Delete your account — ${APP_NAME}` },
      { name: "description", content: `How to permanently delete your ${APP_NAME} account and what data is removed. Required by Google Play User Data policy.` },
      { property: "og:title", content: `Delete your ${APP_NAME} account` },
      { property: "og:description", content: "Step-by-step instructions to delete your account and your data." },
    ],
  }),
  component: DeleteAccountPublic,
});

function DeleteAccountPublic() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Link to="/" className="text-xs text-muted-foreground hover:underline">← Back to {APP_NAME}</Link>
        <h1 className="mt-4 text-3xl font-bold">Delete your {APP_NAME} account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You can permanently delete your {APP_NAME} account and the data associated with it at any time, free of charge.
          This page is provided so the option remains accessible even if you no longer have the app installed.
        </p>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">Option 1 — Delete in the app (fastest)</h2>
          <ol className="list-decimal pl-5 text-sm space-y-1">
            <li>Open {APP_NAME} and sign in.</li>
            <li>Go to <strong>Profile → Settings</strong>.</li>
            <li>Scroll to the bottom and tap <strong>Delete my account</strong>.</li>
            <li>Type <code className="px-1 rounded bg-muted">DELETE</code> to confirm.</li>
          </ol>
          <Link
            to="/account-delete"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Open in-app delete page
          </Link>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">Option 2 — Request deletion by email</h2>
          <p className="text-sm">
            If you cannot sign in, email{" "}
            <a className="underline font-medium" href="mailto:support@talkora.app?subject=Account%20deletion%20request">
              support@talkora.app
            </a>{" "}
            from the email address registered with your account. Include:
          </p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li>Your registered email or username</li>
            <li>The subject line: <em>"Account deletion request"</em></li>
          </ul>
          <p className="text-sm text-muted-foreground">
            We verify ownership before deletion. Requests are processed within 7 working days.
          </p>
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">What gets deleted</h2>
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li>Your profile (username, avatar, bio, date of birth, country/state)</li>
            <li>Your chats, call history and follow connections</li>
            <li>Your reports, blocks and other account settings</li>
          </ul>
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">What we retain (and why)</h2>
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li>Anonymised safety reports filed against your account — kept for community safety and legal compliance.</li>
            <li>Records required to respond to law-enforcement requests (e.g. IT Rules 2021).</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Retained records do not contain your profile, photos, chats, or any contact information beyond what is legally required.
          </p>
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">Questions or appeals</h2>
          <p className="text-sm">
            Support: <a className="underline" href="mailto:support@talkora.app">support@talkora.app</a><br />
            Grievance Officer (India IT Rules 2021): <a className="underline" href="mailto:grievance@talkora.app">grievance@talkora.app</a>
          </p>
        </section>

        <p className="mt-10 text-[11px] text-muted-foreground">
          This page satisfies Google Play's requirement that account deletion be available from a public, in-app-independent web URL.
        </p>
      </div>
    </div>
  );
}
