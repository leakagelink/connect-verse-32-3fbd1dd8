import { createFileRoute } from "@tanstack/react-router";
import { CallFullscreenE2EMock } from "./_authenticated/call.$kind.$userId";

// Public, unauthenticated route used exclusively by the CI Playwright spec
// `tests/e2e/call-fullscreen.spec.ts`. Renders the same dry-run mock surface
// the in-app Admin E2E panel drives via iframe, but without the auth gate so
// the CI worker can hit it headlessly. Do NOT link to this from product UI.
export const Route = createFileRoute("/__e2e/call-fullscreen")({
  ssr: false,
  component: CallFullscreenE2EMock,
});
