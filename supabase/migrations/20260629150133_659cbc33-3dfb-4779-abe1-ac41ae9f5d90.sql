ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS end_reason text,
  ADD COLUMN IF NOT EXISTS ended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_end_reason_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN (
    'user_ended','peer_left','coins_exhausted','media_error','network','admin','unknown'
  ));

CREATE INDEX IF NOT EXISTS call_logs_end_reason_idx ON public.call_logs (end_reason, started_at DESC);