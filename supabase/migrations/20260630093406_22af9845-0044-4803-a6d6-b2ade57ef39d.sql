ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS call_logs_connected_at_idx ON public.call_logs(connected_at);