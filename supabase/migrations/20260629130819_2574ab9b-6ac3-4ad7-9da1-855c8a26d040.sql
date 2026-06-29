CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.call_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('voice', 'video')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'missed', 'cancelled', 'expired')),
  call_log_id uuid REFERENCES public.call_logs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '45 seconds'),
  accepted_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.call_invites TO authenticated;
GRANT ALL ON public.call_invites TO service_role;

ALTER TABLE public.call_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view call invites"
ON public.call_invites
FOR SELECT
TO authenticated
USING (auth.uid() = caller_id OR auth.uid() = callee_id);

CREATE POLICY "Callers can create call invites"
ON public.call_invites
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = caller_id);

CREATE POLICY "Participants can update call invites"
ON public.call_invites
FOR UPDATE
TO authenticated
USING (auth.uid() = caller_id OR auth.uid() = callee_id)
WITH CHECK (auth.uid() = caller_id OR auth.uid() = callee_id);

CREATE INDEX call_invites_callee_pending_idx
ON public.call_invites (callee_id, status, expires_at DESC);

CREATE INDEX call_invites_caller_created_idx
ON public.call_invites (caller_id, created_at DESC);

CREATE INDEX call_invites_updated_idx
ON public.call_invites (updated_at DESC);

CREATE TRIGGER update_call_invites_updated_at
BEFORE UPDATE ON public.call_invites
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'call_invites'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_invites;
  END IF;
END $$;