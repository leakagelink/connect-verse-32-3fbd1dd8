import { createFileRoute } from "@tanstack/react-router";
import { CallControlsClickableE2EMock } from "@/components/call-controls-e2e-mock";

// Public, unauthenticated route used exclusively by the CI Playwright spec
// `tests/e2e/call-controls-clickable.spec.ts`. Renders a dry-run of the call
// control bar (End / Gift / Mic / Speaker / Mystery) so the spec can assert
// every control stays clickable after the call connects.
export const Route = createFileRoute("/__e2e/call-controls")({
  ssr: false,
  component: CallControlsClickableE2EMock,
});
