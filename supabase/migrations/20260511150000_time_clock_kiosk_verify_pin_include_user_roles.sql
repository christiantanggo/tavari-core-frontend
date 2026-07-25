-- Punch clock PIN must match POS: POS uses get_all_staff_pins_for_unlock (user_roles only).
-- time_clock_kiosk_verify_pin previously used users.business_id + business_users only,
-- so staff with POS access via user_roles but no business_users row failed with "Invalid PIN".

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_verify_pin(
  p_business_id uuid,
  p_pin text
)
RETURNS TABLE (
  id uuid,
  full_name text,
  email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_full_name text;
  v_email text;
  u record;
  v_tz text;
  v_today date;
BEGIN
  IF p_business_id IS NULL OR p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(b.timezone, 'America/Toronto')
  INTO v_tz
  FROM public.businesses b
  WHERE b.id = p_business_id;

  IF v_tz IS NULL THEN
    v_tz := 'America/Toronto';
  END IF;

  v_today := ((now() AT TIME ZONE v_tz))::date;

  SELECT u0.id, COALESCE(u0.full_name, ''), COALESCE(u0.email, '')
  INTO v_id, v_full_name, v_email
  FROM public.users u0
  WHERE (
      u0.business_id = p_business_id
      OR EXISTS (
        SELECT 1
        FROM public.business_users bu
        WHERE bu.user_id = u0.id
          AND bu.business_id = p_business_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = u0.id
          AND ur.business_id = p_business_id
          AND ur.active IS TRUE
      )
    )
    AND u0.pin IS NOT NULL
    AND trim(u0.pin) <> ''
    AND u0.pin = p_pin
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, v_full_name::text, v_email::text;
    RETURN;
  END IF;

  FOR u IN
    SELECT u1.id, u1.full_name, u1.email, u1.pin
    FROM public.users u1
    WHERE (
        u1.business_id = p_business_id
        OR EXISTS (
          SELECT 1
          FROM public.business_users bu
          WHERE bu.user_id = u1.id
            AND bu.business_id = p_business_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = u1.id
            AND ur.business_id = p_business_id
            AND ur.active IS TRUE
        )
      )
      AND u1.pin IS NOT NULL
      AND trim(u1.pin) <> ''
      AND (
        u1.pin LIKE '$2a$%'
        OR u1.pin LIKE '$2b$%'
        OR u1.pin LIKE '$2y$%'
      )
    ORDER BY
      EXISTS (
        SELECT 1
        FROM public.scheduling_shifts s
        WHERE s.employee_id = u1.id
          AND s.business_id = p_business_id
          AND s.shift_date = v_today
          AND COALESCE(s.status, 'scheduled') = 'scheduled'
      )
      DESC,
      u1.id
  LOOP
    IF public.time_clock_kiosk_pin_matches(u.pin, p_pin) THEN
      RETURN QUERY
      SELECT u.id, COALESCE(u.full_name, '')::text, COALESCE(u.email, '')::text;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_verify_pin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_verify_pin(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_verify_pin(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.time_clock_kiosk_verify_pin(uuid, text) IS
  'Returns at most one user when kiosk PIN matches. Same business membership as POS unlock: '
  'users.business_id, business_users, or active user_roles for the business. '
  'Bcrypt tries users with a scheduled shift today (business TZ) first.';
