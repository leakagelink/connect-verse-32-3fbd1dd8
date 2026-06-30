ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}'::text[];
CREATE INDEX IF NOT EXISTS profiles_languages_gin_idx ON public.profiles USING GIN (languages);