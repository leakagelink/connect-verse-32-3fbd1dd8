import { createFileRoute } from "@tanstack/react-router";
import { PeerSheetBannerE2EMock } from "@/components/peer-sheet-banner-e2e-mock";

// Public, unauthenticated route used exclusively by
// `tests/e2e/peer-sheet-banner.spec.ts`. Simulates non-call surfaces
// (Recents, profile preview) so the spec can prove the in-call banner
// never leaks there. Do NOT link from product UI.
export const Route = createFileRoute("/__e2e/peer-sheet-banner")({
  ssr: false,
  component: PeerSheetBannerE2EMock,
});
