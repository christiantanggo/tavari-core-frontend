-- Run this in Supabase SQL Editor to add Edit and Delete participant support.
-- Requires bookings_portal_participants_COMPLETE.sql to have been run first.

-- RPC: Update any portal participant by id (customer/business scoped)
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

-- RPC: Soft-delete a portal participant (sets is_active = false so duplicates can be hidden)
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
