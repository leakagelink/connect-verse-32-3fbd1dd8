ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS call_logs_active_heartbeat_idx
  ON public.call_logs (last_heartbeat_at)
  WHERE ended_at IS NULL;