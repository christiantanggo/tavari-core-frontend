-- Shared kiosk: list employees for completion dropdown; facility task queue without login session.

CREATE OR REPLACE FUNCTION public.task_manager_get_kiosk_employees(p_business_id uuid)
RETURNS TABLE (
  employee_id uuid,
  full_name text,
  first_name text,
  last_name text,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email)::text,
    u.first_name,
    u.last_name,
    COALESCE(
      (SELECT ur.role FROM public.user_roles ur
       WHERE ur.user_id = u.id AND ur.business_id = p_business_id AND ur.active = true
       LIMIT 1),
      (SELECT bu.role FROM public.business_users bu
       WHERE bu.user_id = u.id AND bu.business_id = p_business_id
       LIMIT 1)
    )::text
  FROM public.users u
  WHERE (
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
    AND COALESCE(u.is_active, true) = true
    AND COALESCE(lower(u.employment_status), '') NOT IN ('terminated', 'suspended')
    AND u.termination_date IS NULL
    AND u.pin IS NOT NULL
    AND length(trim(u.pin)) > 0
  ORDER BY 2 ASC, u.first_name ASC, u.last_name ASC;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_get_next_facility_task(p_business_id uuid)
RETURNS TABLE (
  task_id uuid,
  template_id uuid,
  title text,
  description text,
  category text,
  priority text,
  assignment_scope text,
  due_at timestamptz,
  requires_photo boolean,
  requires_notes boolean,
  instructions text,
  checklist jsonb,
  training_resources jsonb,
  missing_required_training integer,
  required_form_id uuid,
  required_form_title text,
  scheduled_for timestamptz,
  priority_boost integer,
  module_link_key text,
  module_link_path text,
  module_link_button_label text,
  module_link_allowed boolean,
  handoff_notes text,
  handoff_at timestamptz,
  handoff_by_name text,
  handoff_checklist jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.task_manager_generate_due_tasks(p_business_id);
  PERFORM public.task_manager_reset_weekly_round_robin(p_business_id);
  PERFORM public.task_manager_reset_shift_checklists(p_business_id);

  RETURN QUERY
  WITH round_robin_heads AS (
    SELECT DISTINCT ON (tm.round_robin_group_id)
      tm.round_robin_group_id, tm.id AS head_task_id
    FROM public.task_manager_tasks tm
    WHERE tm.business_id = p_business_id
      AND tm.round_robin_group_id IS NOT NULL
      AND tm.status IN ('to_do', 'in_progress')
    ORDER BY tm.round_robin_group_id, tm.round_robin_sort_order ASC NULLS LAST, tm.created_at ASC
  ),
  candidate AS (
    SELECT tm.*
    FROM public.task_manager_tasks tm
    LEFT JOIN round_robin_heads rr ON rr.round_robin_group_id = tm.round_robin_group_id
    LEFT JOIN public.task_manager_categories cat ON cat.id = tm.category_id
    WHERE tm.business_id = p_business_id
      AND tm.status IN ('to_do', 'in_progress')
      AND tm.available_at <= now()
      AND tm.due_schedule_mode NOT IN ('opening_checklist', 'closing_checklist', 'kiosk_checklist')
      AND COALESCE(cat.kiosk_checklist_button, false) = false
      AND tm.assignment_scope = 'facility'
      AND tm.assigned_to IS NULL
      AND (tm.round_robin_group_id IS NULL OR tm.id = rr.head_task_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.forms_submissions fs
        WHERE fs.business_id = p_business_id
          AND fs.task_template_id = tm.template_id
          AND fs.scheduled_for = tm.scheduled_for
      )
    ORDER BY
      public.task_manager_kiosk_queue_tier(tm, p_business_id) ASC,
      CASE WHEN tm.handoff_at IS NOT NULL AND tm.status = 'in_progress' THEN 0 ELSE 1 END,
      tm.handoff_at DESC NULLS LAST,
      tm.priority_boost DESC,
      CASE tm.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      COALESCE(tm.due_at, tm.available_at) ASC,
      tm.round_robin_sort_order ASC NULLS LAST,
      tm.created_at ASC
    LIMIT 1
  )
  SELECT
    c.id, c.template_id, c.title, c.description, c.category, c.priority, c.assignment_scope,
    c.due_at, c.requires_photo, c.requires_notes, c.instructions, c.checklist,
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
          'completed', false,
          'scope', CASE WHEN tr.task_id = c.id THEN 'task' ELSE 'template' END,
          'hr_training_item_id', tr.hr_training_item_id,
          'sort_order', CASE WHEN tr.task_id = c.id THEN 0 ELSE 1000 END + row_number() OVER (ORDER BY tr.created_at)
        ) AS resource_row
        FROM public.task_manager_training_resources tr
        WHERE tr.hr_training_item_id IS NULL
          AND (
            tr.task_id = c.id
            OR (c.template_id IS NOT NULL AND tr.template_id = c.template_id AND tr.task_id IS NULL)
          )
        UNION ALL
        SELECT jsonb_build_object(
          'id', tr.id,
          'title', tr.title,
          'resource_type', 'hr_training',
          'resource_url', NULL,
          'content', NULL,
          'is_required', tr.is_required,
          'completed', false,
          'scope', 'task',
          'hr_training_item_id', tr.hr_training_item_id,
          'sort_order', 1000 + row_number() OVER (ORDER BY tr.created_at)
        )
        FROM public.task_manager_training_resources tr
        JOIN public.hr_training_items hti ON hti.id = tr.hr_training_item_id
        WHERE hti.is_active = true
          AND (
            tr.task_id = c.id
            OR (c.template_id IS NOT NULL AND tr.template_id = c.template_id AND tr.task_id IS NULL)
          )
      ) resources
    ), '[]'::jsonb),
    COALESCE((
      SELECT count(*)::integer
      FROM public.task_manager_training_resources tr
      WHERE (
          tr.task_id = c.id
          OR (c.template_id IS NOT NULL AND tr.template_id = c.template_id AND tr.task_id IS NULL)
        )
        AND tr.is_required = true
    ), 0),
    c.required_form_id,
    (SELECT ft.title FROM public.forms_templates ft WHERE ft.id = c.required_form_id),
    c.scheduled_for,
    c.priority_boost,
    c.module_link_key,
    (public.task_manager_module_link_def(c.module_link_key)->>'path')::text,
    (public.task_manager_module_link_def(c.module_link_key)->>'button_label')::text,
    false,
    c.handoff_notes,
    c.handoff_at,
    (
      SELECT COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.first_name || ' ' || COALESCE(u.last_name, '')), ''), 'Staff')
      FROM public.users u
      WHERE u.id = c.handoff_by
    ),
    COALESCE(c.handoff_checklist, '[]'::jsonb)
  FROM candidate c;
END;
$$;

-- Allow checklist load without a logged-in employee (identity collected at completion).
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
    AND (
      p_employee_id IS NULL
      OR tm.assigned_to = p_employee_id
      OR (tm.assignment_scope = 'facility' AND tm.assigned_to IS NULL)
    )
    AND (
      p_employee_id IS NULL
      OR NOT EXISTS (
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

GRANT EXECUTE ON FUNCTION public.task_manager_get_kiosk_employees(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_get_next_facility_task(uuid) TO anon, authenticated;
