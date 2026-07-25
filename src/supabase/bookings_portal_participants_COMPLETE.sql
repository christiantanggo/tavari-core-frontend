-- CUSTOMER PORTAL PARTICIPANTS: Run this once in Supabase SQL Editor.
-- Adds columns, creates RPCs (get/add/upsert), and lets anon read participants.

-- STEP 1: Ensure waiver_participants has columns for customer-scoped participants
ALTER TABLE waiver_participants ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES pos_loyalty_accounts(id) ON DELETE CASCADE;
ALTER TABLE waiver_participants ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE waiver_participants ADD COLUMN IF NOT EXISTS is_account_owner BOOLEAN DEFAULT false;
ALTER TABLE waiver_participants ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE waiver_participants ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE waiver_participants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Make waiver_id nullable so participants can exist without a waiver
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'waiver_participants' AND column_name = 'waiver_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE waiver_participants ALTER COLUMN waiver_id DROP NOT NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Indexes for customer lookup
CREATE INDEX IF NOT EXISTS idx_waiver_participants_customer_business
  ON waiver_participants (customer_id, business_id) WHERE customer_id IS NOT NULL;

-- STEP 2: RPC – Get participants for customer portal (bypasses RLS)
CREATE OR REPLACE FUNCTION public.bookings_get_portal_participants(p_customer_id UUID, p_business_id UUID)
RETURNS SETOF waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pos_loyalty_accounts WHERE id = p_customer_id AND business_id = p_business_id) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;
  RETURN QUERY
  SELECT *
  FROM waiver_participants
  WHERE customer_id = p_customer_id AND business_id = p_business_id
    AND (is_active IS NULL OR is_active = true)
  ORDER BY is_account_owner DESC NULLS LAST, created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_get_portal_participants(UUID, UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.bookings_get_portal_participants(UUID, UUID) TO authenticated;

-- STEP 3: RPC – Add participant from customer portal
CREATE OR REPLACE FUNCTION public.bookings_add_portal_participant(
  p_customer_id UUID, p_business_id UUID, p_first_name TEXT, p_last_name TEXT,
  p_date_of_birth DATE DEFAULT NULL, p_participant_type TEXT DEFAULT 'additional_adult'
)
RETURNS SETOF waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pos_loyalty_accounts WHERE id = p_customer_id AND business_id = p_business_id) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;
  RETURN QUERY
  INSERT INTO waiver_participants (customer_id, business_id, participant_type, first_name, last_name, date_of_birth, is_active, is_account_owner, waiver_id)
  VALUES (p_customer_id, p_business_id, COALESCE(NULLIF(TRIM(p_participant_type), ''), 'additional_adult'), p_first_name, p_last_name, p_date_of_birth, true, false, NULL)
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_add_portal_participant(UUID, UUID, TEXT, TEXT, DATE, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.bookings_add_portal_participant(UUID, UUID, TEXT, TEXT, DATE, TEXT) TO authenticated;

-- STEP 4: RPC – Upsert Participant 1 (account owner) name/birthdate
CREATE OR REPLACE FUNCTION public.bookings_upsert_portal_participant_owner(
  p_customer_id UUID, p_business_id UUID, p_first_name TEXT, p_last_name TEXT, p_date_of_birth DATE DEFAULT NULL
)
RETURNS SETOF waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row waiver_participants;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pos_loyalty_accounts WHERE id = p_customer_id AND business_id = p_business_id) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;
  UPDATE waiver_participants
  SET first_name = p_first_name, last_name = p_last_name, date_of_birth = p_date_of_birth
  WHERE customer_id = p_customer_id AND business_id = p_business_id AND is_account_owner = true AND (is_active IS NULL OR is_active = true)
  RETURNING * INTO v_row;
  IF FOUND THEN
    RETURN NEXT v_row;
    RETURN;
  END IF;
  RETURN QUERY
  INSERT INTO waiver_participants (customer_id, business_id, participant_type, first_name, last_name, date_of_birth, is_active, is_account_owner, waiver_id)
  VALUES (p_customer_id, p_business_id, 'primary', p_first_name, p_last_name, p_date_of_birth, true, true, NULL)
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_upsert_portal_participant_owner(UUID, UUID, TEXT, TEXT, DATE) TO anon;
GRANT EXECUTE ON FUNCTION public.bookings_upsert_portal_participant_owner(UUID, UUID, TEXT, TEXT, DATE) TO authenticated;

-- STEP 5: Let anon read participants (for direct table fallback). App filters by customer_id/business_id.
DROP POLICY IF EXISTS "waiver_participants_select_anon_portal" ON waiver_participants;
CREATE POLICY "waiver_participants_select_anon_portal"
  ON waiver_participants FOR SELECT TO anon
  USING (customer_id IS NOT NULL AND business_id IS NOT NULL);

-- STEP 6: Let anon read from booking_customer_participants (portal stores Participant 1 here on account creation)
-- Only run if table exists (legacy table)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'booking_customer_participants') THEN
    DROP POLICY IF EXISTS "booking_customer_participants_select_anon_portal" ON booking_customer_participants;
    CREATE POLICY "booking_customer_participants_select_anon_portal"
      ON booking_customer_participants FOR SELECT TO anon
      USING (customer_id IS NOT NULL AND business_id IS NOT NULL);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- STEP 7: RPC - Update any portal participant by id (for edit in portal)
CREATE OR REPLACE FUNCTION public.bookings_update_portal_participant(
  p_customer_id UUID, p_business_id UUID, p_participant_id UUID,
  p_first_name TEXT, p_last_name TEXT, p_date_of_birth DATE DEFAULT NULL
)
RETURNS SETOF waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pos_loyalty_accounts WHERE id = p_customer_id AND business_id = p_business_id) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;
  RETURN QUERY
  UPDATE waiver_participants
  SET first_name = p_first_name, last_name = p_last_name, date_of_birth = p_date_of_birth, updated_at = now()
  WHERE id = p_participant_id AND customer_id = p_customer_id AND business_id = p_business_id
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_update_portal_participant(UUID, UUID, UUID, TEXT, TEXT, DATE) TO anon;
GRANT EXECUTE ON FUNCTION public.bookings_update_portal_participant(UUID, UUID, UUID, TEXT, TEXT, DATE) TO authenticated;

-- STEP 8: RPC - Soft-delete portal participant (sets is_active = false)
CREATE OR REPLACE FUNCTION public.bookings_delete_portal_participant(
  p_customer_id UUID, p_business_id UUID, p_participant_id UUID
)
RETURNS SETOF waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pos_loyalty_accounts WHERE id = p_customer_id AND business_id = p_business_id) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;
  RETURN QUERY
  UPDATE waiver_participants
  SET is_active = false, updated_at = now()
  WHERE id = p_participant_id AND customer_id = p_customer_id AND business_id = p_business_id
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_delete_portal_participant(UUID, UUID, UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.bookings_delete_portal_participant(UUID, UUID, UUID) TO authenticated;

-- Done. Run this file once in Supabase SQL Editor. Portal should now load, save, edit and delete participants.
