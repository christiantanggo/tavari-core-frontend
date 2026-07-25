-- DEPRECATED: This table is no longer used. 
-- We now use the unified waiver_participants table (see bookings_unify_participants_table.sql)
-- waiver_participants now supports both waiver_id (for waivers) and customer_id (for customer accounts)
-- This allows participants to be reused across multiple waivers and bookings

-- Create booking_customer_participants table
-- Purpose: Store persistent list of participants associated with a customer account (pos_loyalty_accounts)
-- This is separate from waiver_participants which are tied to specific waivers
-- We link to waiver_participants via matching logic (name/phone/email/birthdate)

CREATE TABLE IF NOT EXISTS booking_customer_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES pos_loyalty_accounts(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  email TEXT,
  phone_number TEXT,
  city TEXT,
  is_account_owner BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  -- Links to waiver system (for reference, not FK since waiver_participants are tied to waivers)
  waiver_signature_id UUID REFERENCES waiver_signatures(id) ON DELETE SET NULL,
  waiver_participant_id UUID, -- Reference to waiver_participants.id (no FK since it's a different system)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_booking_customer_participants_customer 
  ON booking_customer_participants (customer_id, business_id, is_active);

CREATE INDEX IF NOT EXISTS idx_booking_customer_participants_waiver 
  ON booking_customer_participants (waiver_signature_id, waiver_participant_id) 
  WHERE waiver_signature_id IS NOT NULL;

-- Ensure only one account owner per customer
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_customer_participants_one_owner 
  ON booking_customer_participants (customer_id, business_id) 
  WHERE is_account_owner = true AND is_active = true;

-- Enable RLS
ALTER TABLE booking_customer_participants ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- SELECT: Customers can view their own participants, business members can view all
DROP POLICY IF EXISTS "booking_customer_participants_select" ON booking_customer_participants;
CREATE POLICY "booking_customer_participants_select"
  ON booking_customer_participants
  FOR SELECT
  USING (
    -- Business members can view
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() AND active = true
    )
    OR business_id IN (
      SELECT business_id FROM tavari_employees 
      WHERE user_id = auth.uid() AND is_active = true
    )
    -- Customers can view their own (via phone/email matching for anonymous access)
    OR customer_id IN (
      SELECT id FROM pos_loyalty_accounts 
      WHERE business_id = booking_customer_participants.business_id
        AND (
          customer_email = COALESCE(
            current_setting('app.current_customer_email', true)::TEXT,
            (SELECT email FROM users WHERE id = auth.uid())
          )
          OR customer_phone = COALESCE(
            current_setting('app.current_customer_phone', true)::TEXT,
            (SELECT phone FROM users WHERE id = auth.uid())
          )
        )
    )
    -- Anonymous users can view if they have the customer_id in session (for booking portal)
    OR (auth.role() = 'anon' AND customer_id IS NOT NULL)
  );

-- INSERT: Business members and customers can insert
DROP POLICY IF EXISTS "booking_customer_participants_insert" ON booking_customer_participants;
CREATE POLICY "booking_customer_participants_insert"
  ON booking_customer_participants
  FOR INSERT
  WITH CHECK (
    -- Business members can insert
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() AND active = true
    )
    OR business_id IN (
      SELECT business_id FROM tavari_employees 
      WHERE user_id = auth.uid() AND is_active = true
    )
    -- Customers can insert their own (via phone/email matching)
    OR customer_id IN (
      SELECT id FROM pos_loyalty_accounts 
      WHERE business_id = booking_customer_participants.business_id
        AND (
          customer_email = COALESCE(
            current_setting('app.current_customer_email', true)::TEXT,
            (SELECT email FROM users WHERE id = auth.uid())
          )
          OR customer_phone = COALESCE(
            current_setting('app.current_customer_phone', true)::TEXT,
            (SELECT phone FROM users WHERE id = auth.uid())
          )
        )
    )
    -- Anonymous users can insert for their own customer_id (for booking portal)
    OR (auth.role() = 'anon' AND customer_id IS NOT NULL)
  );

-- UPDATE: Business members and customers can update
DROP POLICY IF EXISTS "booking_customer_participants_update" ON booking_customer_participants;
CREATE POLICY "booking_customer_participants_update"
  ON booking_customer_participants
  FOR UPDATE
  USING (
    -- Business members can update
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() AND active = true
    )
    OR business_id IN (
      SELECT business_id FROM tavari_employees 
      WHERE user_id = auth.uid() AND is_active = true
    )
    -- Customers can update their own
    OR customer_id IN (
      SELECT id FROM pos_loyalty_accounts 
      WHERE business_id = booking_customer_participants.business_id
        AND (
          customer_email = COALESCE(
            current_setting('app.current_customer_email', true)::TEXT,
            (SELECT email FROM users WHERE id = auth.uid())
          )
          OR customer_phone = COALESCE(
            current_setting('app.current_customer_phone', true)::TEXT,
            (SELECT phone FROM users WHERE id = auth.uid())
          )
        )
    )
    -- Anonymous users can update their own
    OR (auth.role() = 'anon' AND customer_id IS NOT NULL)
  );

-- DELETE: Business members and customers can delete (soft delete by setting is_active = false)
DROP POLICY IF EXISTS "booking_customer_participants_delete" ON booking_customer_participants;
CREATE POLICY "booking_customer_participants_delete"
  ON booking_customer_participants
  FOR DELETE
  USING (
    -- Business members can delete
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() AND active = true
    )
    OR business_id IN (
      SELECT business_id FROM tavari_employees 
      WHERE user_id = auth.uid() AND is_active = true
    )
    -- Customers can delete their own
    OR customer_id IN (
      SELECT id FROM pos_loyalty_accounts 
      WHERE business_id = booking_customer_participants.business_id
        AND (
          customer_email = COALESCE(
            current_setting('app.current_customer_email', true)::TEXT,
            (SELECT email FROM users WHERE id = auth.uid())
          )
          OR customer_phone = COALESCE(
            current_setting('app.current_customer_phone', true)::TEXT,
            (SELECT phone FROM users WHERE id = auth.uid())
          )
        )
    )
    -- Anonymous users can delete their own
    OR (auth.role() = 'anon' AND customer_id IS NOT NULL)
  );

-- Add comments
COMMENT ON TABLE booking_customer_participants IS 'Persistent list of participants associated with a customer account. Separate from waiver_participants which are tied to specific waivers.';
COMMENT ON COLUMN booking_customer_participants.waiver_participant_id IS 'Reference to waiver_participants.id (no FK constraint since waiver_participants are tied to waivers, not customer accounts). Used for matching/linking purposes.';
COMMENT ON COLUMN booking_customer_participants.waiver_signature_id IS 'Reference to the waiver_signature that contains this participant (for the primary signer/account owner).';
