-- bcryptjs (and many Node bcrypt libs) emit $2b$ / $2y$ prefixes. PostgreSQL pgcrypto's crypt()
-- historically only treated $2a$ / $2x$ as bcrypt, so crypt(plain, stored) never matched $2b$ hashes.
-- Browser fallback (bcryptjs) then matched while time_clock_kiosk_verify_pin returned no row, and
-- time_clock_kiosk_clock_in raised "Invalid PIN". Normalize $2b$/$2y$ to $2a$ for verification.

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_pin_matches(p_stored text, p_entered text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_ok boolean := false;
  v_norm text;
BEGIN
  IF p_stored IS NULL OR p_entered IS NULL OR length(trim(p_entered)) = 0 THEN
    RETURN false;
  END IF;

  IF p_stored = p_entered THEN
    RETURN true;
  END IF;

  BEGIN
    v_ok := (crypt(trim(p_entered), p_stored) = p_stored);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
  END;

  IF COALESCE(v_ok, false) THEN
    RETURN true;
  END IF;

  IF p_stored LIKE '$2b$%' OR p_stored LIKE '$2y$%' THEN
    v_norm := '$2a$' || substr(p_stored, 5);
    BEGIN
      v_ok := (crypt(trim(p_entered), v_norm) = v_norm);
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
    END;
  END IF;

  RETURN COALESCE(v_ok, false);
END;
$$;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_pin_matches(text, text) FROM PUBLIC;

COMMENT ON FUNCTION public.time_clock_kiosk_pin_matches(text, text) IS
  'Plain or bcrypt PIN check for time clock kiosk (pgcrypto crypt). Normalizes $2b$/$2y$ bcrypt '
  'prefixes to $2a$ so verification matches bcryptjs-stored hashes.';
