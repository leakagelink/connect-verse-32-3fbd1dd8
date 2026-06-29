import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const submitReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    targetUserId: z.string().uuid(),
    reason: z.enum(["harassment","nudity","fake_profile","spam","threat","violence","scam","underage","other"]),
    context: z.string().max(500).optional(),
    messageExcerpt: z.string().max(500).optional(),
    conversationId: z.string().uuid().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.targetUserId === userId) throw new Error("Cannot report yourself");
    const { error } = await supabase.from("reports").insert({
      reporter_id: userId,
      target_user_id: data.targetUserId,
      reason: data.reason,
      context: data.context ?? null,
      message_excerpt: data.messageExcerpt ?? null,
      conversation_id: data.conversationId ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const blockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ targetUserId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("blocks")
      .insert({ blocker_id: context.userId, blocked_id: data.targetUserId });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    return { ok: true };
  });

export const unblockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ targetUserId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("blocks")
      .delete()
      .eq("blocker_id", context.userId)
      .eq("blocked_id", data.targetUserId);
    return { ok: true };
  });
