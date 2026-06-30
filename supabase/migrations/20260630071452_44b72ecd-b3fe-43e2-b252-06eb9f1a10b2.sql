
REVOKE EXECUTE ON FUNCTION public.purge_old_call_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_call_events() TO service_role;
