
ALTER TABLE public.follows
  ADD COLUMN IF NOT EXISTS seen_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days');

-- Backfill expires_at for any existing pending rows so they don't appear stale forever.
UPDATE public.follows
   SET expires_at = created_at + interval '14 days'
 WHERE expires_at IS NULL OR expires_at < created_at;

CREATE INDEX IF NOT EXISTS follows_pending_expiry_idx
  ON public.follows (following_id, status, expires_at);
