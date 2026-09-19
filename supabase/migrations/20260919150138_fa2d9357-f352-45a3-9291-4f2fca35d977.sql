-- ============================================================
-- Play Billing + coin/creator hardening
-- ============================================================

-- 1) Coin plans get a Google Play product id
ALTER TABLE public.coin_plans ADD COLUMN IF NOT EXISTS play_product_id text;
CREATE UNIQUE INDEX IF NOT EXISTS coin_plans_play_product_id_key
  ON public.coin_plans(play_product_id) WHERE play_product_id IS NOT NULL;

-- 2) Play purchase ledger (idempotent on purchase token)
CREATE TABLE IF NOT EXISTS public.play_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  purchase_token text NOT NULL UNIQUE,
  order_id text,
  plan_id uuid REFERENCES public.coin_plans(id),
  coins bigint NOT NULL DEFAULT 0,
  bonus_coins bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  purchase_state integer,
  acknowledged boolean NOT NULL DEFAULT false,
  purchase_time timestamptz,
  platform text NOT NULL DEFAULT 'android',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.play_purchases TO authenticated;
GRANT ALL ON public.play_purchases TO service_role;

ALTER TABLE public.play_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own play purchases" ON public.play_purchases;
CREATE POLICY "Users read own play purchases"
  ON public.play_purchases FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins read play purchases" ON public.play_purchases;
CREATE POLICY "Admins read play purchases"
  ON public.play_purchases FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS play_purchases_set_updated_at ON public.play_purchases;
CREATE TRIGGER play_purchases_set_updated_at
  BEFORE UPDATE ON public.play_purchases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS play_purchases_user_idx ON public.play_purchases(user_id, created_at DESC);

-- 3) Atomic, idempotent credit of a verified Play purchase
CREATE OR REPLACE FUNCTION public.credit_play_purchase(
  _user_id uuid,
  _purchase_token text,
  _product_id text,
  _order_id text,
  _purchase_time timestamptz,
  _acknowledged boolean,
  _payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pl RECORD;
  w RECORD;
  p RECORD;
  bonus_pct NUMERIC;
  bonus_coins BIGINT;
  new_balance BIGINT;
  new_count INT;
BEGIN
  SELECT id, coins, price_inr, label INTO pl
    FROM public.coin_plans
   WHERE play_product_id = _product_id AND is_active = true;
  IF pl.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_product');
  END IF;

  -- Claim the token. The unique constraint makes this the single point of truth.
  INSERT INTO public.play_purchases (
    user_id, product_id, purchase_token, order_id, plan_id,
    status, purchase_time, acknowledged, raw
  ) VALUES (
    _user_id, _product_id, _purchase_token, _order_id, pl.id,
    'pending', _purchase_time, COALESCE(_acknowledged, false), COALESCE(_payload, '{}'::jsonb)
  )
  ON CONFLICT (purchase_token) DO NOTHING;

  SELECT * INTO p FROM public.play_purchases
   WHERE purchase_token = _purchase_token FOR UPDATE;

  IF p.user_id <> _user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token_owned_by_other_user');
  END IF;

  IF p.status = 'credited' THEN
    RETURN jsonb_build_object('ok', true, 'already', true,
      'coins', p.coins, 'bonus', p.bonus_coins);
  END IF;

  IF p.status = 'revoked' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'revoked');
  END IF;

  SELECT * INTO w FROM public.wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, coin_balance) VALUES (_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO w FROM public.wallets WHERE user_id = _user_id FOR UPDATE;
  END IF;

  bonus_pct := CASE w.deposit_count WHEN 0 THEN 0.50 WHEN 1 THEN 0.40 WHEN 2 THEN 0.30 ELSE 0 END;
  bonus_coins := FLOOR(pl.coins * bonus_pct);
  new_balance := w.coin_balance + pl.coins + bonus_coins;
  new_count := w.deposit_count + 1;

  UPDATE public.wallets
     SET coin_balance = new_balance,
         total_recharged_inr = w.total_recharged_inr + COALESCE(pl.price_inr, 0),
         deposit_count = new_count,
         updated_at = now()
   WHERE user_id = _user_id;

  UPDATE public.play_purchases
     SET status = 'credited',
         coins = pl.coins,
         bonus_coins = bonus_coins,
         acknowledged = COALESCE(_acknowledged, acknowledged),
         raw = COALESCE(_payload, raw),
         processed_at = now()
   WHERE id = p.id;

  INSERT INTO public.transactions(user_id, type, coins_delta, inr_amount, plan_id, metadata)
  VALUES (_user_id, 'recharge', pl.coins, COALESCE(pl.price_inr, 0), pl.id,
          jsonb_build_object('platform', 'google_play', 'product_id', _product_id,
                             'purchase_token_tail', right(_purchase_token, 8)));

  IF bonus_coins > 0 THEN
    INSERT INTO public.transactions(user_id, type, coins_delta, inr_amount, plan_id, metadata)
    VALUES (_user_id, 'bonus', bonus_coins, 0, pl.id,
            jsonb_build_object('platform', 'google_play', 'bonus_pct', bonus_pct,
                               'deposit_no', new_count));
  END IF;

  RETURN jsonb_build_object('ok', true, 'coins', pl.coins, 'bonus', bonus_coins, 'balance', new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.credit_play_purchase(uuid, text, text, text, timestamptz, boolean, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_play_purchase(uuid, text, text, text, timestamptz, boolean, jsonb) TO service_role;

-- 4) Refund / revocation handling
CREATE OR REPLACE FUNCTION public.revoke_play_purchase(_purchase_token text, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  w RECORD;
  take BIGINT;
BEGIN
  SELECT * INTO p FROM public.play_purchases WHERE purchase_token = _purchase_token FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF p.status = 'revoked' THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  IF p.status = 'credited' THEN
    SELECT * INTO w FROM public.wallets WHERE user_id = p.user_id FOR UPDATE;
    take := LEAST(COALESCE(w.coin_balance, 0), p.coins + p.bonus_coins);
    UPDATE public.wallets
       SET coin_balance = COALESCE(w.coin_balance, 0) - take,
           updated_at = now()
     WHERE user_id = p.user_id;
    INSERT INTO public.transactions(user_id, type, coins_delta, inr_amount, plan_id, metadata)
    VALUES (p.user_id, 'refund', -take, 0, p.plan_id,
            jsonb_build_object('platform', 'google_play', 'reason', COALESCE(_reason, 'revoked'),
                               'product_id', p.product_id));
  END IF;

  UPDATE public.play_purchases
     SET status = 'revoked', processed_at = now()
   WHERE id = p.id;

  RETURN jsonb_build_object('ok', true, 'reclaimed', COALESCE(take, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_play_purchase(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_play_purchase(text, text) TO service_role;

-- 5) Creator lifecycle states, separated from is_creator
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS creator_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS creator_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.profiles_validate_creator_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.creator_status NOT IN ('none','pending','approved','rejected','suspended') THEN
    RAISE EXCEPTION 'Invalid creator_status: %', NEW.creator_status;
  END IF;
  IF NEW.creator_status <> 'approved' THEN
    NEW.creator_verified := false;
  END IF;
  IF NEW.creator_status IN ('suspended','rejected','none') THEN
    NEW.payout_enabled := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_validate_creator_status_trg ON public.profiles;
CREATE TRIGGER profiles_validate_creator_status_trg
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_validate_creator_status();

-- Backfill: existing creators become approved+verified only if KYC approved
UPDATE public.profiles p
   SET creator_status = 'approved', creator_verified = true, payout_enabled = true
 WHERE p.is_creator = true
   AND EXISTS (SELECT 1 FROM public.kyc_requests k WHERE k.user_id = p.id AND k.status = 'approved');

UPDATE public.profiles p
   SET creator_status = 'pending'
 WHERE p.is_creator = true AND p.creator_status = 'none';

-- Users may not self-award creator state
CREATE OR REPLACE FUNCTION public.profiles_block_sensitive_self_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.is_creator IS DISTINCT FROM OLD.is_creator
     OR NEW.creator_status IS DISTINCT FROM OLD.creator_status
     OR NEW.creator_verified IS DISTINCT FROM OLD.creator_verified
     OR NEW.payout_enabled IS DISTINCT FROM OLD.payout_enabled
     OR NEW.is_banned IS DISTINCT FROM OLD.is_banned
     OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason
     OR NEW.strike_count IS DISTINCT FROM OLD.strike_count
     OR NEW.referred_by IS DISTINCT FROM OLD.referred_by
     OR NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
    RAISE EXCEPTION 'Sensitive profile columns cannot be modified by the user';
  END IF;

  RETURN NEW;
END;
$$;

-- 6) Mutual block check usable from RLS and server code
CREATE OR REPLACE FUNCTION public.is_blocked_between(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
     WHERE (blocker_id = _a AND blocked_id = _b)
        OR (blocker_id = _b AND blocked_id = _a)
  )
$$;
GRANT EXECUTE ON FUNCTION public.is_blocked_between(uuid, uuid) TO authenticated, service_role;

-- Block-aware write policies (defence in depth alongside server checks)
DROP POLICY IF EXISTS "Blocked users cannot request follow" ON public.follows;
CREATE POLICY "Blocked users cannot request follow"
  ON public.follows FOR INSERT TO authenticated
  WITH CHECK (
    follower_id = auth.uid()
    AND NOT public.is_blocked_between(auth.uid(), following_id)
  );

-- 7) Server-authoritative rate configuration
INSERT INTO public.app_settings (key, value) VALUES
  ('coin_rates', jsonb_build_object(
     'chat_per_minute', 2,
     'voice_per_minute', 8,
     'video_per_minute', 16,
     'message_cost_male', 1,
     'creator_share_pct', 50
  )),
  ('payments_provider', '"google_play"'::jsonb)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "Public settings readable by authed" ON public.app_settings;
CREATE POLICY "Public settings readable by authed"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (key IN ('connect_filters_visible', 'coin_rates', 'payments_provider'));