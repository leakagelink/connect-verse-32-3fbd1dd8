import { createFileRoute } from "@tanstack/react-router";
import { CallRecoveryE2EMock } from "@/components/call-recovery-e2e-mock";

// Public unauthenticated route powering
// tests/e2e/call-recovery-after-kill.spec.ts.
export const Route = createFileRoute("/__e2e/call-recovery")({
  ssr: false,
  component: () => <CallRecoveryE2EMock />,
});
