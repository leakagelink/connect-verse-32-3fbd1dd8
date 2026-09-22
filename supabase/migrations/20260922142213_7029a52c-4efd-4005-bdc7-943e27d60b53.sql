-- matchmaker_candidates: only your own row or the room host can read
drop policy if exists "Anyone authed can view candidates" on public.matchmaker_candidates;
create policy "Own or host reads candidates"
on public.matchmaker_candidates for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.matchmaker_rooms r
    where r.id = matchmaker_candidates.room_id and r.host_id = auth.uid()
  )
);

-- matchmaker_rooms: host or a candidate in the room can read
drop policy if exists "Anyone authed can view live rooms" on public.matchmaker_rooms;
create policy "Host or participant reads rooms"
on public.matchmaker_rooms for select to authenticated
using (
  host_id = auth.uid()
  or exists (
    select 1 from public.matchmaker_candidates c
    where c.room_id = matchmaker_rooms.id and c.user_id = auth.uid()
  )
);

-- fan_clubs: only the owning creator (fan club features are not active)
drop policy if exists "anyone reads fan_clubs" on public.fan_clubs;
create policy "Creator reads own fan club"
on public.fan_clubs for select to authenticated
using (creator_id = auth.uid());

-- creator_availability: signed-in users only, not the public internet
drop policy if exists "anyone reads availability" on public.creator_availability;
create policy "Authed reads availability"
on public.creator_availability for select to authenticated
using (true);
revoke select on public.creator_availability from anon;
revoke select on public.fan_clubs from anon;