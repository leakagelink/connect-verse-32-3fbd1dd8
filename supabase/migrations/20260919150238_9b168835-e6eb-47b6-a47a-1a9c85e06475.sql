DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.credit_razorpay_payment(text, text, jsonb)',
    'public.pick_calling_credential(text)',
    'public.add_credential_minutes(uuid, integer)',
    'public.report_credential_failure(uuid, text)',
    'public.report_credential_success(uuid)',
    'public.purge_old_call_events()',
    'public.purge_old_perf_events()',
    'public.generate_referral_code()'
  ] LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skip %', fn;
    END;
  END LOOP;
END $$;