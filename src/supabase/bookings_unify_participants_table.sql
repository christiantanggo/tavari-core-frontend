-- Unify participants: Extend waiver_participants to also support customer accounts
-- This makes waiver_participants the single source of truth for all participants
-- Participants can be tied to both a waiver (waiver_id) AND a customer account (customer_id)
-- This allows participants to be reused across multiple waivers and bookings

-- Add customer_id and business_id to waiver_participants (make waiver_id optional)
ALTER TABLE waiver_participants 
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES pos_loyalty_accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_account_owner BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Make waiver_id optional (participants can exist without being tied to a specific waiver)
-- This allows participants to be created for bookings without requiring a waiver first
DO $$ 
BEGIN
  -- Check if waiver_id has NOT NULL constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'waiver_participants' 
    AND column_name = 'waiver_id' 
    AND is_nullable = 'NO'
  ) THEN
    -- Drop the NOT NULL constraint
    ALTER TABLE waiver_participants ALTER COLUMN waiver_id DROP NOT NULL;
  END IF;
END $$;

-- Create indexes for customer lookup
CREATE INDEX IF NOT EXISTS idx_waiver_participants_customer 
  ON waiver_participants (customer_id, business_id, is_active) 
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_waiver_participants_customer_owner 
  ON waiver_participants (customer_id, business_id, is_account_owner) 
  WHERE customer_id IS NOT NULL AND is_account_owner = true;

-- Ensure only one account owner per customer
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiver_participants_one_owner 
  ON waiver_participants (customer_id, business_id) 
  WHERE customer_id IS NOT NULL AND is_account_owner = true AND is_active = true;

-- Update comment
COMMENT ON TABLE waiver_participants IS 'Unified participants table for both waivers and bookings. Participants can be tied to a waiver (waiver_id) and/or a customer account (customer_id).';
COMMENT ON COLUMN waiver_participants.customer_id IS 'Links participant to a customer account (pos_loyalty_accounts). Allows participants to be reused across multiple waivers and bookings.';
COMMENT ON COLUMN waiver_participants.business_id IS 'Business ID for the participant (required when customer_id is set).';
COMMENT ON COLUMN waiver_participants.is_account_owner IS 'True if this participant is the account owner (customer account owner). Only one per customer account.';
COMMENT ON COLUMN waiver_participants.is_active IS 'Soft delete flag. Set to false to deactivate a participant.';

-- Update RLS policies to support customer-based access
-- Add policy for customer-based SELECT
DROP POLICY IF EXISTS "waiver_participants_select_customer" ON waiver_participants;
CREATE POLICY "waiver_participants_select_customer"
  ON waiver_participants
  FOR SELECT
  USING (
    -- Existing waiver-based access (keep existing logic)
    waiver_id IN (
      SELECT id FROM waiver_signatures
      WHERE (
        business_id IN (
          SELECT business_id FROM user_roles 
          WHERE user_id = auth.uid() AND active = true
        )
        OR business_id IN (
          SELECT business_id FROM tavari_employees 
          WHERE user_id = auth.uid() AND is_active = true
        )
        OR customer_id IN (
          SELECT id FROM pos_loyalty_accounts 
          WHERE id = waiver_signatures.customer_id
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
        OR signature_token IS NOT NULL
      )
    )
    -- NEW: Customer-based access (for booking portal)
    OR (
      customer_id IS NOT NULL
      AND customer_id IN (
        SELECT id FROM pos_loyalty_accounts 
        WHERE business_id = waiver_participants.business_id
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
    )
    -- Anonymous users can view if they have the customer_id in session (for booking portal)
    OR (auth.role() = 'anon' AND customer_id IS NOT NULL)
  );

-- Add policy for customer-based INSERT
DROP POLICY IF EXISTS "waiver_participants_insert_customer" ON waiver_participants;
CREATE POLICY "waiver_participants_insert_customer"
  ON waiver_participants
  FOR INSERT
  WITH CHECK (
    -- Existing waiver-based insert (keep existing logic)
    waiver_id IN (
      SELECT id FROM waiver_signatures
      WHERE (
        business_id IN (
          SELECT business_id FROM user_roles 
          WHERE user_id = auth.uid() AND active = true
        )
        OR business_id IN (
          SELECT business_id FROM tavari_employees 
          WHERE user_id = auth.uid() AND is_active = true
        )
        OR customer_id IN (
          SELECT id FROM pos_loyalty_accounts 
          WHERE id = waiver_signatures.customer_id
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
        OR signature_token IS NOT NULL
      )
    )
    -- NEW: Customer-based insert (for booking portal)
    OR (
      customer_id IS NOT NULL
      AND customer_id IN (
        SELECT id FROM pos_loyalty_accounts 
        WHERE business_id = waiver_participants.business_id
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
    )
    -- Anonymous users can insert for their own customer_id (for booking portal)
    OR (auth.role() = 'anon' AND customer_id IS NOT NULL)
  );

-- Add policy for customer-based UPDATE
DROP POLICY IF EXISTS "waiver_participants_update_customer" ON waiver_participants;
CREATE POLICY "waiver_participants_update_customer"
  ON waiver_participants
  FOR UPDATE
  USING (
    -- Existing waiver-based update (keep existing logic)
    waiver_id IN (
      SELECT id FROM waiver_signatures
      WHERE (
        business_id IN (
          SELECT business_id FROM user_roles 
          WHERE user_id = auth.uid() AND active = true
        )
        OR business_id IN (
          SELECT business_id FROM tavari_employees 
          WHERE user_id = auth.uid() AND is_active = true
        )
        OR customer_id IN (
          SELECT id FROM pos_loyalty_accounts 
          WHERE id = waiver_signatures.customer_id
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
      )
    )
    -- NEW: Customer-based update (for booking portal)
    OR (
      customer_id IS NOT NULL
      AND customer_id IN (
        SELECT id FROM pos_loyalty_accounts 
        WHERE business_id = waiver_participants.business_id
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
    )
    -- Anonymous users can update their own
    OR (auth.role() = 'anon' AND customer_id IS NOT NULL)
  );

-- Note: We keep the existing waiver_participants policies for backward compatibility
-- The new customer-based policies are additive (OR conditions)
