import { createFileRoute } from "@tanstack/react-router";
import { RAZORPAY_ENABLED } from "@/lib/billing-config";

// Server-side reconciliation for Razorpay orders.
// Runs periodically (pg_cron) and:
//  - Finds razorpay_orders not yet credited that were created >2 min ago.
//  - Queries Razorpay REST API for authoritative status.
//  - Credits atomically via credit_razorpay_payment RPC when a captured
//    payment exists, so the wallet lands even if the client never returned
//    from the browser and the webhook was missed/delayed.
//  - Marks orders older than the cutoff (default 45 min) as `expired` when
//    no captured payment is found, so pending banners auto-clear.

export const Route = createFileRoute("/api/public/hooks/reconcile-razorpay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!RAZORPAY_ENABLED) {
          return new Response("Disabled", { status: 503 });
        }
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!apikey || !expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { getPaymentSettings } = await import("@/lib/payments.functions");
        const settings = await getPaymentSettings();
        if (!settings.key_id || !settings.key_secret) {
          return new Response(
            JSON.stringify({ ok: false, reason: "razorpay_not_configured" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const runId = crypto.randomUUID();
        const now = Date.now();
        const MIN_AGE_MS = 2 * 60 * 1000; // wait 2 min before probing
        const EXPIRY_MS = 45 * 60 * 1000; // give up after 45 min
        const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000; // don't scan >24h old

        const olderThan = new Date(now - MIN_AGE_MS).toISOString();
        const notOlderThan = new Date(now - MAX_LOOKBACK_MS).toISOString();

        const { data: pending, error: qErr } = await supabaseAdmin
          .from("razorpay_orders")
          .select("id, user_id, razorpay_order_id, status, created_at")
          .in("status", ["created", "attempted", "paid"])
          .lt("created_at", olderThan)
          .gt("created_at", notOlderThan)
          .order("created_at", { ascending: true })
          .limit(100);

        if (qErr) {
          return new Response(
            JSON.stringify({ ok: false, error: qErr.message, runId }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const authHeader =
          "Basic " + btoa(`${settings.key_id}:${settings.key_secret}`);

        let credited = 0;
        let expired = 0;
        let stillPending = 0;
        const failures: Array<{ order_id: string; reason: string }> = [];

        for (const row of pending ?? []) {
          const orderId = row.razorpay_order_id;
          try {
            const resp = await fetch(
              `https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}/payments`,
              { headers: { Authorization: authHeader } },
            );
            if (!resp.ok) {
              failures.push({
                order_id: orderId,
                reason: `razorpay_${resp.status}`,
              });
              continue;
            }
            const body = (await resp.json()) as {
              items?: Array<{
                id: string;
                status: string;
                captured?: boolean;
              }>;
            };
            const items = body.items ?? [];
            const captured = items.find(
              (p) => p.status === "captured" || p.captured === true,
            );

            if (captured) {
              const { data: creditResult, error: rpcErr } =
                await supabaseAdmin.rpc("credit_razorpay_payment", {
                  _order_id: orderId,
                  _payment_id: captured.id,
                  _payload: {
                    source: "reconcile",
                    run_id: runId,
                    payment: captured,
                  },
                });
              if (rpcErr) {
                failures.push({ order_id: orderId, reason: rpcErr.message });
                continue;
              }
              const ok =
                creditResult &&
                typeof creditResult === "object" &&
                (creditResult as { ok?: boolean }).ok !== false;
              if (ok) {
                credited++;
                try {
                  const { data: fresh } = await supabaseAdmin
                    .from("razorpay_orders")
                    .select("user_id, coins_credited, bonus_credited, status")
                    .eq("id", row.id)
                    .maybeSingle();
                  if (fresh?.user_id && fresh.status === "credited") {
                    const coins = Number(fresh.coins_credited ?? 0);
                    const bonus = Number(fresh.bonus_credited ?? 0);
                    const bonusTxt = bonus > 0 ? ` (incl. ${bonus} bonus)` : "";
                    const { notifyUser } = await import("@/lib/push.functions");
                    await notifyUser({
                      userId: fresh.user_id,
                      kind: "system",
                      title: "Recharge successful",
                      body: `${coins} coins credited to your wallet${bonusTxt}.`,
                      deepLink: "/wallet",
                    });
                  }
                } catch (e) {
                  console.error("reconcile success notify failed", e);
                }
              }
              continue;
            }

            const ageMs = now - new Date(row.created_at).getTime();
            if (ageMs > EXPIRY_MS) {
              await supabaseAdmin
                .from("razorpay_orders")
                .update({ status: "expired" })
                .eq("id", row.id)
                .neq("status", "credited");
              expired++;
              try {
                const { notifyUser } = await import("@/lib/push.functions");
                await notifyUser({
                  userId: row.user_id,
                  kind: "system",
                  title: "Recharge pending expired",
                  body: "We couldn't confirm your payment. If money was debited, it will be refunded automatically. Tap to try again.",
                  deepLink: "/recharge",
                });
              } catch (e) {
                console.error("reconcile expiry notify failed", e);
              }
            } else {
              stillPending++;
            }
          } catch (e) {
            failures.push({
              order_id: orderId,
              reason: e instanceof Error ? e.message : "unknown",
            });
          }
        }

        return new Response(
          JSON.stringify({
            ok: true,
            runId,
            scanned: pending?.length ?? 0,
            credited,
            expired,
            stillPending,
            failures,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
