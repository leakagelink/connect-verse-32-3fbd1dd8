import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FilterSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  eventType: z.string().optional(),
  inviteId: z.string().uuid().optional(),
  callLogId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  sinceMinutes: z.number().int().min(1).max(60 * 24 * 14).optional(),
});

export interface CallEventRow {
  id: number;
  created_at: string;
  event_type: string;
  invite_id: string | null;
  call_log_id: string | null;
  caller_id: string | null;
  callee_id: string | null;
  actor_id: string | null;
  kind: string | null;
  status: string | null;
  reason: string | null;
  duration_ms: number | null;
  ok: boolean | null;
  meta: unknown;
}

export const listCallEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => FilterSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<{
    rows: CallEventRow[];
    summary: Record<string, number>;
  }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: isAdmin } = await db.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    let q = db
      .from("call_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.eventType) q = q.eq("event_type", data.eventType);
    if (data.inviteId) q = q.eq("invite_id", data.inviteId);
    if (data.callLogId) q = q.eq("call_log_id", data.callLogId);
    if (data.userId) {
      q = q.or(
        `caller_id.eq.${data.userId},callee_id.eq.${data.userId},actor_id.eq.${data.userId}`,
      );
    }
    if (data.sinceMinutes) {
      const since = new Date(Date.now() - data.sinceMinutes * 60_000).toISOString();
      q = q.gte("created_at", since);
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const summary: Record<string, number> = {};
    for (const r of (rows ?? []) as CallEventRow[]) {
      summary[r.event_type] = (summary[r.event_type] ?? 0) + 1;
    }
    return { rows: (rows ?? []) as CallEventRow[], summary };
  });

export const purgeCallEventsOlderThan14d = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: isAdmin } = await db.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { data, error } = await db.rpc("purge_old_call_events");
    if (error) throw new Error(error.message);
    return { purged: (data as number) ?? 0 };
  });
