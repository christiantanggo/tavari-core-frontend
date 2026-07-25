-- Task manager kiosk PIN: match POS bcryptjs hashes ($2b$/$2y$) and same business membership rules as time clock.

CREATE OR REPLACE FUNCTION public.task_manager_pin_matches(p_stored_pin text, p_pin text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ok boolean := false;
  v_norm text;
BEGIN
  IF p_stored_pin IS NULL OR p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    RETURN false;
  END IF;

  IF p_stored_pin = p_pin THEN
    RETURN true;
  END IF;

  BEGIN
    v_ok := (crypt(trim(p_pin), p_stored_pin) = p_stored_pin);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
  END;

  IF COALESCE(v_ok, false) THEN
    RETURN true;
  END IF;

  IF p_stored_pin LIKE '$2b$%' OR p_stored_pin LIKE '$2y$%' THEN
    v_norm := '$2a$' || substr(p_stored_pin, 5);
    BEGIN
      v_ok := (crypt(trim(p_pin), v_norm) = v_norm);
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
    END;
  END IF;

  RETURN COALESCE(v_ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_verify_pin(
  p_business_id uuid,
  p_pin text
)
RETURNS TABLE (
  employee_id uuid,
  full_name text,
  first_name text,
  last_name text,
  role text,
  hire_date date,
  "position" text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u record;
BEGIN
  IF p_business_id IS NULL OR p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    u0.id,
    COALESCE(u0.full_name, trim(concat_ws(' ', u0.first_name, u0.last_name)), u0.email)::text,
    u0.first_name,
    u0.last_name,
    COALESCE(
      (SELECT ur.role FROM public.user_roles ur
       WHERE ur.user_id = u0.id AND ur.business_id = p_business_id AND ur.active = true
       LIMIT 1),
      (SELECT bu.role FROM public.business_users bu
       WHERE bu.user_id = u0.id AND bu.business_id = p_business_id
       LIMIT 1)
    )::text,
    u0.hire_date,
    u0.position
  FROM public.users u0
  WHERE (
      u0.business_id = p_business_id
      OR EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.user_id = u0.id AND bu.business_id = p_business_id
      )
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = u0.id AND ur.business_id = p_business_id AND ur.active IS TRUE
      )
    )
    AND u0.pin IS NOT NULL
    AND trim(u0.pin) <> ''
    AND u0.pin = p_pin
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  FOR u IN
    SELECT
      u1.id,
      u1.full_name,
      u1.first_name,
      u1.last_name,
      u1.hire_date,
      u1.position,
      u1.pin,
      COALESCE(
        (SELECT ur.role FROM public.user_roles ur
         WHERE ur.user_id = u1.id AND ur.business_id = p_business_id AND ur.active = true
         LIMIT 1),
        (SELECT bu.role FROM public.business_users bu
         WHERE bu.user_id = u1.id AND bu.business_id = p_business_id
         LIMIT 1)
      ) AS role
    FROM public.users u1
    WHERE (
        u1.business_id = p_business_id
        OR EXISTS (
          SELECT 1 FROM public.business_users bu
          WHERE bu.user_id = u1.id AND bu.business_id = p_business_id
        )
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = u1.id AND ur.business_id = p_business_id AND ur.active IS TRUE
        )
      )
      AND u1.pin IS NOT NULL
      AND trim(u1.pin) <> ''
      AND (
        u1.pin LIKE '$2a$%'
        OR u1.pin LIKE '$2b$%'
        OR u1.pin LIKE '$2y$%'
      )
    ORDER BY u1.id
  LOOP
    IF public.task_manager_pin_matches(u.pin, p_pin) THEN
      RETURN QUERY
      SELECT
        u.id,
        COALESCE(u.full_name, trim(concat_ws(' ', u.first_name, u.last_name)))::text,
        u.first_name,
        u.last_name,
        u.role::text,
        u.hire_date,
        u.position;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.task_manager_pin_matches(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_manager_pin_matches(text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.task_manager_verify_pin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_manager_verify_pin(uuid, text) TO anon, authenticated;
