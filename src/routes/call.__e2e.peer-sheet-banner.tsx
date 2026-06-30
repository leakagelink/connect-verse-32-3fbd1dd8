import { createFileRoute } from "@tanstack/react-router";
import { PeerSheetBannerE2EMock } from "@/components/peer-sheet-banner-e2e-mock";

// Public, unauthenticated route mounted under `/call/...` so the
// `isCallRoutePath` check returns true. Counterpart to
// `/__e2e/peer-sheet-banner`; together they prove the banner appears
// ONLY on the live call surface. Do NOT link from product UI.
export const Route = createFileRoute("/call/__e2e/peer-sheet-banner")({
  ssr: false,
  component: PeerSheetBannerE2EMock,
});
