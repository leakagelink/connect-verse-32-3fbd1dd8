ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS missed_reason text;
ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_missed_reason_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_missed_reason_check
  CHECK (missed_reason IS NULL OR missed_reason IN ('expired','caller_cancelled','callee_rejected'));