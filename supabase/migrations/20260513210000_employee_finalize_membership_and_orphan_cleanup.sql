-- 1) Transactional RPC: upsert public.users + business_users in one statement batch (same txn).
--    Trigger sync_user_roles() on business_users keeps user_roles aligned.
-- 2) Scheduled cleanup: remove very stale public.users rows with no business membership (Auth users
--    must be removed separately via Supabase Dashboard or Admin API if still unwanted).

CREATE OR REPLACE FUNCTION public.finalize_employee_membership(
  p_target_user_id uuid,
  p_business_id uuid,
  p_role text DEFAULT 'employee',
  p_profile jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_clean text;
  v_email text;
  v_first text;
  v_last text;
  v_full text;
  v_roles text[];
  v_claim int;
BEGIN
  IF p_target_user_id IS NULL OR p_business_id IS NULL THEN
    RAISE EXCEPTION 'p_target_user_id and p_business_id are required' USING ERRCODE = '23502';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Caller must manage this business (supports split auth vs public.users.id via email match helper)
  IF NOT EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND (
        bu.user_id = auth.uid()
        OR public.business_users_row_matches_session_email(bu.user_id)
      )
      AND bu.role = ANY (ARRAY['owner', 'manager', 'admin']::text[])
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.business_id = p_business_id
      AND (
        ur.user_id = auth.uid()
        OR public.business_users_row_matches_session_email(ur.user_id)
      )
      AND ur.active IS NOT FALSE
      AND ur.role = ANY (ARRAY['owner', 'manager', 'admin']::text[])
  ) THEN
    RAISE EXCEPTION 'Not authorized to add employees for this business' USING ERRCODE = '42501';
  END IF;

  v_role_clean := COALESCE(NULLIF(trim(p_role), ''), 'employee');

  v_email := lower(trim(COALESCE(p_profile ->> 'email', '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'profile.email is required' USING ERRCODE = '23502';
  END IF;

  v_first := trim(COALESCE(p_profile ->> 'first_name', ''));
  v_last := trim(COALESCE(p_profile ->> 'last_name', ''));
  v_full := trim(COALESCE(p_profile ->> 'full_name', ''));
  IF v_full = '' THEN
    v_full := trim(both FROM v_first || ' ' || v_last);
  END IF;
  IF v_full = '' THEN
    RAISE EXCEPTION 'profile.full_name or first_name+last_name is required' USING ERRCODE = '23502';
  END IF;

  IF p_profile ? 'roles'
     AND jsonb_typeof(p_profile -> 'roles') = 'array'
     AND jsonb_array_length(p_profile -> 'roles') > 0 THEN
    SELECT coalesce(array_agg(elem ORDER BY ord), ARRAY[]::text[])
    INTO v_roles
    FROM jsonb_array_elements_text(p_profile -> 'roles') WITH ORDINALITY AS t(elem, ord);
  ELSE
    v_roles := ARRAY['employee']::text[];
  END IF;

  v_claim := COALESCE(
    nullif(trim(coalesce(p_profile ->> 'claim_code', '')), '')::int,
    1
  );

  INSERT INTO public.users (
    id,
    email,
    full_name,
    first_name,
    last_name,
    phone,
    pin,
    hashed_password,
    position,
    department,
    hire_date,
    wage,
    claim_code,
    employment_status,
    status,
    roles
  )
  VALUES (
    p_target_user_id,
    v_email,
    v_full,
    nullif(v_first, ''),
    nullif(v_last, ''),
    nullif(trim(coalesce(p_profile ->> 'phone', '')), ''),
    nullif(p_profile ->> 'pin', ''),
    nullif(p_profile ->> 'hashed_password', ''),
    nullif(trim(coalesce(p_profile ->> 'position', '')), ''),
    nullif(trim(coalesce(p_profile ->> 'department', '')), ''),
    CASE
      WHEN nullif(trim(coalesce(p_profile ->> 'hire_date', '')), '') IS NULL THEN NULL
      ELSE nullif(trim(p_profile ->> 'hire_date'), '')::date
    END,
    CASE
      WHEN nullif(trim(coalesce(p_profile ->> 'wage', '')), '') IS NULL THEN NULL
      ELSE nullif(trim(p_profile ->> 'wage'), '')::numeric
    END,
    v_claim,
    coalesce(nullif(trim(p_profile ->> 'employment_status'), ''), 'active'),
    coalesce(nullif(trim(p_profile ->> 'status'), ''), 'active'),
    v_roles
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    first_name = COALESCE(EXCLUDED.first_name, users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, users.last_name),
    phone = COALESCE(EXCLUDED.phone, users.phone),
    pin = COALESCE(EXCLUDED.pin, users.pin),
    hashed_password = COALESCE(EXCLUDED.hashed_password, users.hashed_password),
    position = COALESCE(EXCLUDED.position, users.position),
    department = COALESCE(EXCLUDED.department, users.department),
    hire_date = COALESCE(EXCLUDED.hire_date, users.hire_date),
    wage = COALESCE(EXCLUDED.wage, users.wage),
    claim_code = COALESCE(EXCLUDED.claim_code, users.claim_code),
    employment_status = COALESCE(EXCLUDED.employment_status, users.employment_status),
    status = COALESCE(EXCLUDED.status, users.status),
    roles = CASE
      WHEN p_profile ? 'roles'
        AND jsonb_typeof(p_profile -> 'roles') = 'array'
        AND jsonb_array_length(p_profile -> 'roles') > 0
      THEN EXCLUDED.roles
      ELSE users.roles
    END;

  INSERT INTO public.business_users (user_id, business_id, role)
  VALUES (p_target_user_id, p_business_id, v_role_clean)
  ON CONFLICT (user_id, business_id)
  DO UPDATE SET role = EXCLUDED.role;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_target_user_id,
    'business_id', p_business_id
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_employee_membership(uuid, uuid, text, jsonb) IS
  'Atomically upserts users + business_users for a new employee; user_roles filled by trigger. '
  'Caller must be owner/manager/admin of p_business_id. Does not create Auth users.';

REVOKE ALL ON FUNCTION public.finalize_employee_membership(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_employee_membership(uuid, uuid, text, jsonb) TO authenticated;


-- Cleanup: stale profiles with no business and no user_roles (avoids deleting active portal-only rows)
CREATE OR REPLACE FUNCTION public.cleanup_orphan_employee_profiles(
  p_min_age interval DEFAULT interval '7 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count int;
BEGIN
  WITH victims AS (
    SELECT u.id
    FROM public.users u
    WHERE u.created_at < now() - p_min_age
      AND NOT EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id)
  ),
  del AS (
    DELETE FROM public.users u
    USING victims v
    WHERE u.id = v.id
    RETURNING u.id
  )
  SELECT count(*)::int INTO deleted_count FROM del;

  RETURN coalesce(deleted_count, 0);
END;
$$;

COMMENT ON FUNCTION public.cleanup_orphan_employee_profiles(interval) IS
  'Deletes public.users rows older than p_min_age with no business_users and no user_roles. '
  'Does not delete auth.users; remove those in Supabase Auth if needed.';

REVOKE ALL ON FUNCTION public.cleanup_orphan_employee_profiles(interval) FROM PUBLIC;


CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-orphan-employee-profiles-weekly') THEN
    PERFORM cron.unschedule('cleanup-orphan-employee-profiles-weekly');
  END IF;

  PERFORM cron.schedule(
    'cleanup-orphan-employee-profiles-weekly',
    '0 6 * * 0',
    'SELECT public.cleanup_orphan_employee_profiles(interval ''7 days'');'
  );
END $$;
