import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";

/**
 * Truthful placeholder for screens whose feature is not part of this release.
 * No pricing, no purchase controls, no dead action buttons.
 */
export function FeatureUnavailable({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto max-w-lg p-4 pb-24">
      <Card className="glass p-6 text-center">
        <Info className="mx-auto size-8 text-primary" />
        <h1 className="mt-3 text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link to="/chat"><Button variant="outline" size="sm">Open chats</Button></Link>
          <Link to="/connect"><Button size="sm" className="brand-gradient">Find people</Button></Link>
        </div>
      </Card>
    </div>
  );
}
