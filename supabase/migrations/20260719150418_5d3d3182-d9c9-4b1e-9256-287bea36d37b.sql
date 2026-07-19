
DO $$ BEGIN
  CREATE TYPE public.privacy_request_kind AS ENUM ('export', 'deletion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.privacy_request_status AS ENUM ('pending','processing','ready','completed','cancelled','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.privacy_request_kind NOT NULL,
  status public.privacy_request_status NOT NULL DEFAULT 'pending',
  scheduled_for TIMESTAMPTZ,
  download_path TEXT,
  download_expires_at TIMESTAMPTZ,
  size_bytes BIGINT,
  notes TEXT,
  error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS privacy_requests_user_idx ON public.privacy_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS privacy_requests_pending_deletion_idx
  ON public.privacy_requests (scheduled_for)
  WHERE kind = 'deletion' AND status = 'pending';

-- Only one active (pending/processing) deletion at a time per user
CREATE UNIQUE INDEX IF NOT EXISTS privacy_requests_one_active_deletion
  ON public.privacy_requests (user_id)
  WHERE kind = 'deletion' AND status IN ('pending','processing');

GRANT SELECT, INSERT, UPDATE ON public.privacy_requests TO authenticated;
GRANT ALL ON public.privacy_requests TO service_role;

ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own privacy requests"
  ON public.privacy_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users insert own privacy requests"
  ON public.privacy_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users cancel own privacy requests"
  ON public.privacy_requests FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_privacy_requests_updated_at
  BEFORE UPDATE ON public.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage policies: user can read their own export files under privacy-exports/{userId}/...
DO $$ BEGIN
  CREATE POLICY "Users read own privacy export files"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'privacy-exports' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
