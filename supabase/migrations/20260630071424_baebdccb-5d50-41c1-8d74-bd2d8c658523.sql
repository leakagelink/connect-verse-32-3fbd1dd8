
CREATE TABLE IF NOT EXISTS public.call_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  invite_id UUID,
  call_log_id UUID,
  caller_id UUID,
  callee_id UUID,
  actor_id UUID,
  kind TEXT,
  status TEXT,
  reason TEXT,
  duration_ms INTEGER,
  ok BOOLEAN,
  meta JSONB
);

CREATE INDEX IF NOT EXISTS call_events_created_idx ON public.call_events (created_at DESC);
CREATE INDEX IF NOT EXISTS call_events_invite_idx ON public.call_events (invite_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_events_call_log_idx ON public.call_events (call_log_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_events_type_idx ON public.call_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS call_events_caller_idx ON public.call_events (caller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_events_callee_idx ON public.call_events (callee_id, created_at DESC);

GRANT SELECT ON public.call_events TO authenticated;
GRANT ALL ON public.call_events TO service_role;

ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read call events"
  ON public.call_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Retention helper: prune events older than 14 days (admins can call manually
-- or from a scheduled task). Keeps table light without losing diag value.
CREATE OR REPLACE FUNCTION public.purge_old_call_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n INTEGER;
BEGIN
  DELETE FROM public.call_events WHERE created_at < now() - INTERVAL '14 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
