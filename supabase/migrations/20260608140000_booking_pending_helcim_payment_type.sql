-- Track full order total vs deposit charged at online checkout.

ALTER TABLE public.booking_pending_helcim
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS order_total numeric(10, 2);

COMMENT ON COLUMN public.booking_pending_helcim.payment_type IS 'full | deposit — how this checkout amount relates to order_total.';
COMMENT ON COLUMN public.booking_pending_helcim.order_total IS 'Full booking total (incl. tax) when payment_type is deposit.';
