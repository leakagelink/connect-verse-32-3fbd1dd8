import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const EventSchema = z.object({
  event_type: z.enum(["route_load", "api_call", "error", "component"]),
  route: z.string().max(200).optional().nullable(),
  label: z.string().max(200).optional().nullable(),
  duration_ms: z.number().int().min(0).max(600000).optional().nullable(),
  status: z.number().int().optional().nullable(),
  ok: z.boolean().optional().nullable(),
  trace_id: z.string().max(64).optional().nullable(),
  meta: z.record(z.any()).optional().nullable(),
});

export const logPerfBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ events: z.array(EventSchema).max(50) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!data.events.length) return { inserted: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = data.events.map((e) => ({ ...e, user_id: context.userId }));
    const { error } = await supabaseAdmin.from("perf_events").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export const adminPerfSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ windowMinutes: z.number().int().min(1).max(1440).default(15) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.windowMinutes * 60_000).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from("perf_events")
      .select("event_type, route, label, duration_ms, status, ok, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const routeAgg = new Map<string, number[]>();
    const apiAgg = new Map<string, number[]>();
    const apiErrors = new Map<string, number>();
    const errorAgg = new Map<string, { count: number; lastAt: string; lastRoute: string | null }>();
    let totalEvents = 0, totalErrors = 0;

    for (const r of rows ?? []) {
      totalEvents++;
      if (r.event_type === "route_load" && r.route && typeof r.duration_ms === "number") {
        const arr = routeAgg.get(r.route) ?? [];
        arr.push(r.duration_ms);
        routeAgg.set(r.route, arr);
      } else if (r.event_type === "api_call" && r.label) {
        if (typeof r.duration_ms === "number") {
          const arr = apiAgg.get(r.label) ?? [];
          arr.push(r.duration_ms);
          apiAgg.set(r.label, arr);
        }
        if (r.ok === false) apiErrors.set(r.label, (apiErrors.get(r.label) ?? 0) + 1);
      } else if (r.event_type === "error") {
        totalErrors++;
        const key = r.label ?? "unknown";
        const e = errorAgg.get(key) ?? { count: 0, lastAt: r.created_at as string, lastRoute: r.route ?? null };
        e.count++;
        errorAgg.set(key, e);
      }
    }

    const routes = [...routeAgg.entries()].map(([route, arr]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const avg = Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
      return { route, count: arr.length, avg, p95: Math.round(percentile(sorted, 95)) };
    }).sort((a, b) => b.count - a.count);

    const apis = [...apiAgg.entries()].map(([label, arr]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const avg = Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
      return {
        label, count: arr.length, avg,
        p95: Math.round(percentile(sorted, 95)),
        errors: apiErrors.get(label) ?? 0,
      };
    }).sort((a, b) => b.p95 - a.p95);

    const errors = [...errorAgg.entries()].map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.count - a.count);

    return {
      windowMinutes: data.windowMinutes,
      totalEvents,
      totalErrors,
      routes,
      apis,
      errors,
      generatedAt: new Date().toISOString(),
    };
  });

export const adminPerfTraces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({
      windowMinutes: z.number().int().min(1).max(1440).default(60),
      minDurationMs: z.number().int().min(0).max(60000).default(0),
      limit: z.number().int().min(1).max(50).default(20),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.windowMinutes * 60_000).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from("perf_events")
      .select("event_type, route, label, duration_ms, status, ok, created_at, trace_id, meta")
      .gte("created_at", since)
      .not("trace_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const byTrace = new Map<string, any[]>();
    for (const r of rows ?? []) {
      const id = r.trace_id as string;
      const arr = byTrace.get(id) ?? [];
      arr.push(r);
      byTrace.set(id, arr);
    }

    const traces = [...byTrace.entries()].map(([trace_id, events]) => {
      const sorted = [...events].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const routeLoad = sorted.find((e) => e.event_type === "route_load");
      const route = routeLoad?.route ?? sorted[0]?.route ?? "(unknown)";
      const startedAt = sorted[0]?.created_at;
      const apis = sorted.filter((e) => e.event_type === "api_call");
      const components = sorted.filter((e) => e.event_type === "component");
      const errs = sorted.filter((e) => e.event_type === "error");
      const apiTotal = apis.reduce((s, e) => s + (e.duration_ms ?? 0), 0);
      const apiMax = apis.reduce((m, e) => Math.max(m, e.duration_ms ?? 0), 0);
      const totalMs = Math.max(
        routeLoad?.duration_ms ?? 0,
        apiMax,
        components.reduce((m, e) => Math.max(m, e.duration_ms ?? 0), 0),
      );
      // Worst offenders inside this trace
      const slowApis = [...apis].sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0)).slice(0, 5);
      const slowComponents = [...components].sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0)).slice(0, 5);
      return {
        trace_id, route, startedAt,
        routeLoadMs: routeLoad?.duration_ms ?? null,
        totalMs,
        apiCount: apis.length,
        apiErrors: apis.filter((e) => e.ok === false).length,
        apiTotalMs: apiTotal,
        componentCount: components.length,
        errorCount: errs.length,
        slowApis: slowApis.map((e) => ({ label: e.label, duration_ms: e.duration_ms, ok: e.ok, status: e.status })),
        slowComponents: slowComponents.map((e) => ({ label: e.label, duration_ms: e.duration_ms })),
        errors: errs.map((e) => ({ label: e.label })),
      };
    })
      .filter((t) => t.totalMs >= data.minDurationMs)
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, data.limit);

    return { traces, generatedAt: new Date().toISOString() };
  });
