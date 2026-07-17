import { createFileRoute } from "@tanstack/react-router";
import { RechargeRetryE2EMock } from "@/components/recharge-retry-e2e-mock";

// Public, unauthenticated route used exclusively by
// `tests/e2e/recharge-retry.spec.ts`. Exercises the deep-link + retry
// banner contract from `src/lib/recharge-pending.ts` without requiring a
// real Supabase session or Razorpay integration. Do NOT link from
// product UI.
export const Route = createFileRoute("/__e2e/recharge-retry")({
  ssr: false,
  component: RechargeRetryE2EMock,
  validateSearch: (s: Record<string, unknown>) => ({
    plan: typeof s.plan === "string" ? s.plan : undefined,
    pp: typeof s.pp === "string" ? s.pp : undefined,
  }),
});
