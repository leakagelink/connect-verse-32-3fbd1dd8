
-- 1) Safe public profiles view
CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = on) AS
SELECT
  id, username, avatar_url, avatar_path, ai_avatar_style,
  gender, country, state, language, bio,
  is_creator, availability, referral_code, created_at, last_seen_at
FROM public.profiles
WHERE COALESCE(is_banned, false) = false
  AND deleted_at IS NULL;

GRANT SELECT ON public.profiles_public TO authenticated, anon;

-- 2) Avatars: signed-in users can read avatar images
DROP POLICY IF EXISTS "Authenticated can read avatars" ON storage.objects;
CREATE POLICY "Authenticated can read avatars"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'avatars');

-- 3) KYC docs: admin delete
DROP POLICY IF EXISTS "admins delete kyc docs" ON storage.objects;
CREATE POLICY "admins delete kyc docs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'kyc-docs' AND public.has_role(auth.uid(), 'admin'));

-- 4) Matchmaker candidates: split update policy + column guard trigger
DROP POLICY IF EXISTS "Candidate or host can update score" ON public.matchmaker_candidates;

CREATE POLICY "Candidate can update own row"
  ON public.matchmaker_candidates FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Host can update candidate scores"
  ON public.matchmaker_candidates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.matchmaker_rooms r
      WHERE r.id = matchmaker_candidates.room_id AND r.host_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.matchmaker_rooms r
      WHERE r.id = matchmaker_candidates.room_id AND r.host_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.matchmaker_candidates_guard_host_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_host boolean;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() = OLD.user_id AND auth.uid() = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.matchmaker_rooms r
    WHERE r.id = OLD.room_id AND r.host_id = auth.uid()
  ) INTO is_host;

  IF is_host THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.room_id IS DISTINCT FROM OLD.room_id
       OR NEW.seat IS DISTINCT FROM OLD.seat THEN
      RAISE EXCEPTION 'Host can only update score columns on matchmaker candidates';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not allowed to update this candidate';
END;
$$;

DROP TRIGGER IF EXISTS trg_matchmaker_candidates_guard ON public.matchmaker_candidates;
CREATE TRIGGER trg_matchmaker_candidates_guard
  BEFORE UPDATE ON public.matchmaker_candidates
  FOR EACH ROW EXECUTE FUNCTION public.matchmaker_candidates_guard_host_update();
