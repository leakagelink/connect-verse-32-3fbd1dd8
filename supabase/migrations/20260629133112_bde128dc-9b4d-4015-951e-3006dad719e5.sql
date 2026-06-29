ALTER TABLE public.call_invites ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS call_invites_delivered_idx ON public.call_invites (id) WHERE delivered_at IS NOT NULL;