-- Prefer loyalty-account name for portal "account owner" instead of whatever
-- name was typed on the latest test waiver (e.g. Super Mario).

CREATE OR REPLACE FUNCTION public.bookings_get_portal_waiver_roster(p_customer_id uuid, p_business_id uuid)
RETURNS TABLE (
  id uuid,
  waiver_id uuid,
  first_name text,
  last_name text,
  date_of_birth date,
  email text,
  phone_number text,
  participant_type text,
  is_account_owner boolean,
  is_active boolean,
  booking_customer_participant_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_account_name text;
BEGIN
  SELECT lower(trim(coalesce(pla.customer_name, '')))
  INTO v_account_name
  FROM public.pos_loyalty_accounts pla
  WHERE pla.id = p_customer_id
    AND pla.business_id = p_business_id;

  IF v_account_name IS NULL THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;

  RETURN QUERY
  SELECT
    ws.id,
    ws.id AS waiver_id,
    ws.first_name,
    ws.last_name,
    ws.date_of_birth,
    ws.email,
    ws.phone_number,
    'primary'::text AS participant_type,
    true AS is_account_owner,
    true AS is_active,
    NULL::uuid AS booking_customer_participant_id
  FROM public.waiver_signatures ws
  WHERE ws.business_id = p_business_id
    AND ws.customer_id = p_customer_id
    AND ws.signed_at IS NOT NULL
    AND ws.is_valid IS DISTINCT FROM false
    AND (ws.expires_at IS NULL OR ws.expires_at > now())
    -- Skip test/alias signer names that do not match the loyalty account.
    AND (
      v_account_name = ''
      OR lower(trim(coalesce(ws.first_name, '') || ' ' || coalesce(ws.last_name, ''))) = v_account_name
    )

  UNION ALL

  SELECT
    wp.id,
    wp.waiver_id,
    wp.first_name,
    wp.last_name,
    wp.date_of_birth,
    wp.email,
    wp.phone_number,
    COALESCE(NULLIF(TRIM(wp.participant_type), ''), 'additional_adult')::text AS participant_type,
    (
      COALESCE(wp.is_account_owner, false)
      AND (
        v_account_name = ''
        OR lower(trim(coalesce(wp.first_name, '') || ' ' || coalesce(wp.last_name, ''))) = v_account_name
      )
    ) AS is_account_owner,
    COALESCE(wp.is_active, true) AS is_active,
    NULL::uuid AS booking_customer_participant_id
  FROM public.waiver_participants wp
  INNER JOIN public.waiver_signatures ws ON ws.id = wp.waiver_id
  WHERE ws.business_id = p_business_id
    AND ws.customer_id = p_customer_id
    AND ws.signed_at IS NOT NULL
    AND ws.is_valid IS DISTINCT FROM false
    AND (ws.expires_at IS NULL OR ws.expires_at > now())
    AND COALESCE(wp.is_active, true)
    AND LOWER(COALESCE(wp.participant_type, '')) <> 'primary'

  UNION ALL

  SELECT
    wp.id,
    wp.waiver_id,
    wp.first_name,
    wp.last_name,
    wp.date_of_birth,
    wp.email,
    wp.phone_number,
    COALESCE(NULLIF(TRIM(wp.participant_type), ''), 'additional_adult')::text AS participant_type,
    (
      COALESCE(wp.is_account_owner, false)
      AND (
        v_account_name = ''
        OR lower(trim(coalesce(wp.first_name, '') || ' ' || coalesce(wp.last_name, ''))) = v_account_name
      )
    ) AS is_account_owner,
    COALESCE(wp.is_active, true) AS is_active,
    NULL::uuid AS booking_customer_participant_id
  FROM public.waiver_participants wp
  WHERE wp.customer_id = p_customer_id
    AND wp.business_id = p_business_id
    AND COALESCE(wp.is_active, true)
    AND wp.waiver_id IS NULL

  UNION ALL

  SELECT
    bcp.id,
    bcp.waiver_signature_id AS waiver_id,
    bcp.first_name,
    bcp.last_name,
    bcp.date_of_birth,
    bcp.email,
    bcp.phone_number,
    CASE WHEN COALESCE(bcp.is_account_owner, false) THEN 'primary'::text ELSE 'additional_adult'::text END AS participant_type,
    COALESCE(bcp.is_account_owner, false) AS is_account_owner,
    COALESCE(bcp.is_active, true) AS is_active,
    bcp.id AS booking_customer_participant_id
  FROM public.booking_customer_participants bcp
  WHERE bcp.customer_id = p_customer_id
    AND bcp.business_id = p_business_id
    AND COALESCE(bcp.is_active, true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_get_portal_waiver_roster(uuid, uuid) TO anon, authenticated;
