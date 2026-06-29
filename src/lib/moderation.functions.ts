import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Phase 3 — AI Moderation
 *
 * Flow:
 *   client (in-call sampler) → submitMediaSample({kind, dataUrl, callLogId})
 *     → Lovable AI Gateway (Gemini multimodal)
 *     → severity bucketed → moderation_events insert
 *     → DB trigger apply_moderation_strike → 3-strike auto-ban
 *
 * Severity buckets:
 *   ai_score ≥ 0.85 → severity 5 → status='confirmed' (counts as a strike)
 *   ai_score ≥ 0.65 → severity 3 → status='pending_review' (admin reviews)
 *   ai_score <  0.65 → no event written (noise reduction)
 *
 * Cost guard: rate-limited to 1 sample per user per 25s (server-side).
 */

const SAMPLE_RATE_LIMIT_MS = 25_000;

// Lovable AI moderation prompt — strict JSON output so we can parse safely.
const MOD_SYSTEM_PROMPT = `You are a safety moderator for a real-time video/voice chat app.
Analyze the supplied media (image frame and/or short audio clip) and return STRICT JSON only:

{
  "category": "nudity" | "sexual" | "violence" | "harassment" | "hate" | "self_harm" | "csam_suspect" | "safe" | "other",
  "score": number between 0.0 and 1.0,
  "label": short human-readable phrase,
  "csam_suspect": boolean
}

Rules:
- "safe" with score < 0.2 if content is benign.
- Use "csam_suspect": true ONLY if there is any visual indication the person may be a minor in a sexual/suggestive context. Be cautious — false positives are acceptable here.
- For audio: detect explicit sexual speech, slurs, threats, or grooming language.
- NEVER refuse — always return the JSON object. If unclear, return {"category":"other","score":0.0,"label":"unclear","csam_suspect":false}.
`;

interface AIVerdict {
  category: string;
  score: number;
  label: string;
  csam_suspect: boolean;
}

async function classifyWithAI(opts: {
  kind: "voice" | "video" | "image" | "text";
  dataUrl?: string;        // for image/video frame: data:image/jpeg;base64,...
  audioDataUrl?: string;   // for audio: data:audio/webm;base64,...
  text?: string;
}): Promise<AIVerdict> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI gateway not configured");

  const userContent: any[] = [];
  if (opts.text) {
    userContent.push({ type: "text", text: `Analyze this chat message: """${opts.text.slice(0, 800)}"""` });
  }
  if (opts.dataUrl) {
    userContent.push({ type: "text", text: "Analyze this video frame:" });
    userContent.push({ type: "image_url", image_url: { url: opts.dataUrl } });
  }
  if (opts.audioDataUrl) {
    // OpenAI-compat audio part — gateway forwards to multimodal models.
    userContent.push({ type: "text", text: "Analyze this short voice clip:" });
    userContent.push({
      type: "input_audio",
      input_audio: { data: opts.audioDataUrl.split(",")[1] ?? "", format: "webm" },
    });
  }
  if (userContent.length === 0) {
    userContent.push({ type: "text", text: "No content supplied. Return safe." });
  }

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: MOD_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (res.status === 429) throw new Error("Moderation throttled");
  if (res.status === 402) throw new Error("AI credits exhausted");
  if (!res.ok) throw new Error(`AI moderation failed (${res.status})`);

  const payload = await res.json();
  const raw = payload?.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      category: String(parsed.category ?? "other"),
      score: Number(parsed.score ?? 0),
      label: String(parsed.label ?? ""),
      csam_suspect: Boolean(parsed.csam_suspect ?? false),
    };
  } catch {
    return { category: "other", score: 0, label: "parse_error", csam_suspect: false };
  }
}

function severityFor(score: number, csam: boolean): { severity: number; status: "confirmed" | "pending_review" | "skip" } {
  if (csam) return { severity: 5, status: "confirmed" };
  if (score >= 0.85) return { severity: 5, status: "confirmed" };
  if (score >= 0.65) return { severity: 3, status: "pending_review" };
  return { severity: 1, status: "skip" };
}

// ---- submit a sample (called from the client during a live call) ----
export const submitMediaSample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({
      kind: z.enum(["voice", "video", "image"]),
      // Target user being analyzed (peer in the call). Self = local mic/cam sample.
      targetUserId: z.string().uuid(),
      callLogId: z.string().uuid().nullable().optional(),
      dataUrl: z.string().max(2_500_000).nullable().optional(),       // ≤ ~1.8MB base64
      audioDataUrl: z.string().max(2_500_000).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // ---- Rate-limit: 1 sample per user per 25s ----
    const since = new Date(Date.now() - SAMPLE_RATE_LIMIT_MS).toISOString();
    const { count } = await supabase
      .from("moderation_events")
      .select("id", { count: "exact", head: true })
      .eq("reporter_user_id", userId)
      .gte("created_at", since);
    if ((count ?? 0) > 0) return { skipped: "rate_limited" as const };

    const verdict = await classifyWithAI({
      kind: data.kind,
      dataUrl: data.dataUrl ?? undefined,
      audioDataUrl: data.audioDataUrl ?? undefined,
    });

    const { severity, status } = severityFor(verdict.score, verdict.csam_suspect);
    if (status === "skip") {
      return { skipped: "below_threshold" as const, verdict };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("moderation_events")
      .insert({
        user_id: data.targetUserId,
        reporter_user_id: userId,
        call_log_id: data.callLogId ?? null,
        kind: data.kind,
        category: verdict.csam_suspect ? "csam_suspect" : verdict.category,
        severity,
        ai_label: verdict.label,
        ai_score: verdict.score,
        ai_model: "google/gemini-3-flash-preview",
        evidence: {
          // Never store the full frame in DB — just a tiny audit fingerprint.
          had_image: Boolean(data.dataUrl),
          had_audio: Boolean(data.audioDataUrl),
          ts: new Date().toISOString(),
        },
        status,
      })
      .select("id, severity, status, category")
      .single();
    if (error) throw new Error(error.message);

    return { ok: true as const, event: row, verdict };
  });

// ---- Text chat moderation (called per outbound message) ----
export const moderateChatText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({
      targetUserId: z.string().uuid(),
      text: z.string().min(1).max(2000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const verdict = await classifyWithAI({ kind: "text", text: data.text });
    const { severity, status } = severityFor(verdict.score, verdict.csam_suspect);
    if (status === "skip") return { ok: true as const, allowed: true, verdict };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("moderation_events").insert({
      user_id: userId,                       // text strike is on the SENDER
      reporter_user_id: userId,
      kind: "text",
      category: verdict.category,
      severity,
      ai_label: verdict.label,
      ai_score: verdict.score,
      ai_model: "google/gemini-3-flash-preview",
      evidence: { snippet: data.text.slice(0, 240), peer: data.targetUserId },
      status,
    });
    // Block message when severity = 5 (confirmed abuse).
    return { ok: true as const, allowed: severity < 5, verdict };
  });

// ---- Admin: list queue ----
async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

export const adminListModerationQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("moderation_events")
      .select("id, user_id, reporter_user_id, kind, category, severity, ai_label, ai_score, status, evidence, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    // Hydrate usernames
    const ids = Array.from(new Set((data ?? []).flatMap((r) => [r.user_id, r.reporter_user_id]).filter(Boolean) as string[]));
    const { data: profs } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, username, strike_count, is_banned").in("id", ids)
      : { data: [] as any[] };
    const byId = new Map((profs ?? []).map((p: any) => [p.id, p]));
    return (data ?? []).map((r) => ({
      ...r,
      target: byId.get(r.user_id) ?? null,
      reporter: r.reporter_user_id ? byId.get(r.reporter_user_id) ?? null : null,
    }));
  });

export const adminReviewModerationEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["confirmed", "dismissed"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("moderation_events")
      .update({ status: data.status, reviewed_by: context.userId, reviewed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- Admin: CSAM escalation workflow ----
export const adminFlagCsam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({
      targetUserId: z.string().uuid(),
      callLogId: z.string().uuid().nullable().optional(),
      narrative: z.string().min(20).max(4000),
      evidenceHash: z.string().max(128).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Permanently ban the target — non-negotiable for CSAM escalation.
    await supabaseAdmin
      .from("profiles")
      .update({ is_banned: true, ban_reason: "CSAM escalation — pending law enforcement review" })
      .eq("id", data.targetUserId);
    await supabaseAdmin.from("bans").insert({
      user_id: data.targetUserId,
      reason: "CSAM escalation",
      ban_type: "permanent",
      is_active: true,
    } as any);

    // 2) Sealed escalation record.
    const { data: row, error } = await supabaseAdmin
      .from("csam_reports")
      .insert({
        target_user_id: data.targetUserId,
        reported_by_admin: context.userId,
        call_log_id: data.callLogId ?? null,
        evidence_hash: data.evidenceHash ?? null,
        narrative: data.narrative,
        status: "queued",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const adminListCsamReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("csam_reports")
      .select("id, target_user_id, reported_by_admin, call_log_id, evidence_hash, narrative, status, case_ref, escalated_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminUpdateCsamReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["queued", "escalated", "closed"]),
      caseRef: z.string().max(120).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = { status: data.status };
    if (data.caseRef) patch.case_ref = data.caseRef;
    if (data.status === "escalated") patch.escalated_at = new Date().toISOString();
    const { error } = await supabaseAdmin.from("csam_reports").update(patch as any).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
