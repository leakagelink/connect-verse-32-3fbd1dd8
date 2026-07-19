
CREATE TABLE public.sos_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  call_log_id uuid,
  reason text NOT NULL,
  note text,
  outcome text NOT NULL CHECK (outcome IN ('report_filed','report_failed','opened','cancelled')),
  report_id uuid,
  error text,
  duration_ms integer,
  client_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.sos_events TO authenticated;
GRANT ALL ON public.sos_events TO service_role;

ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own sos events"
  ON public.sos_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all sos events"
  ON public.sos_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users view own sos events"
  ON public.sos_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX sos_events_created_at_idx ON public.sos_events (created_at DESC);
CREATE INDEX sos_events_user_id_idx ON public.sos_events (user_id);
CREATE INDEX sos_events_partner_idx ON public.sos_events (partner_user_id);
