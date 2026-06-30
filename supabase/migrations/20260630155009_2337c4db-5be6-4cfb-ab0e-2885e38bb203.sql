
-- 1. calling_credentials: explicit admin-only SELECT (defense in depth)
CREATE POLICY "admins read calling credentials"
  ON public.calling_credentials FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. profiles: block self-update of sensitive columns via trigger
CREATE OR REPLACE FUNCTION public.profiles_block_sensitive_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow service_role and admins to change anything
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.is_creator IS DISTINCT FROM OLD.is_creator
     OR NEW.is_banned IS DISTINCT FROM OLD.is_banned
     OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason
     OR NEW.strike_count IS DISTINCT FROM OLD.strike_count
     OR NEW.referred_by IS DISTINCT FROM OLD.referred_by
     OR NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
    RAISE EXCEPTION 'Sensitive profile columns cannot be modified by the user';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_block_sensitive_self_update_trg ON public.profiles;
CREATE TRIGGER profiles_block_sensitive_self_update_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_block_sensitive_self_update();

-- 3. withdrawals: drop user INSERT policy (server uses service role)
DROP POLICY IF EXISTS "users insert own withdrawals" ON public.withdrawals;

-- 4. call_usage_flushes: explicit admin SELECT policy (no user access)
CREATE POLICY "admins read call usage flushes"
  ON public.call_usage_flushes FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 5. moderation_events: severity column nullable so reporter policy works
ALTER TABLE public.moderation_events ALTER COLUMN severity DROP NOT NULL;
