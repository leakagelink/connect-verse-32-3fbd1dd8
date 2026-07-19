import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron endpoint: process scheduled account deletions whose grace period
 * has elapsed. Schedule via pg_cron (hourly is fine).
 *
 * Auth: send `apikey: <SUPABASE_PUBLISHABLE_KEY>` header (same pattern
 * as other public hooks in this project).
 */
export const Route = createFileRoute("/api/public/hooks/process-privacy-deletions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!apikey || !expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowIso = new Date().toISOString();

        const { data: due, error } = await supabaseAdmin
          .from("privacy_requests")
          .select("id, user_id")
          .eq("kind", "deletion")
          .eq("status", "pending")
          .lte("scheduled_for", nowIso)
          .limit(50);

        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const results: Array<{ id: string; user_id: string; ok: boolean; error?: string }> = [];
        for (const row of due ?? []) {
          try {
            await supabaseAdmin
              .from("privacy_requests")
              .update({ status: "processing" })
              .eq("id", row.id);

            // Redact profile row (audit trail before cascade).
            await supabaseAdmin
              .from("profiles")
              .update({
                username: `deleted_${String(row.user_id).slice(0, 8)}`,
                avatar_url: null,
                bio: null,
                deleted_at: nowIso,
              })
              .eq("id", row.user_id);

            const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(row.user_id);
            if (delErr) throw delErr;

            await supabaseAdmin
              .from("privacy_requests")
              .update({ status: "completed", completed_at: new Date().toISOString() })
              .eq("id", row.id);

            results.push({ id: row.id, user_id: row.user_id, ok: true });
          } catch (e: any) {
            await supabaseAdmin
              .from("privacy_requests")
              .update({ status: "failed", error: String(e?.message ?? e) })
              .eq("id", row.id);
            results.push({ id: row.id, user_id: row.user_id, ok: false, error: String(e?.message ?? e) });
          }
        }

        return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
