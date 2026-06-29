ALTER TABLE public.call_invites ADD COLUMN IF NOT EXISTS client_attempt_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS call_invites_caller_attempt_uniq
  ON public.call_invites (caller_id, client_attempt_id)
  WHERE client_attempt_id IS NOT NULL;