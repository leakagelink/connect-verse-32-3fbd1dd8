import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { aiAvatarUrl } from "@/lib/ai-avatar";
import { cn } from "@/lib/utils";

type Props = {
  userId?: string | null;
  url?: string | null;
  username?: string | null;
  gender?: string | null;
  aiStyle?: string | null;
  isCreator?: boolean | null;
  className?: string;
  alt?: string;
};

/**
 * Universal avatar renderer:
 *  - If the user uploaded a photo (`url`), shows it.
 *  - Else shows a deterministic AI avatar based on `userId` and selected `aiStyle`.
 *  - Creators get a polished portrait style with a vibrant gradient backdrop.
 *  - Falls back to initials if everything fails.
 */
export function SmartAvatar({ userId, url, username, gender, aiStyle, isCreator, className, alt }: Props) {
  const [failed, setFailed] = React.useState(false);
  const resolvedSrc = React.useMemo(() => {
    if (url && !failed) return url;
    if (userId) return aiAvatarUrl(userId, aiStyle, gender, isCreator);
    return undefined;
  }, [url, userId, aiStyle, gender, isCreator, failed]);

  const initial = (username ?? "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <Avatar className={cn(className)}>
      {resolvedSrc ? (
        <AvatarImage
          src={resolvedSrc}
          alt={alt ?? username ?? "avatar"}
          onError={() => setFailed(true)}
          loading="lazy"
        />
      ) : null}
      <AvatarFallback>{initial}</AvatarFallback>
    </Avatar>
  );
}
