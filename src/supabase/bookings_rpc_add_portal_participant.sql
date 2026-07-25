-- ============================================
-- RPC: Add participant from customer portal (bypasses RLS)
-- ============================================
-- Customer portal (anon) hits RLS on waiver_participants INSERT.
-- This SECURITY DEFINER function inserts the row as the function owner, so RLS is bypassed.
-- Input is validated: (customer_id, business_id) must exist in pos_loyalty_accounts.
--
-- Run this in Supabase SQL Editor once. Then the app calls this RPC instead of direct insert.
-- ============================================

CREATE OR REPLACE FUNCTION public.bookings_add_portal_participant(
  p_customer_id UUID,
  p_business_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_date_of_birth DATE DEFAULT NULL,
  p_participant_type TEXT DEFAULT 'additional_adult'
)
RETURNS SETOF waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow if this customer belongs to this business (prevents spoofing customer_id)
  IF NOT EXISTS (
    SELECT 1 FROM pos_loyalty_accounts
    WHERE id = p_customer_id AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;

  RETURN QUERY
  INSERT INTO waiver_participants (
    customer_id,
    business_id,
    participant_type,
    first_name,
    last_name,
    date_of_birth,
    is_active,
    is_account_owner,
    waiver_id
  ) VALUES (
    p_customer_id,
    p_business_id,
    COALESCE(NULLIF(TRIM(p_participant_type), ''), 'additional_adult'),
    p_first_name,
    p_last_name,
    p_date_of_birth,
    true,
    false,
    NULL
  )
  RETURNING *;
END;
$$;

COMMENT ON FUNCTION public.bookings_add_portal_participant IS
  'Customer portal: add a participant for a customer. Bypasses RLS; validates (customer_id, business_id) in pos_loyalty_accounts.';

-- Grant execute to anon and authenticated (portal uses anon)
GRANT EXECUTE ON FUNCTION public.bookings_add_portal_participant TO anon;
GRANT EXECUTE ON FUNCTION public.bookings_add_portal_participant TO authenticated;

-- ============================================
-- RPC: Get participants for customer portal (bypasses RLS)
-- ============================================
-- Anon may not have SELECT on waiver_participants. This RPC returns all participants
-- for the customer/business so saved participants (Participant 1 + additional) persist on next login.
-- ============================================

CREATE OR REPLACE FUNCTION public.bookings_get_portal_participants(
  p_customer_id UUID,
  p_business_id UUID
)
RETURNS SETOF waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow if this customer belongs to this business
  IF NOT EXISTS (
    SELECT 1 FROM pos_loyalty_accounts
    WHERE id = p_customer_id AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;

  RETURN QUERY
  SELECT *
  FROM waiver_participants
  WHERE customer_id = p_customer_id
    AND business_id = p_business_id
    AND is_active = true
  ORDER BY is_account_owner DESC NULLS LAST, created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.bookings_get_portal_participants IS
  'Customer portal: load all participants for a customer. Bypasses RLS so anon can see saved participants.';

GRANT EXECUTE ON FUNCTION public.bookings_get_portal_participants TO anon;
GRANT EXECUTE ON FUNCTION public.bookings_get_portal_participants TO authenticated;

-- ============================================
-- RPC: Upsert Participant 1 (account owner) – edit name & birthdate from portal
-- ============================================
-- Run this in Supabase SQL Editor once. Then the app can update Participant 1 when user taps the card.
-- ============================================

CREATE OR REPLACE FUNCTION public.bookings_upsert_portal_participant_owner(
  p_customer_id UUID,
  p_business_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_date_of_birth DATE DEFAULT NULL
)
RETURNS SETOF waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row waiver_participants;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pos_loyalty_accounts
    WHERE id = p_customer_id AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;

  -- Update existing account-owner row if present (omit updated_at if column missing)
  UPDATE waiver_participants
  SET first_name = p_first_name,
      last_name = p_last_name,
      date_of_birth = p_date_of_birth
  WHERE customer_id = p_customer_id
    AND business_id = p_business_id
    AND is_account_owner = true
    AND is_active = true
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN NEXT v_row;
    RETURN;
  END IF;

  -- No row: insert account-owner participant
  RETURN QUERY
  INSERT INTO waiver_participants (
    customer_id,
    business_id,
    participant_type,
    first_name,
    last_name,
    date_of_birth,
    is_active,
    is_account_owner,
    waiver_id
  ) VALUES (
    p_customer_id,
    p_business_id,
    'primary',
    p_first_name,
    p_last_name,
    p_date_of_birth,
    true,
    true,
    NULL
  )
  RETURNING *;
END;
$$;

COMMENT ON FUNCTION public.bookings_upsert_portal_participant_owner IS
  'Customer portal: upsert Participant 1 (account owner) name and birthdate. Bypasses RLS.';

GRANT EXECUTE ON FUNCTION public.bookings_upsert_portal_participant_owner TO anon;
GRANT EXECUTE ON FUNCTION public.bookings_upsert_portal_participant_owner TO authenticated;
