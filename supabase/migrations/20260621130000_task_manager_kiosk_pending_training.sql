-- Task kiosk: after PIN sign-in, surface pending HR training before the task queue.

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
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
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
    'items', v_items,
    'count', jsonb_array_length(v_items)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_kiosk_acknowledge_training(
  p_business_id uuid,
  p_employee_id uuid,
  p_pin text,
  p_assignment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified uuid;
  v_task_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  SELECT a.task_manager_task_id
  INTO v_task_id
  FROM public.hr_training_assignments a
  WHERE a.id = p_assignment_id
    AND a.business_id = p_business_id
    AND a.employee_id = p_employee_id
    AND a.status <> 'cancelled';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Training assignment not found');
  END IF;

  UPDATE public.hr_training_assignments
  SET
    status = 'acknowledged',
    started_at = COALESCE(started_at, v_now),
    completed_at = COALESCE(completed_at, v_now),
    acknowledged_at = v_now,
    updated_at = v_now
  WHERE id = p_assignment_id;

  IF v_task_id IS NOT NULL THEN
    UPDATE public.task_manager_tasks
    SET
      status = 'done',
      completed_by = p_employee_id,
      completed_at = v_now,
      claimed_by = COALESCE(claimed_by, p_employee_id),
      review_status = 'not_required',
      manager_review_required = false,
      updated_at = v_now
    WHERE id = v_task_id
      AND business_id = p_business_id
      AND status IN ('to_do', 'in_progress', 'blocked');
  END IF;

  RETURN jsonb_build_object('success', true, 'assignment_id', p_assignment_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_kiosk_get_pending_training(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_kiosk_acknowledge_training(uuid, uuid, text, uuid) TO anon, authenticated;
