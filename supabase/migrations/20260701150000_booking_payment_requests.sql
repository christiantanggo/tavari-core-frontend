-- Staff-initiated payment requests (deposit, full balance, or custom amount).

CREATE TABLE IF NOT EXISTS public.booking_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('deposit', 'full', 'custom')),
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  order_total numeric(10, 2),
  balance_before_request numeric(10, 2),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cancelled', 'paid', 'superseded')),
  sent_at timestamptz,
  sent_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  campaign_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_booking_payment_requests_booking
  ON public.booking_payment_requests (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_payment_requests_business
  ON public.booking_payment_requests (business_id);

CREATE INDEX IF NOT EXISTS idx_booking_payment_requests_pending
  ON public.booking_payment_requests (booking_id)
  WHERE status = 'pending';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_request_sent_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS active_payment_request_id uuid REFERENCES public.booking_payment_requests(id) ON DELETE SET NULL;

COMMENT ON TABLE public.booking_payment_requests IS 'Outbound payment request emails to customers; tracks amount, type, sender, and lifecycle.';
COMMENT ON COLUMN public.bookings.payment_request_sent_by IS 'Staff user who last sent a payment request email.';
COMMENT ON COLUMN public.bookings.active_payment_request_id IS 'Current pending payment request awaiting customer payment.';

ALTER TABLE public.booking_payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_payment_requests_select" ON public.booking_payment_requests;
DROP POLICY IF EXISTS "booking_payment_requests_insert" ON public.booking_payment_requests;
DROP POLICY IF EXISTS "booking_payment_requests_update" ON public.booking_payment_requests;

CREATE POLICY "booking_payment_requests_select"
  ON public.booking_payment_requests
  FOR SELECT
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE POLICY "booking_payment_requests_insert"
  ON public.booking_payment_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "booking_payment_requests_update"
  ON public.booking_payment_requests
  FOR UPDATE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id))
  WITH CHECK (public.is_digital_signage_business_member(business_id));
