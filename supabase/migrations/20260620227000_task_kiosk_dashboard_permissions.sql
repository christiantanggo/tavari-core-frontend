-- Task kiosk dashboard: load permissions from session token alone (no employee_id mismatch).

CREATE OR REPLACE FUNCTION public.task_kiosk_dashboard_session_employee(
  p_token uuid,
  p_business_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
BEGIN
  IF p_token IS NULL OR p_business_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM public.task_kiosk_dashboard_purge_expired();

  SELECT s.employee_id
  INTO v_employee_id
  FROM public.task_kiosk_dashboard_sessions s
  WHERE s.token = p_token
    AND s.business_id = p_business_id
    AND s.expires_at > now()
  LIMIT 1;

  RETURN v_employee_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_kiosk_dashboard_permissions(
  p_token uuid,
  p_business_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_role text;
  v_permissions jsonb;
BEGIN
  v_employee_id := public.task_kiosk_dashboard_session_employee(p_token, p_business_id);

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired task kiosk session';
  END IF;

  v_role := public.user_business_role(p_business_id, v_employee_id);

  SELECT COALESCE(jsonb_agg(rp.permission_key ORDER BY rp.permission_key), '[]'::jsonb)
  INTO v_permissions
  FROM public.role_permissions rp
  WHERE rp.business_id = p_business_id
    AND rp.role_key = v_role
    AND rp.granted IS TRUE;

  IF v_role = 'owner' THEN
    v_permissions := '["*"]'::jsonb;
  ELSIF v_role = 'admin' THEN
    SELECT COALESCE(jsonb_agg(DISTINCT rp.permission_key ORDER BY rp.permission_key), '[]'::jsonb)
    INTO v_permissions
    FROM public.role_permissions rp
    WHERE rp.business_id = p_business_id
      AND rp.granted IS TRUE
      AND rp.permission_key NOT LIKE 'owner.%';
  END IF;

  RETURN jsonb_build_object(
    'employee_id', v_employee_id,
    'role', v_role,
    'permissions', v_permissions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.task_kiosk_dashboard_session_employee(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_kiosk_dashboard_permissions(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_kiosk_dashboard_session_employee(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_kiosk_dashboard_permissions(uuid, uuid) TO anon, authenticated;
