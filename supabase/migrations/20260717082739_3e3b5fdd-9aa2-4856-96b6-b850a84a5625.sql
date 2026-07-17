ALTER TABLE public.razorpay_orders ADD COLUMN IF NOT EXISTS client_purchase_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS razorpay_orders_user_purchase_uidx
  ON public.razorpay_orders (user_id, client_purchase_id)
  WHERE client_purchase_id IS NOT NULL;