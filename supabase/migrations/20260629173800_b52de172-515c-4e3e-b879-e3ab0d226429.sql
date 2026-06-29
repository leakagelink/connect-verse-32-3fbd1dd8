ALTER TABLE public.notification_prefs
  ADD COLUMN IF NOT EXISTS online_followers boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS online_creators boolean NOT NULL DEFAULT true;