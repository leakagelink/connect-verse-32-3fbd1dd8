import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Matchmaking is disabled in this release (RANDOM_MATCHMAKING_ENABLED = false).
 * Direct route access redirects home; the server functions also reject calls.
 */
export const Route = createFileRoute("/_authenticated/matchmaker/new")({
  beforeLoad: () => {
    throw redirect({ to: "/home" });
  },
  component: () => null,
});
