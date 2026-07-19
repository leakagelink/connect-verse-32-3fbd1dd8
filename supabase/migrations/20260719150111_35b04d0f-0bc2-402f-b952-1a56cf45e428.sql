
CREATE TABLE public.ban_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ban_id uuid REFERENCES public.bans(id) ON DELETE SET NULL,
  report_id uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_notes text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ban_appeals TO authenticated;
GRANT ALL ON public.ban_appeals TO service_role;

ALTER TABLE public.ban_appeals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own appeals"
  ON public.ban_appeals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own appeals"
  ON public.ban_appeals FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all appeals"
  ON public.ban_appeals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update appeals"
  ON public.ban_appeals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX ban_appeals_user_id_idx ON public.ban_appeals (user_id);
CREATE INDEX ban_appeals_status_idx ON public.ban_appeals (status, created_at DESC);

CREATE TRIGGER ban_appeals_set_updated_at
  BEFORE UPDATE ON public.ban_appeals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
