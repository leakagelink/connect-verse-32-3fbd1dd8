
CREATE OR REPLACE FUNCTION public.follows_notify_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_name text;
  prefs_allow boolean;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  -- Honour recipient notification prefs (default ON if no row).
  SELECT COALESCE(np.follows, true) INTO prefs_allow
    FROM public.notification_prefs np
   WHERE np.user_id = NEW.following_id;
  IF prefs_allow IS NULL THEN prefs_allow := true; END IF;
  IF NOT prefs_allow THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(username, 'Someone') INTO sender_name
    FROM public.profiles WHERE id = NEW.follower_id;

  INSERT INTO public.app_notifications (user_id, kind, title, body, deep_link)
  VALUES (
    NEW.following_id,
    'follows',
    'New friend request',
    sender_name || ' wants to connect with you on Talkora.',
    '/requests'
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'follows_notify_recipient failed: % %', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS follows_notify_recipient_trg ON public.follows;
CREATE TRIGGER follows_notify_recipient_trg
AFTER INSERT ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.follows_notify_recipient();

-- Backfill: pending follow rows that never produced a bell notification.
INSERT INTO public.app_notifications (user_id, kind, title, body, deep_link)
SELECT
  f.following_id,
  'follows',
  'New friend request',
  COALESCE(p.username, 'Someone') || ' wants to connect with you on Talkora.',
  '/requests'
FROM public.follows f
LEFT JOIN public.profiles p ON p.id = f.follower_id
WHERE f.status = 'pending'
  AND f.expires_at > now()
  AND NOT EXISTS (
    SELECT 1 FROM public.app_notifications n
     WHERE n.user_id = f.following_id
       AND n.kind = 'follows'
       AND n.created_at >= f.created_at
  );
