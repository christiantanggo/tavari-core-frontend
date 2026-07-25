-- Time clock kiosk: resolve employee by PIN on the server (plain text + bcrypt via crypt).
-- Avoids loading every staff row into the browser and running sequential bcryptjs.compare,
-- which was taking tens of seconds for larger teams.

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_pin_matches(p_stored text, p_entered text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  IF p_stored IS NULL OR p_entered IS NULL OR length(trim(p_entered)) = 0 THEN
    RETURN false;
  END IF;

  IF p_stored = p_entered THEN
    RETURN true;
  END IF;

  BEGIN
    v_ok := crypt(p_entered, p_stored) = p_stored;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
  END;

  RETURN COALESCE(v_ok, false);
END;
$$;

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
BEGIN
  IF p_business_id IS NULL OR p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    RETURN;
  END IF;

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
      )
      AND u1.pin IS NOT NULL
      AND trim(u1.pin) <> ''
      AND (
        u1.pin LIKE '$2a$%'
        OR u1.pin LIKE '$2b$%'
        OR u1.pin LIKE '$2y$%'
      )
  LOOP
    IF public.time_clock_kiosk_pin_matches(u.pin, p_pin) THEN
      RETURN QUERY
      SELECT u.id, COALESCE(u.full_name, '')::text, COALESCE(u.email, '')::text;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_pin_matches(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.time_clock_kiosk_verify_pin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_verify_pin(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_verify_pin(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.time_clock_kiosk_pin_matches(text, text) IS
  'Plain or bcrypt PIN check for time clock kiosk (uses pgcrypt crypt).';

COMMENT ON FUNCTION public.time_clock_kiosk_verify_pin(uuid, text) IS
  'Returns at most one user for a business when the kiosk PIN matches (plain or bcrypt).';
