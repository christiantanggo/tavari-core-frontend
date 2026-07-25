-- Booking approval workflow: hold spot on request, pay deposit after staff approval.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS order_total numeric(10, 2),
  ADD COLUMN IF NOT EXISTS tax_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS deposit_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_request_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.order_total IS 'Full booking total incl. tax captured at checkout/request time.';
COMMENT ON COLUMN public.bookings.tax_amount IS 'Tax portion of order_total at checkout/request time.';
COMMENT ON COLUMN public.bookings.deposit_due_at IS 'When the customer must pay their deposit after staff approval.';
COMMENT ON COLUMN public.bookings.payment_request_sent_at IS 'When the automated deposit payment request email was sent.';

CREATE INDEX IF NOT EXISTS idx_bookings_approval_queue
  ON public.bookings (business_id, requires_approval, approved_at)
  WHERE requires_approval = true AND approved_at IS NULL AND status = 'pending';
