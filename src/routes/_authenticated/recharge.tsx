import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyProfile } from "@/lib/onboarding.functions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { MessageCircle, Phone, ShieldCheck, Sparkles } from "lucide-react";

/**
 * FREE RELEASE — no in-app purchases exist in this version of Talkora.
 * The purchase flow (Google Play Billing) stays in the codebase but is
 * disabled, so this screen only explains that everything is free. It must not
 * show prices, coin packs, bonuses or any "buy" control.
 */
export const Route = createFileRoute("/_authenticated/recharge")({
  component: FreeNotice,
  head: () => ({
    meta: [
      { title: "Talkora is free to use" },
      {
        name: "description",
        content:
          "Chat and voice or video calls on Talkora are completely free. There are no in-app purchases in this version.",
      },
      { property: "og:title", content: "Talkora is free to use" },
      {
        property: "og:description",
        content: "Free chat and free voice or video calls on Talkora. No purchases needed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function FreeNotice() {
  const profileFn = useServerFn(getMyProfile);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });

  return (
    <AppShell isAdmin={me?.isAdmin}>
      <h1 className="text-2xl font-bold">Talkora is free</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        There is nothing to buy in this version of the app.
      </p>

      <Card className="glass mt-5 border-primary/40 bg-primary/5 p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold">Everything is unlimited and free</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Messages and voice or video calls do not cost anything. There are no coins, no
              packs and no payments in this release.
            </p>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Card className="glass p-4">
          <MessageCircle className="size-5 text-primary" />
          <p className="mt-2 text-sm font-semibold">Free chat</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Send as many messages as you like to people you are connected with.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-3 w-full">
            <Link to="/chat">Open chats</Link>
          </Button>
        </Card>

        <Card className="glass p-4">
          <Phone className="size-5 text-primary" />
          <p className="mt-2 text-sm font-semibold">Free voice & video calls</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Talk for as long as you want — no minutes, no balance to top up.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-3 w-full">
            <Link to="/connect">Find people</Link>
          </Button>
        </Card>
      </div>

      <Card className="glass mt-4 flex items-start gap-3 p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground">
          Talkora never asks for card details or payments. If any screen or person asks you to
          pay for Talkora, please report it from the safety options in the app.
        </p>
      </Card>
    </AppShell>
  );
}
