import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withAiAvatars } from "./ai-avatar";
import {
  GENDER_GATED_ROOMS_ENABLED,
  FEATURE_OFF_MESSAGES,
  assertFeatureEnabled,
} from "./feature-flags";

export const listRooms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let roomQuery = supabase
      .from("rooms")
      .select("id, host_id, title, topic, kind, max_seats, cover_url, gender_gate, created_at")
      .eq("is_active", true);
    // Gender-gated rooms are not listed in this release.
    if (!GENDER_GATED_ROOMS_ENABLED) roomQuery = roomQuery.eq("gender_gate", "all");
    const { data: rooms } = await roomQuery
      .order("created_at", { ascending: false })
      .limit(80);
    if (!rooms?.length) return [];
    const hostIds = [...new Set(rooms.map((r) => r.host_id))];
    const [{ data: hosts }, { data: parts }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, ai_avatar_style, gender, is_banned, onboarded, deleted_at")
        .in("id", hostIds)
        .eq("is_banned", false)
        .eq("onboarded", true)
        .is("deleted_at", null),
      supabase.from("room_participants").select("room_id").in("room_id", rooms.map((r) => r.id)),
    ]);
    const hmap = new Map(withAiAvatars(hosts ?? []).map((h) => [h.id, h]));
    const counts = new Map<string, number>();
    (parts ?? []).forEach((p) => counts.set(p.room_id, (counts.get(p.room_id) ?? 0) + 1));
    return rooms.map((r) => ({ ...r, host: hmap.get(r.host_id), participants: counts.get(r.id) ?? 0 }));
  });

export const createRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({
    title: z.string().trim().min(3).max(60),
    topic: z.string().trim().max(160).optional(),
    kind: z.enum(["voice", "video", "game", "live"]),
    max_seats: z.number().int().min(2).max(20).default(8),
    // Gender-gated rooms are disabled for this release; only neutral community
    // rooms can be created. The column stays for future architecture.
    gender_gate: z.enum(["all", "ladies_lounge"]).default("all"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Server-side rejection: no gender-restricted room may be created while
    // GENDER_GATED_ROOMS_ENABLED is false, whatever the client sends.
    if (data.gender_gate !== "all") {
      assertFeatureEnabled(GENDER_GATED_ROOMS_ENABLED, FEATURE_OFF_MESSAGES.genderRooms);
    }

    const { data: room, error } = await supabase
      .from("rooms")
      .insert({
        host_id: userId,
        title: data.title,
        topic: data.topic ?? null,
        kind: data.kind,
        max_seats: data.max_seats,
        gender_gate: GENDER_GATED_ROOMS_ENABLED ? data.gender_gate : "all",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await supabase.from("room_participants").insert({ room_id: room.id, user_id: userId });
    return { id: room.id };
  });

export const joinRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ roomId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: room } = await supabase
      .from("rooms")
      .select("id, max_seats, is_active, gender_gate")
      .eq("id", data.roomId)
      .maybeSingle();
    if (!room || !room.is_active) throw new Error("Room is not available");

    // Gender-gated rooms are disabled: no gender check decides access, and any
    // legacy gender-restricted room is not joinable in this release.
    if (room.gender_gate && room.gender_gate !== "all") {
      assertFeatureEnabled(GENDER_GATED_ROOMS_ENABLED, FEATURE_OFF_MESSAGES.genderRooms);
    }

    const { count } = await supabase.from("room_participants").select("id", { count: "exact", head: true }).eq("room_id", data.roomId);
    if ((count ?? 0) >= room.max_seats) throw new Error("Room is full");
    await supabase.from("room_participants").upsert({ room_id: data.roomId, user_id: userId }, { onConflict: "room_id,user_id" });
    return { ok: true };
  });

export const leaveRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ roomId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.from("room_participants").delete().eq("room_id", data.roomId).eq("user_id", userId);
    // host ends the room if they leave
    const { data: room } = await supabase.from("rooms").select("host_id").eq("id", data.roomId).maybeSingle();
    if (room?.host_id === userId) {
      await supabase.from("rooms").update({ is_active: false }).eq("id", data.roomId);
    }
    return { ok: true };
  });

export const getRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ roomId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: room } = await supabase
      .from("rooms")
      .select("id, host_id, title, topic, kind, max_seats, is_active, created_at")
      .eq("id", data.roomId)
      .maybeSingle();
    if (!room) throw new Error("Room not found");
    const { data: parts } = await supabase
      .from("room_participants")
      .select("user_id, joined_at")
      .eq("room_id", data.roomId);
    const ids = (parts ?? []).map((p) => p.user_id);
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url, ai_avatar_style, gender, is_creator, is_banned, onboarded, deleted_at")
      .in("id", ids)
      .eq("is_banned", false)
      .eq("onboarded", true)
      .is("deleted_at", null);
    return { room, participants: withAiAvatars(profiles ?? []) };
  });
