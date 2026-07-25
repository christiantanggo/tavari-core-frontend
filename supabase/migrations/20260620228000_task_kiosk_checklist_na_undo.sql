-- Kiosk checklist: mark item N/A (e.g. till not in use) and undo mistaken completion.

CREATE OR REPLACE FUNCTION public.task_manager_kiosk_checklist_mark_na(
  p_business_id uuid,
  p_task_id uuid,
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
  v_task public.task_manager_tasks%ROWTYPE;
  v_category public.task_manager_categories%ROWTYPE;
  v_completion_id uuid;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  SELECT tm.* INTO v_task
  FROM public.task_manager_tasks tm
  WHERE tm.id = p_task_id
    AND tm.business_id = p_business_id
    AND tm.status IN ('to_do', 'in_progress')
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Task is no longer available');
  END IF;

  SELECT * INTO v_category
  FROM public.task_manager_categories
  WHERE id = v_task.category_id
    AND business_id = p_business_id;

  IF v_category.id IS NULL
     OR (
       COALESCE(v_category.kiosk_checklist_button, false) IS NOT TRUE
       AND v_task.due_schedule_mode NOT IN ('opening_checklist', 'closing_checklist')
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This task is not part of a kiosk checklist');
  END IF;

  IF v_task.assigned_to IS NOT NULL AND v_task.assigned_to <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'This task is assigned to another employee');
  END IF;

  INSERT INTO public.task_manager_completions (
    business_id, task_id, employee_id, notes, evidence, completed_checklist
  )
  VALUES (
    p_business_id,
    p_task_id,
    p_employee_id,
    'Marked not applicable from kiosk checklist',
    jsonb_build_object('kiosk', 'checklist', 'outcome', 'not_applicable'),
    '[]'::jsonb
  )
  RETURNING id INTO v_completion_id;

  UPDATE public.task_manager_tasks
  SET
    status = 'done',
    claimed_by = COALESCE(claimed_by, p_employee_id),
    completed_by = p_employee_id,
    completed_at = now(),
    manager_review_required = false,
    review_status = 'not_required',
    completion_summary = jsonb_build_object(
      'completion_id', v_completion_id,
      'outcome', 'not_applicable',
      'evidence', jsonb_build_object('kiosk', 'checklist', 'outcome', 'not_applicable')
    )
  WHERE id = p_task_id;

  RETURN jsonb_build_object('success', true, 'completion_id', v_completion_id, 'outcome', 'not_applicable');
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_kiosk_checklist_undo(
  p_business_id uuid,
  p_task_id uuid,
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
  v_task public.task_manager_tasks%ROWTYPE;
  v_category public.task_manager_categories%ROWTYPE;
  v_tz text;
  v_today date;
  v_completion_id uuid;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;

  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT tm.* INTO v_task
  FROM public.task_manager_tasks tm
  WHERE tm.id = p_task_id
    AND tm.business_id = p_business_id
    AND tm.status = 'done'
    AND tm.completed_at IS NOT NULL
    AND (tm.completed_at AT TIME ZONE v_tz)::date = v_today
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This item cannot be reopened');
  END IF;

  SELECT * INTO v_category
  FROM public.task_manager_categories
  WHERE id = v_task.category_id
    AND business_id = p_business_id;

  IF v_category.id IS NULL
     OR (
       COALESCE(v_category.kiosk_checklist_button, false) IS NOT TRUE
       AND v_task.due_schedule_mode NOT IN ('opening_checklist', 'closing_checklist')
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This task is not part of a kiosk checklist');
  END IF;

  v_completion_id := NULLIF(v_task.completion_summary->>'completion_id', '')::uuid;

  IF v_completion_id IS NOT NULL THEN
    DELETE FROM public.task_manager_completions
    WHERE id = v_completion_id
      AND task_id = p_task_id
      AND business_id = p_business_id;
  END IF;

  UPDATE public.task_manager_tasks
  SET
    status = 'to_do',
    claimed_by = NULL,
    completed_by = NULL,
    completed_at = NULL,
    manager_review_required = false,
    review_status = 'not_required',
    completion_summary = '{}'::jsonb,
    available_at = now()
  WHERE id = p_task_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_kiosk_checklist_mark_na(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_kiosk_checklist_undo(uuid, uuid, uuid, text) TO anon, authenticated;

-- Return completion outcome for kiosk UI (complete vs not_applicable).
DROP FUNCTION IF EXISTS public.task_manager_get_checklist_tasks(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.task_manager_get_checklist_tasks(
  p_business_id uuid,
  p_employee_id uuid,
  p_category_id uuid
)
RETURNS TABLE (
  task_id uuid,
  title text,
  description text,
  priority text,
  status text,
  instructions text,
  checklist jsonb,
  requires_photo boolean,
  requires_notes boolean,
  required_form_id uuid,
  required_form_title text,
  checklist_sort_order integer,
  completed_at timestamptz,
  completion_outcome text,
  training_resources jsonb,
  missing_required_training integer,
  module_link_key text,
  module_link_path text,
  module_link_button_label text,
  module_link_allowed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_today date;
  v_category public.task_manager_categories%ROWTYPE;
BEGIN
  SELECT * INTO v_category
  FROM public.task_manager_categories
  WHERE id = p_category_id
    AND business_id = p_business_id
    AND is_active = true
    AND kiosk_checklist_button = true;

  IF v_category.id IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.task_manager_reset_shift_checklists(p_business_id);

  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;

  v_today := (now() AT TIME ZONE v_tz)::date;

  RETURN QUERY
  SELECT
    tm.id,
    tm.title,
    tm.description,
    tm.priority,
    tm.status,
    tm.instructions,
    tm.checklist,
    tm.requires_photo,
    tm.requires_notes,
    tm.required_form_id,
    (SELECT ft.title FROM public.forms_templates ft WHERE ft.id = tm.required_form_id),
    tm.checklist_sort_order,
    tm.completed_at,
    CASE
      WHEN tm.status = 'done'
        AND COALESCE(tm.completion_summary->>'outcome', '') = 'not_applicable' THEN 'not_applicable'
      WHEN tm.status = 'done' THEN 'complete'
      ELSE NULL
    END,
    COALESCE((
      SELECT jsonb_agg(resource_row ORDER BY (resource_row->>'sort_order')::integer, resource_row->>'title')
      FROM (
        SELECT jsonb_build_object(
          'id', tr.id,
          'title', tr.title,
          'resource_type', tr.resource_type,
          'resource_url', tr.resource_url,
          'content', tr.content,
          'is_required', tr.is_required,
          'completed', etc.id IS NOT NULL,
          'sort_order', row_number() OVER (ORDER BY tr.created_at)
        ) AS resource_row
        FROM public.task_manager_training_resources tr
        LEFT JOIN public.task_manager_employee_training_completions etc
          ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
        WHERE tr.task_id = tm.id
        UNION ALL
        SELECT jsonb_array_elements(public.task_manager_hr_training_resource_rows(hti, tr.id, p_employee_id)) AS resource_row
        FROM public.task_manager_training_resources tr
        JOIN public.hr_training_items hti ON hti.id = tr.hr_training_item_id
        WHERE hti.is_active = true AND tr.task_id = tm.id
      ) resources
    ), '[]'::jsonb),
    COALESCE((
      SELECT count(*)::integer
      FROM public.task_manager_training_resources tr
      LEFT JOIN public.task_manager_employee_training_completions etc
        ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
      WHERE tr.task_id = tm.id
        AND tr.is_required = true
        AND etc.id IS NULL
    ), 0),
    tm.module_link_key,
    (public.task_manager_module_link_def(tm.module_link_key)->>'path')::text,
    (public.task_manager_module_link_def(tm.module_link_key)->>'button_label')::text,
    public.task_manager_module_link_allowed(p_business_id, p_employee_id, tm.module_link_key)
  FROM public.task_manager_tasks tm
  WHERE tm.business_id = p_business_id
    AND tm.category_id = p_category_id
    AND tm.status <> 'cancelled'
    AND (
      tm.status IN ('to_do', 'in_progress')
      OR (
        tm.status = 'done'
        AND tm.completed_at IS NOT NULL
        AND (tm.completed_at AT TIME ZONE v_tz)::date = v_today
      )
    )
    AND (
      tm.assigned_to = p_employee_id
      OR (tm.assignment_scope = 'facility' AND tm.assigned_to IS NULL)
    )
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.task_manager_category_employees ce
        WHERE ce.category_id = tm.category_id
      )
      OR EXISTS (
        SELECT 1 FROM public.task_manager_category_employees ce
        WHERE ce.category_id = tm.category_id AND ce.employee_id = p_employee_id
      )
    )
  ORDER BY tm.checklist_sort_order ASC NULLS LAST, tm.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_get_checklist_tasks(uuid, uuid, uuid) TO anon, authenticated;
