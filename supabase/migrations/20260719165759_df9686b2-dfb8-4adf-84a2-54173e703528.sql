
-- app_settings: restrict reads to whitelisted public keys or admins
DROP POLICY IF EXISTS "Authenticated can read settings" ON public.app_settings;
CREATE POLICY "Public settings readable by authed"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (key IN ('connect_filters_visible'));
CREATE POLICY "Admins read all settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- matchmaker_votes: only voter, room host, or admin can see vote rows
DROP POLICY IF EXISTS "Anyone authed can view votes" ON public.matchmaker_votes;
CREATE POLICY "Voter sees own vote"
  ON public.matchmaker_votes FOR SELECT
  TO authenticated
  USING (voter_id = auth.uid());
CREATE POLICY "Host sees room votes"
  ON public.matchmaker_votes FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.matchmaker_rooms r
    WHERE r.id = matchmaker_votes.room_id AND r.host_id = auth.uid()
  ));
CREATE POLICY "Admins see all votes"
  ON public.matchmaker_votes FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- room_participants: only same-room members, host, or admin
CREATE OR REPLACE FUNCTION public.is_room_member(_room uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_participants
    WHERE room_id = _room AND user_id = _user
  )
$$;

DROP POLICY IF EXISTS "authed can view participants" ON public.room_participants;
CREATE POLICY "Members see room participants"
  ON public.room_participants FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_room_member(room_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_participants.room_id AND r.host_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );
