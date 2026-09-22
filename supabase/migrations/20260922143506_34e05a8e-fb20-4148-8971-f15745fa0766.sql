drop policy if exists "Authed reads availability" on public.creator_availability;
drop policy if exists "anyone reads availability" on public.creator_availability;
create policy "Owner reads own availability"
on public.creator_availability for select to authenticated
using (auth.uid() = user_id);