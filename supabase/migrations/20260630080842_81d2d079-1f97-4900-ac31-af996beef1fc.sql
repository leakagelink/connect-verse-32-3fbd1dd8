-- Null out live call routing details (channel_name, credential_id) once a call has ended,
-- so participants cannot re-use them via the call_logs SELECT policy to rejoin or share
-- access to a concluded Agora session.
CREATE OR REPLACE FUNCTION public.call_logs_redact_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.ended_at IS NOT NULL THEN
    NEW.channel_name := NULL;
    NEW.credential_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_call_logs_redact_finished ON public.call_logs;
CREATE TRIGGER trg_call_logs_redact_finished
BEFORE INSERT OR UPDATE ON public.call_logs
FOR EACH ROW EXECUTE FUNCTION public.call_logs_redact_finished();

-- Backfill: clear sensitive fields on already-ended call logs.
UPDATE public.call_logs
   SET channel_name = NULL,
       credential_id = NULL
 WHERE ended_at IS NOT NULL
   AND (channel_name IS NOT NULL OR credential_id IS NOT NULL);