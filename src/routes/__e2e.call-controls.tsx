import { createFileRoute } from "@tanstack/react-router";
import { CallControlsClickableE2EMock } from "@/components/call-controls-e2e-mock";

// Public, unauthenticated route used exclusively by the CI Playwright specs
// that guard the call-controls clickability contract. The `overlays=1`
// search param flips the mock into the overlay-guard mode used by
// `tests/e2e/call-controls-overlay-guard.spec.ts`.
export const Route = createFileRoute("/__e2e/call-controls")({
  ssr: false,
  validateSearch: (search): { overlays?: "1" } => ({
    overlays: search.overlays === "1" || search.overlays === 1 ? "1" : undefined,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { overlays } = Route.useSearch();
  return <CallControlsClickableE2EMock injectOverlays={overlays === "1"} />;
}
