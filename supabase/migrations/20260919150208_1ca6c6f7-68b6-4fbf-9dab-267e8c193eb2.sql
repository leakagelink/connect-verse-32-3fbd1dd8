-- Limit the block check so signed-in users can only ask about themselves.
CREATE OR REPLACE FUNCTION public.is_blocked_between(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL AND auth.uid() <> _a AND auth.uid() <> _b
         AND NOT public.has_role(auth.uid(), 'admin'::app_role)
      THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.blocks
       WHERE (blocker_id = _a AND blocked_id = _b)
          OR (blocker_id = _b AND blocked_id = _a)
    )
  END
$$;
REVOKE ALL ON FUNCTION public.is_blocked_between(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_blocked_between(uuid, uuid) TO authenticated, service_role;