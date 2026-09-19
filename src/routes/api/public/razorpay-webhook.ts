import { createFileRoute } from "@tanstack/react-router";
import { RAZORPAY_ENABLED } from "@/lib/billing-config";

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const Route = createFileRoute("/api/public/razorpay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!RAZORPAY_ENABLED) {
          return new Response("Disabled", { status: 503 });
        }
        const { getPaymentSettings } = await import("@/lib/payments.functions");
        const settings = await getPaymentSettings();
        const secret = settings.webhook_secret;
        if (!secret) {
          console.error("razorpay_webhook_secret not set in app_settings");
          return new Response("Not configured", { status: 500 });
        }

        const signature = request.headers.get("x-razorpay-signature") ?? "";
        const body = await request.text();
        const expected = await hmacSha256Hex(secret, body);
        if (!signature || !timingSafeEq(signature, expected)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const event = payload?.event as string | undefined;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        try {
          if (event === "payment.captured" || event === "order.paid") {
            const payment = payload?.payload?.payment?.entity;
            const orderEntity = payload?.payload?.order?.entity;
            const orderId = payment?.order_id ?? orderEntity?.id;
            const paymentId = payment?.id ?? null;
            if (!orderId) return new Response("ok", { status: 200 });

            // Mark paid
            await supabaseAdmin
              .from("razorpay_orders")
              .update({
                status: "paid",
                razorpay_payment_id: paymentId,
                paid_at: new Date().toISOString(),
              })
              .eq("razorpay_order_id", orderId)
              .neq("status", "credited");

            // Credit atomically (idempotent)
            const { data: credit, error: rpcErr } = await supabaseAdmin.rpc(
              "credit_razorpay_payment",
              {
                _order_id: orderId,
                _payment_id: paymentId,
                _payload: payload,
              },
            );
            if (rpcErr) {
              console.error("credit rpc error", rpcErr);
              return new Response("Credit error", { status: 500 });
            }
            console.log("razorpay credit:", orderId, credit);

            // Notify user of successful recharge (in-app bell + push).
            try {
              const { data: row } = await supabaseAdmin
                .from("razorpay_orders")
                .select("user_id, coins_credited, bonus_credited, status")
                .eq("razorpay_order_id", orderId)
                .maybeSingle();
              if (row?.user_id && row.status === "credited") {
                const coins = Number(row.coins_credited ?? 0);
                const bonus = Number(row.bonus_credited ?? 0);
                const bonusTxt = bonus > 0 ? ` (incl. ${bonus} bonus)` : "";
                const { notifyUser } = await import("@/lib/push.functions");
                await notifyUser({
                  userId: row.user_id,
                  kind: "system",
                  title: "Recharge successful",
                  body: `${coins} coins credited to your wallet${bonusTxt}.`,
                  deepLink: "/wallet",
                });
              }
            } catch (e) {
              console.error("recharge success notify failed", e);
            }
          } else if (event === "payment.failed") {
            const payment = payload?.payload?.payment?.entity;
            const orderId = payment?.order_id;
            if (orderId) {
              await supabaseAdmin
                .from("razorpay_orders")
                .update({
                  status: "failed",
                  webhook_payload: payload,
                  razorpay_payment_id: payment?.id ?? null,
                })
                .eq("razorpay_order_id", orderId)
                .neq("status", "credited");

              // Notify user of failed recharge so they can retry.
              try {
                const { data: row } = await supabaseAdmin
                  .from("razorpay_orders")
                  .select("user_id, status")
                  .eq("razorpay_order_id", orderId)
                  .maybeSingle();
                if (row?.user_id && row.status === "failed") {
                  const reason = payment?.error_description || payment?.error_reason || "Payment could not be completed";
                  const { notifyUser } = await import("@/lib/push.functions");
                  await notifyUser({
                    userId: row.user_id,
                    kind: "system",
                    title: "Recharge failed",
                    body: `${reason}. Tap to try again.`,
                    deepLink: "/recharge",
                  });
                }
              } catch (e) {
                console.error("recharge fail notify failed", e);
              }
            }
          }
        } catch (e) {
          console.error("webhook handler error", e);
          return new Response("Error", { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
      GET: async () => new Response("razorpay webhook endpoint", { status: 200 }),
    },
  },
});
