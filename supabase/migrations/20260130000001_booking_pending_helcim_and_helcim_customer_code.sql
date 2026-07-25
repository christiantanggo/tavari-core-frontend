-- Booking pending Helcim: store pending checkout session so webhook can complete booking when payment succeeds.
-- Helcim Pay init stores a row with invoice_number = 'BP-' || id; webhook receives that and creates booking.

CREATE TABLE IF NOT EXISTS booking_pending_helcim (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_token TEXT UNIQUE,
  secret_token TEXT,
  invoice_number TEXT NOT NULL UNIQUE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES booking_activities(id) ON DELETE CASCADE,
  session_id UUID REFERENCES booking_sessions(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES pos_loyalty_accounts(id) ON DELETE SET NULL,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  participant_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  amount NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  helcim_transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_pending_helcim_checkout_token ON booking_pending_helcim(checkout_token) WHERE checkout_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_pending_helcim_invoice_number ON booking_pending_helcim(invoice_number);
CREATE INDEX IF NOT EXISTS idx_booking_pending_helcim_status ON booking_pending_helcim(status);

ALTER TABLE booking_pending_helcim ENABLE ROW LEVEL SECURITY;

-- Only service role (edge functions) should read/write; anon checks status via helcim-pay-status edge function.
CREATE POLICY "Service role full access booking_pending_helcim"
  ON booking_pending_helcim FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- pos_loyalty_accounts: store Helcim customer code so returning customers can use saved cards.
ALTER TABLE pos_loyalty_accounts
  ADD COLUMN IF NOT EXISTS helcim_customer_code TEXT;

COMMENT ON TABLE booking_pending_helcim IS 'Pending Helcim Pay checkout sessions for customer portal; webhook completes booking when payment succeeds.';
COMMENT ON COLUMN pos_loyalty_accounts.helcim_customer_code IS 'Helcim customer code for saved payment methods and faster checkout.';
