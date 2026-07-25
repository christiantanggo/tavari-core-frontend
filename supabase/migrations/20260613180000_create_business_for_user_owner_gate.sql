-- Harden create_business_for_user: only the session user may call; additional businesses
-- require an existing owner membership (first business / registration has no membership yet).
-- Depends on: public.business_users_row_matches_session_email (20260602121500).

CREATE OR REPLACE FUNCTION public.create_business_for_user(p_user_id uuid, p_business_name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_business_id uuid;
  v_result json;
  v_has_membership boolean;
  v_is_owner boolean;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '23502';
  END IF;

  IF NOT (
    p_user_id = auth.uid()
    OR public.business_users_row_matches_session_email(p_user_id)
  ) THEN
    RAISE EXCEPTION 'You can only create a business for your own account' USING ERRCODE = '42501';
  END IF;

  v_name := trim(both from coalesce(p_business_name, ''));
  IF length(v_name) < 2 THEN
    RAISE EXCEPTION 'Business name must be at least 2 characters' USING ERRCODE = '23514';
  END IF;

  SELECT
    EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.user_id = p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = p_user_id
        AND (ur.active IS DISTINCT FROM false)
    )
  INTO v_has_membership;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.user_id = p_user_id
        AND lower(trim(both from coalesce(bu.role::text, ''))) = 'owner'
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = p_user_id
        AND (ur.active IS DISTINCT FROM false)
        AND lower(trim(both from coalesce(ur.role::text, ''))) = 'owner'
    )
  INTO v_is_owner;

  IF v_has_membership AND NOT v_is_owner THEN
    RAISE EXCEPTION 'Only business owners can create an additional business' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.businesses (name, created_by, created_at)
  VALUES (v_name, p_user_id, now())
  RETURNING id INTO v_business_id;

  INSERT INTO public.business_users (business_id, user_id, role, created_at)
  VALUES (v_business_id, p_user_id, 'owner', now());

  v_result := json_build_object(
    'success', true,
    'business_id', v_business_id,
    'business_name', v_name
  );

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to create business: %', SQLERRM;
END;
$function$;

COMMENT ON FUNCTION public.create_business_for_user(uuid, text) IS
  'Creates a business and owner business_users row. Callers must be authenticated as p_user_id (or JWT email match). '
  'If the user already has any membership, they must be owner on at least one business before creating another.';

REVOKE ALL ON FUNCTION public.create_business_for_user(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_business_for_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_business_for_user(uuid, text) TO service_role;
