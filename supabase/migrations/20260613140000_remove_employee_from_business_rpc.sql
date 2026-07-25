-- Client DELETE on user_roles / business_users often removes 0 rows under RLS (only SELECT policies
-- were added for split auth vs public.users.id). This RPC runs as SECURITY DEFINER and enforces
-- the same manager/owner/admin gate as finalize_employee_membership.
-- Depends on: public.business_users_row_matches_session_email (20260602121500).

CREATE OR REPLACE FUNCTION public.remove_employee_from_business(
  p_target_user_id uuid,
  p_business_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_ur int := 0;
  n_bu int := 0;
BEGIN
  IF p_target_user_id IS NULL OR p_business_id IS NULL THEN
    RAISE EXCEPTION 'p_target_user_id and p_business_id are required' USING ERRCODE = '23502';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove your own account from the roster' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND (
        bu.user_id = auth.uid()
        OR public.business_users_row_matches_session_email(bu.user_id)
      )
      AND bu.role = ANY (ARRAY['owner', 'manager', 'admin', 'hr_admin']::text[])
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
      AND ur.role = ANY (ARRAY['owner', 'manager', 'admin', 'hr_admin']::text[])
  ) THEN
    RAISE EXCEPTION 'Not authorized to remove employees for this business' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = p_target_user_id
    AND business_id = p_business_id;
  GET DIAGNOSTICS n_ur = ROW_COUNT;

  DELETE FROM public.business_users
  WHERE user_id = p_target_user_id
    AND business_id = p_business_id;
  GET DIAGNOSTICS n_bu = ROW_COUNT;

  IF n_ur = 0 AND n_bu = 0 THEN
    RAISE EXCEPTION 'No membership rows found for this employee on this business'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_roles_deleted', n_ur,
    'business_users_deleted', n_bu
  );
END;
$$;

COMMENT ON FUNCTION public.remove_employee_from_business(uuid, uuid) IS
  'Removes target user from p_business_id roster (user_roles + business_users). '
  'Caller must be owner/manager/admin/hr_admin; supports JWT email vs public.users.id split via business_users_row_matches_session_email.';

REVOKE ALL ON FUNCTION public.remove_employee_from_business(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_employee_from_business(uuid, uuid) TO authenticated;
