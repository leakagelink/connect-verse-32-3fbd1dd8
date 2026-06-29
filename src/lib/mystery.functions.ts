import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const CASE_GENERATION_COIN_COST = 50;

const CaseSchema = z.object({
  title: z.string().min(3).max(120),
  brief: z.string().min(20).max(1200),
  setting: z.string().min(3).max(160),
  persons: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        age: z.number().int().min(16).max(90).optional(),
        role: z.string().min(1),
        relationship: z.string().optional(),
        alibi: z.string().min(5),
        motive: z.string().min(5),
      })
    )
    .min(3)
    .max(5),
  evidence: z.object({
    chat_logs: z
      .array(
        z.object({
          between: z.string(),
          messages: z.array(z.object({ from: z.string(), text: z.string() })),
        })
      )
      .min(1),
    social_profile: z
      .array(z.object({ person_id: z.string(), bio: z.string(), recent_posts: z.array(z.string()) }))
      .min(1),
    voice_note: z.object({ person_id: z.string(), transcript: z.string().min(10) }),
    forensic_report: z.object({
      summary: z.string().min(10),
      findings: z.array(z.string()).min(2),
      time_of_incident: z.string(),
    }),
  }),
  culprit_id: z.string().min(1),
  solution_explanation: z.string().min(30),
});

const SYSTEM_PROMPT = `You are a writer for a casual social mystery party game.
Generate ONE non-graphic, PG-13, fictional whodunit case suitable for a friendly mobile app on the Play Store.

STRICT RULES:
- The crime must be a NON-VIOLENT property crime ONLY: theft of a valuable object, art forgery, a stolen recipe, corporate sabotage, missing pet/diary/manuscript, jewelry heist, identity scam, or a prank gone wrong. Absolutely no murder, assault, sexual content, self-harm, drugs, hate speech, terrorism, weapons, gore, or real public figures.
- Light, cozy, "Knives Out" tone. Keep it playful.
- Provide 4 suspects (persons of interest), each with a believable alibi and motive.
- Provide an evidence locker: a few chat log snippets, social profile blurbs with recent posts, ONE short voice note transcript, and a forensic report (e.g. fingerprints, security camera timestamps, package logs).
- Exactly ONE suspect is the culprit; the evidence must logically point to them on careful reading.
- All names are fictional.

Return ONLY valid JSON matching this exact shape, no markdown, no commentary:
{
  "title": "string",
  "brief": "2-4 sentence setup of the case",
  "setting": "where & when, one line",
  "persons": [
    { "id": "p1", "name": "string", "age": number, "role": "string", "relationship": "string", "alibi": "string", "motive": "string" },
    ... (exactly 4 entries with ids p1..p4)
  ],
  "evidence": {
    "chat_logs": [ { "between": "p1 & p2", "messages": [ { "from": "p1", "text": "..." } ] } ],
    "social_profile": [ { "person_id": "p1", "bio": "...", "recent_posts": ["...", "..."] } ],
    "voice_note": { "person_id": "p2", "transcript": "..." },
    "forensic_report": { "summary": "...", "findings": ["...", "..."], "time_of_incident": "..." }
  },
  "culprit_id": "p3",
  "solution_explanation": "Why the evidence proves the culprit, 2-4 sentences."
}`;

async function generateCaseFromAI(): Promise<z.infer<typeof CaseSchema>> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI gateway not configured");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: "Generate one fresh, fun mystery case now. Make it different from common tropes." },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (res.status === 429) throw new Error("AI is busy right now. Please try again in a moment.");
  if (res.status === 402) throw new Error("AI credits exhausted. Please contact support.");
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);

  const payload = await res.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty AI response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI response was not valid JSON");
  }

  const result = CaseSchema.safeParse(parsed);
  if (!result.success) throw new Error("AI returned an invalid case structure");
  return result.data;
}

export const generateMysteryCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        partnerId: z.string().uuid(),
        callLogId: z.string().uuid().optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Only male users may create cases (host pays).
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("gender, is_banned, onboarded")
      .eq("id", userId)
      .maybeSingle();
    if (profErr || !profile) throw new Error("Profile not found");
    if (profile.is_banned) throw new Error("Your account is restricted");
    if (!profile.onboarded) throw new Error("Complete onboarding first");
    if (profile.gender !== "male") {
      throw new Error("Only male players can host a mystery case");
    }

    // Verify wallet balance
    const { data: wallet, error: wErr } = await supabase
      .from("wallets")
      .select("coin_balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (wErr || !wallet) throw new Error("Wallet missing");
    const balance = Number(wallet.coin_balance);
    if (balance < CASE_GENERATION_COIN_COST) {
      throw new Error(`Not enough coins. You need ${CASE_GENERATION_COIN_COST} coins to host a case.`);
    }

    // Generate the case from the AI gateway BEFORE charging, so a failure doesn't burn coins.
    const aiCase = await generateCaseFromAI();

    // Charge coins atomically via admin client
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: fresh, error: freshErr } = await supabaseAdmin
      .from("wallets")
      .select("coin_balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (freshErr || !fresh) throw new Error("Wallet read failed");
    const liveBalance = Number(fresh.coin_balance);
    if (liveBalance < CASE_GENERATION_COIN_COST) {
      throw new Error("Not enough coins.");
    }
    const newBalance = liveBalance - CASE_GENERATION_COIN_COST;

    const { error: debitErr } = await supabaseAdmin
      .from("wallets")
      .update({ coin_balance: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (debitErr) throw new Error("Failed to charge coins");

    await supabaseAdmin.from("transactions").insert({
      user_id: userId,
      type: "chat_spend",
      coins_delta: -CASE_GENERATION_COIN_COST,
      inr_amount: 0,
      metadata: { reason: "mystery_case", partner_id: data.partnerId },
    });

    // Insert the case (service role — bypass RLS, server-authorized)
    const { data: row, error: insErr } = await supabaseAdmin
      .from("mystery_cases")
      .insert({
        created_by: userId,
        partner_id: data.partnerId,
        call_log_id: data.callLogId ?? null,
        title: aiCase.title,
        brief: aiCase.brief,
        setting: aiCase.setting,
        persons: aiCase.persons,
        evidence: aiCase.evidence,
        culprit_id: aiCase.culprit_id,
        solution_explanation: aiCase.solution_explanation,
        coins_spent: CASE_GENERATION_COIN_COST,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    return { id: row.id as string, newBalance };
  });

export const getMysteryCase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c, error } = await supabase
      .from("mystery_cases")
      .select("*")
      .eq("id", data.caseId)
      .maybeSingle();
    if (error || !c) throw new Error("Case not found");

    const { data: guesses } = await supabase
      .from("case_guesses")
      .select("user_id, guessed_person_id, is_correct, created_at")
      .eq("case_id", data.caseId);

    const myGuess = (guesses ?? []).find((g) => g.user_id === userId);
    const showSolution = c.status === "solved" || !!myGuess;

    return {
      id: c.id,
      title: c.title,
      brief: c.brief,
      setting: c.setting,
      persons: c.persons as any[],
      evidence: c.evidence as any,
      status: c.status as "active" | "solved" | "abandoned",
      coinsSpent: c.coins_spent,
      createdBy: c.created_by,
      partnerId: c.partner_id,
      culpritId: showSolution ? (c.culprit_id as string) : null,
      solutionExplanation: showSolution ? (c.solution_explanation as string) : null,
      guesses: guesses ?? [],
      myGuess: myGuess ?? null,
    };
  });

export const submitGuess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ caseId: z.string().uuid(), personId: z.string().min(1) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c, error } = await supabase
      .from("mystery_cases")
      .select("culprit_id, created_by, partner_id, status")
      .eq("id", data.caseId)
      .maybeSingle();
    if (error || !c) throw new Error("Case not found");
    if (userId !== c.created_by && userId !== c.partner_id) throw new Error("Forbidden");

    const isCorrect = c.culprit_id === data.personId;
    const { error: insErr } = await supabase
      .from("case_guesses")
      .insert({
        case_id: data.caseId,
        user_id: userId,
        guessed_person_id: data.personId,
        is_correct: isCorrect,
      });
    if (insErr) throw new Error(insErr.message);

    if (isCorrect && c.status === "active") {
      await supabase
        .from("mystery_cases")
        .update({ status: "solved" })
        .eq("id", data.caseId);
    }

    return { isCorrect };
  });

export const listMyCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("mystery_cases")
      .select("id, title, status, coins_spent, created_at, created_by, partner_id")
      .or(`created_by.eq.${userId},partner_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(50);
    return data ?? [];
  });
