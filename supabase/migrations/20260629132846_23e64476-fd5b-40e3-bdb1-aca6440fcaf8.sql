ALTER TABLE public.call_invites REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'call_invites'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_invites;
  END IF;
END $$;