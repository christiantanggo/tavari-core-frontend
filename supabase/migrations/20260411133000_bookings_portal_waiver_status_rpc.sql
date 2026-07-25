-- Portal waiver status helper for booking self-service.
-- Lets anon portal flows resolve waiver validity/expiry without broad table SELECT access.

CREATE OR REPLACE FUNCTION public.bookings_get_portal_waiver_statuses(
  p_business_id UUID,
  p_waiver_ids UUID[]
)
RETURNS TABLE (
  id UUID,
  is_valid BOOLEAN,
  expires_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ws.id, ws.is_valid, ws.expires_at
  FROM public.waiver_signatures ws
  WHERE ws.business_id = p_business_id
    AND ws.id = ANY(COALESCE(p_waiver_ids, ARRAY[]::UUID[]));
$$;

GRANT EXECUTE ON FUNCTION public.bookings_get_portal_waiver_statuses(UUID, UUID[]) TO anon, authenticated;
