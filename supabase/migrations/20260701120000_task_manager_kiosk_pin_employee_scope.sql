-- Task kiosk PIN: verify only the selected active employee (matches kiosk dropdown + POS bcryptjs).

DROP FUNCTION IF EXISTS public.task_manager_verify_pin(uuid, text);

CREATE OR REPLACE FUNCTION public.task_manager_user_is_kiosk_eligible(
  p_business_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = p_user_id
      AND u.pin IS NOT NULL
      AND length(trim(u.pin)) > 0
      AND COALESCE(u.is_active, true) = true
      AND COALESCE(lower(u.employment_status), '') NOT IN ('terminated', 'suspended')
      AND u.termination_date IS NULL
      AND (
        u.business_id = p_business_id
        OR EXISTS (
          SELECT 1 FROM public.business_users bu
          WHERE bu.user_id = u.id AND bu.business_id = p_business_id
        )
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = u.id AND ur.business_id = p_business_id AND ur.active IS TRUE
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.task_manager_verify_pin(
  p_business_id uuid,
  p_pin text,
  p_employee_id uuid DEFAULT NULL
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

  IF p_employee_id IS NOT NULL
     AND NOT public.task_manager_user_is_kiosk_eligible(p_business_id, p_employee_id) THEN
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
  WHERE public.task_manager_user_is_kiosk_eligible(p_business_id, u0.id)
    AND (p_employee_id IS NULL OR u0.id = p_employee_id)
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
    WHERE public.task_manager_user_is_kiosk_eligible(p_business_id, u1.id)
      AND (p_employee_id IS NULL OR u1.id = p_employee_id)
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

CREATE OR REPLACE FUNCTION public.task_manager_kiosk_get_pending_training(
  p_business_id uuid,
  p_employee_id uuid,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified uuid;
  v_items jsonb := '[]'::jsonb;
BEGIN
  SELECT v.employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin, p_employee_id) v
  LIMIT 1;

  IF v_verified IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN';
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY sort_key), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      jsonb_build_object(
        'assignment_id', a.id,
        'status', a.status,
        'due_date', a.due_date,
        'assigned_at', a.assigned_at,
        'requires_acknowledgement', hti.requires_acknowledgement,
        'quiz_enabled', COALESCE((hti.quiz->>'enabled')::boolean, false),
        'training_item_id', hti.id,
        'title', hti.title,
        'description', hti.description,
        'content', hti.content,
        'sections', hti.sections,
        'steps', hti.steps,
        'task_manager_task_id', a.task_manager_task_id
      ) AS row_data,
      COALESCE(a.due_date::text, '9999-12-31') || a.assigned_at::text AS sort_key
    FROM public.hr_training_assignments a
    JOIN public.hr_training_items hti ON hti.id = a.training_item_id
    WHERE a.business_id = p_business_id
      AND a.employee_id = p_employee_id
      AND a.status <> 'cancelled'
      AND hti.is_active = true
      AND hti.kiosk_sign_in_required = true
      AND (
        a.status IN ('assigned', 'in_progress')
        OR (
          a.status = 'completed'
          AND hti.requires_acknowledgement = true
          AND a.acknowledged_at IS NULL
        )
      )
  ) pending_rows;

  RETURN jsonb_build_object(
    'success', true,
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.task_manager_user_is_kiosk_eligible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_manager_user_is_kiosk_eligible(uuid, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.task_manager_verify_pin(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_manager_verify_pin(uuid, text, uuid) TO anon, authenticated;
