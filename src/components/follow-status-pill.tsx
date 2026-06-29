import { Badge } from "@/components/ui/badge";
import { Check, Clock, UserPlus } from "lucide-react";
import type { FollowStatus } from "@/lib/use-follow-status";

/** Compact pill that explains the messaging/friend-request state for a creator card. */
export function FollowStatusPill({
  status,
  size = "sm",
}: {
  status: FollowStatus;
  size?: "xs" | "sm";
}) {
  const cls = size === "xs" ? "text-[9px] px-1.5 py-0 gap-0.5" : "text-[10px] px-2 py-0.5 gap-1";
  const icon = size === "xs" ? "size-2.5" : "size-3";

  if (status === "accepted") {
    return (
      <Badge className={`bg-emerald-500/90 text-white border-0 ${cls}`}>
        <Check className={icon} />
        Friends
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge className={`bg-amber-500/90 text-black border-0 ${cls}`}>
        <Clock className={icon} />
        Requested
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={`text-muted-foreground ${cls}`}>
      <UserPlus className={icon} />
      Not connected
    </Badge>
  );
}
