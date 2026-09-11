import { Card } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function ComingSoonCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="glass p-10 text-center">
      <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-primary/15">
        <Sparkles className="size-8 text-primary" />
      </div>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <p className="mt-1 text-xs text-muted-foreground">Coming soon</p>
      <Link to="/home" className="mt-5 inline-block">
        <Button variant="outline" className="rounded-full">
          Back to chat
        </Button>
      </Link>
    </Card>
  );
}

export function ComingSoonPage(props: { title: string; description: string }) {
  return (
    <AppShell>
      <ComingSoonCard {...props} />
    </AppShell>
  );
}
