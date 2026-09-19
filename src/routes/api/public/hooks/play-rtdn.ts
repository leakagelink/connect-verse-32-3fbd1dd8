import { createFileRoute } from "@tanstack/react-router";

/**
 * Google Play Real-time developer notifications (Pub/Sub push).
 *
 * Handles voided (refunded / charged-back / revoked) purchases by reclaiming the
 * coins that were credited for that purchase token.
 *
 * Security: the Pub/Sub push endpoint URL must carry `?key=<PLAY_RTDN_SECRET>`.
 * Without the secret configured the endpoint refuses every request.
 */

interface VoidedPurchase {
  purchaseToken?: string;
  orderId?: string;
  /** 1 = full refund, 0 = item-level refund */
  refundType?: number;
}

export const Route = createFileRoute("/api/public/hooks/play-rtdn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["PLAY_RTDN_SECRET"];
        if (!secret) {
          return new Response("Not configured", { status: 503 });
        }
        const key = new URL(request.url).searchParams.get("key");
        if (!key || key !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: { message?: { data?: string } };
        try {
          payload = (await request.json()) as typeof payload;
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const encoded = payload?.message?.data;
        if (!encoded) return new Response("ok");

        let notification: {
          packageName?: string;
          voidedPurchaseNotification?: VoidedPurchase;
        };
        try {
          notification = JSON.parse(atob(encoded));
        } catch {
          return new Response("Bad payload", { status: 400 });
        }

        const voided = notification.voidedPurchaseNotification;
        if (!voided?.purchaseToken) {
          // Other notification types (test messages, subscriptions) are ignored.
          return new Response("ok");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.rpc("revoke_play_purchase", {
          _purchase_token: voided.purchaseToken,
          _reason: voided.refundType === 1 ? "play_full_refund" : "play_item_refund",
        });
        if (error) {
          console.error("revoke_play_purchase failed", error.message);
          return new Response("Retry", { status: 500 });
        }
        return new Response("ok");
      },
    },
  },
});
