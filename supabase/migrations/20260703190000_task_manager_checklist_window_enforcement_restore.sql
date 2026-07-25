-- Restore kiosk checklist time-window enforcement (accidentally dropped in later migrations).

CREATE OR REPLACE FUNCTION public.task_manager_get_kiosk_checklist_buttons(
  p_business_id uuid
)
RETURNS TABLE (
  category_id uuid,
  name text,
  button_label text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_eval jsonb;
BEGIN
  FOR v_row IN
    SELECT c.id, c.name, c.kiosk_button_label
    FROM public.task_manager_categories c
    WHERE c.business_id = p_business_id
      AND c.is_active = true
      AND c.kiosk_checklist_button = true
    ORDER BY c.sort_order ASC, c.name ASC
  LOOP
    v_eval := public.task_manager_evaluate_checklist_category(v_row.id, now());
    IF COALESCE((v_eval->>'available')::boolean, false) IS NOT TRUE THEN
      CONTINUE;
    END IF;

    category_id := v_row.id;
    name := v_row.name;
    button_label := COALESCE(NULLIF(trim(v_row.kiosk_button_label), ''), v_row.name);
    RETURN NEXT;
  END LOOP;
END;
$$;

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
  photo_requirement_mode text,
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
  v_eval jsonb;
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

  v_eval := public.task_manager_evaluate_checklist_category(p_category_id, now());
  IF COALESCE((v_eval->>'is_checklist_category')::boolean, false) IS TRUE
     AND COALESCE((v_eval->>'available')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', COALESCE(v_eval->>'message', 'This checklist is not available right now.');
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
    tm.photo_requirement_mode,
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
    CASE
      WHEN p_employee_id IS NULL THEN false
      ELSE public.task_manager_module_link_allowed(p_business_id, p_employee_id, tm.module_link_key)
    END
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
  ORDER BY tm.checklist_sort_order ASC NULLS LAST, tm.title ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.task_manager_get_kiosk_checklist_buttons(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_manager_get_kiosk_checklist_buttons(uuid) TO anon, authenticated;
