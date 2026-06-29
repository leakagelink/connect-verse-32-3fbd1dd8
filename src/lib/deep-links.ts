/**
 * Capacitor deep-link bridge.
 *
 * Listens for `appUrlOpen` events fired when the OS launches the app
 * via a registered URL scheme (talkora://) or App Link
 * (https://talkora.app/...). The URL is mapped to an in-app TanStack
 * router path.
 *
 * For talkora:// scheme URLs, the host is the FIRST path segment:
 *   talkora://chat/abc-123                     → /chat/abc-123
 *   talkora://call/voice/<userId>?inviteId=…   → /call/voice/<userId>?inviteId=…&autoAccept=1
 *   talkora://call-reject?inviteId=…           → server reject (no navigation)
 *   talkora://recharge                         → /recharge
 *
 * For https:// App Links the host is the domain, so the pathname is the
 * route directly:
 *   https://talkora.app/rooms/42 → /rooms/42
 */
import type { Router } from "@tanstack/react-router";
import { isNative } from "@/lib/native";

export function installDeepLinkHandler(router: Router<any, any>): () => void {
  if (!isNative()) return () => {};
  let cleanup: (() => void) | undefined;
  (async () => {
    try {
      const { App } = await import("@capacitor/app");
      const sub = await App.addListener("appUrlOpen", async (event) => {
        try {
          const url = new URL(event.url);
          const isCustomScheme = url.protocol === "talkora:";

          // Reject flow — fire the server reject and don't navigate.
          if (isCustomScheme && url.host === "call-reject") {
            const inviteId = url.searchParams.get("inviteId");
            if (inviteId) {
              try {
                const { rejectCallInvite } = await import("@/lib/call-invites.functions");
                await rejectCallInvite({ data: { inviteId } });
              } catch { /* ignore */ }
            }
            return;
          }

          let path: string;
          if (isCustomScheme) {
            // Re-attach host as first segment.
            const host = url.host;
            const pathTail = url.pathname || "";
            path = `/${host}${pathTail}` + (url.search || "") + (url.hash || "");
          } else {
            path = (url.pathname || "/") + (url.search || "") + (url.hash || "");
          }
          if (!path || path === "/") return;
          router.navigate({ to: path });
        } catch {
          /* malformed url — ignore */
        }
      });
      cleanup = () => sub.remove();
    } catch {
      /* @capacitor/app missing — ignore */
    }
  })();
  return () => cleanup?.();
}
