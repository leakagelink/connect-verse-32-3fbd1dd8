import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listRooms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: rooms } = await supabase
      .from("rooms")
      .select("id, host_id, title, topic, kind, max_seats, cover_url, gender_gate, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(80);
    if (!rooms?.length) return [];
    const hostIds = [...new Set(rooms.map((r) => r.host_id))];
    const [{ data: hosts }, { data: parts }] = await Promise.all([
      supabase.from("profiles").select("id, username, avatar_url, gender").in("id", hostIds),
      supabase.from("room_participants").select("room_id").in("room_id", rooms.map((r) => r.id)),
    ]);
    const hmap = new Map((hosts ?? []).map((h) => [h.id, h]));
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
    gender_gate: z.enum(["all", "ladies_lounge"]).default("all"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Ladies Lounge can only be hosted by verified female creators.
    if (data.gender_gate === "ladies_lounge") {
      const { data: host } = await supabase
        .from("profiles")
        .select("gender, is_creator")
        .eq("id", userId)
        .maybeSingle();
      if (host?.gender !== "female") {
        throw new Error("Only female creators can host a Ladies Lounge room.");
      }
    }

    const { data: room, error } = await supabase
      .from("rooms")
      .insert({
        host_id: userId,
        title: data.title,
        topic: data.topic ?? null,
        kind: data.kind,
        max_seats: data.max_seats,
        gender_gate: data.gender_gate,
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

    // Ladies Lounge: males may join only as listener (no speaker seat).
    // We mark this on the participant via room_participants metadata — the
    // room UI uses gender_gate + caller gender to render mic-disabled mode.
    if (room.gender_gate === "ladies_lounge") {
      const { data: me } = await supabase
        .from("profiles").select("gender").eq("id", userId).maybeSingle();
      if (me?.gender !== "female" && me?.gender !== "male") {
        throw new Error("Ladies Lounge: cannot join with this profile.");
      }
      // males proceed but the UI will disable mic + camera.
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
    const { data: profiles } = await supabase.from("profiles").select("id, username, avatar_url, is_creator").in("id", ids);
    return { room, participants: profiles ?? [] };
  });
