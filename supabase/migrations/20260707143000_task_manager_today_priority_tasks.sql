-- Manager "Today's Tasks" one-offs: highest kiosk queue priority for the business day.

ALTER TABLE public.task_manager_tasks
  DROP CONSTRAINT IF EXISTS task_manager_tasks_due_schedule_mode_check;

ALTER TABLE public.task_manager_tasks
  ADD CONSTRAINT task_manager_tasks_due_schedule_mode_check
  CHECK (due_schedule_mode IN (
    'specific_date', 'frequency', 'round_robin', 'weekly_round_robin', 'biweekly_round_robin',
    'daily_required', 'opening_checklist', 'closing_checklist', 'kiosk_checklist', 'today_priority'
  ));

CREATE INDEX IF NOT EXISTS idx_task_manager_tasks_today_priority
  ON public.task_manager_tasks (business_id, created_at DESC)
  WHERE due_schedule_mode = 'today_priority';

CREATE OR REPLACE FUNCTION public.task_manager_kiosk_queue_tier(
  p_task public.task_manager_tasks,
  p_business_id uuid
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_today date;
  v_week_start date;
  v_biweekly_period_start date;
  v_due_date date;
  v_created_date date;
BEGIN
  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;

  v_today := (now() AT TIME ZONE v_tz)::date;
  v_created_date := (p_task.created_at AT TIME ZONE v_tz)::date;

  -- Tier 0: manager-added tonight / today's priority list (above daily required).
  IF p_task.due_schedule_mode = 'today_priority' AND v_created_date = v_today THEN
    RETURN 0;
  END IF;

  IF p_task.due_schedule_mode = 'daily_required' THEN
    RETURN 1;
  END IF;

  v_week_start := public.task_manager_business_week_start(p_business_id);
  v_biweekly_period_start := public.task_manager_business_biweekly_period_start(p_business_id);
  v_due_date := COALESCE(
    (p_task.due_at AT TIME ZONE v_tz)::date,
    (p_task.available_at AT TIME ZONE v_tz)::date,
    p_task.schedule_once_date
  );

  IF p_task.due_schedule_mode = 'specific_date' AND v_due_date = v_today THEN
    RETURN 2;
  END IF;
  IF p_task.due_schedule_mode = 'frequency'
     AND p_task.schedule_type = 'once'
     AND p_task.schedule_once_date = v_today THEN
    RETURN 2;
  END IF;

  IF COALESCE(p_task.priority_boost, 0) > 0 THEN
    RETURN 3;
  END IF;
  IF p_task.occurrence_status IN ('missed', 'incomplete') THEN
    RETURN 3;
  END IF;
  IF p_task.due_schedule_mode = 'today_priority'
     AND v_created_date < v_today THEN
    RETURN 3;
  END IF;
  IF p_task.due_schedule_mode = 'weekly_round_robin'
     AND p_task.round_robin_week_start IS NOT NULL
     AND p_task.round_robin_week_start < v_week_start THEN
    RETURN 3;
  END IF;
  IF p_task.due_schedule_mode = 'biweekly_round_robin'
     AND p_task.round_robin_week_start IS NOT NULL
     AND p_task.round_robin_week_start < v_biweekly_period_start THEN
    RETURN 3;
  END IF;
  IF p_task.due_schedule_mode IN ('weekly_round_robin', 'biweekly_round_robin', 'round_robin', 'frequency')
     AND p_task.due_at IS NOT NULL
     AND p_task.due_at < now() THEN
    RETURN 3;
  END IF;
  IF p_task.template_id IS NOT NULL
     AND p_task.due_at IS NOT NULL
     AND p_task.due_at < now() THEN
    RETURN 3;
  END IF;
  IF p_task.due_schedule_mode = 'specific_date'
     AND v_due_date IS NOT NULL
     AND v_due_date < v_today THEN
    RETURN 3;
  END IF;

  RETURN 4;
END;
$$;

-- Today-priority tasks ignore sales-aware deprioritization.
CREATE OR REPLACE FUNCTION public.task_manager_task_queue_busy_sort_key(
  p_due_schedule_mode text,
  p_location_sensitivity text,
  p_signals jsonb
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_due_schedule_mode = 'today_priority' THEN
    RETURN 0;
  END IF;
  RETURN public.task_manager_task_busy_sort_key(p_location_sensitivity, p_signals);
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_task_queue_busy_sort_key(text, text, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.task_manager_get_next_facility_task(uuid);
DROP FUNCTION IF EXISTS public.task_manager_get_next_facility_task(uuid, uuid);

CREATE OR REPLACE FUNCTION public.task_manager_get_next_facility_task(
  p_business_id uuid,
  p_employee_id uuid DEFAULT NULL
)
RETURNS TABLE (
  task_id uuid,
  template_id uuid,
  title text,
  description text,
  category text,
  category_id uuid,
  location_sensitivity text,
  priority text,
  assignment_scope text,
  due_at timestamptz,
  requires_photo boolean,
  photo_requirement_mode text,
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
  handoff_checklist jsonb,
  facility_busy_signals jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signals jsonb;
BEGIN
  PERFORM public.task_manager_generate_due_tasks(p_business_id);
  PERFORM public.task_manager_reset_weekly_round_robin(p_business_id);
  PERFORM public.task_manager_reset_shift_checklists(p_business_id);

  v_signals := public.task_manager_facility_busy_signals(p_business_id);

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
    SELECT tm.*, COALESCE(cat.location_sensitivity, 'none') AS cat_location_sensitivity
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
      public.task_manager_task_queue_busy_sort_key(tm.due_schedule_mode, COALESCE(cat.location_sensitivity, 'none'), v_signals) ASC,
      CASE WHEN tm.handoff_at IS NOT NULL AND tm.status = 'in_progress' THEN 0 ELSE 1 END,
      tm.last_skipped_at ASC NULLS FIRST,
      tm.handoff_at DESC NULLS LAST,
      tm.priority_boost DESC,
      CASE tm.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      COALESCE(tm.due_at, tm.available_at) ASC,
      tm.round_robin_sort_order ASC NULLS LAST,
      tm.created_at ASC
    LIMIT 1
  )
  SELECT
    c.id, c.template_id, c.title, c.description, c.category, c.category_id, c.cat_location_sensitivity,
    c.priority, c.assignment_scope,
    c.due_at, c.requires_photo, c.photo_requirement_mode, c.requires_notes, c.instructions, c.checklist,
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
          'completed', (
            p_employee_id IS NOT NULL
            AND public.task_manager_training_resource_completed(p_business_id, tr.id, p_employee_id)
          ),
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
        SELECT jsonb_array_elements(
          public.task_manager_hr_training_resource_rows(hti, tr.id, p_employee_id)
        ) AS resource_row
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
        AND (
          p_employee_id IS NULL
          OR NOT public.task_manager_training_resource_completed(p_business_id, tr.id, p_employee_id)
        )
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
    COALESCE(c.handoff_checklist, '[]'::jsonb),
    v_signals
  FROM candidate c;
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_get_next_facility_task(uuid, uuid) TO anon, authenticated;

-- Patch queue preview busy-sort ordering to match kiosk.
CREATE OR REPLACE FUNCTION public.task_manager_get_kiosk_queue_preview(
  p_business_id uuid,
  p_employee_id uuid DEFAULT NULL
)
RETURNS TABLE (
  task_id uuid,
  title text,
  queue_position integer,
  status_flag text,
  last_completed_at timestamptz,
  priority text,
  category text,
  busy_sort_key integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done_ids uuid[] := '{}';
  v_next public.task_manager_tasks%ROWTYPE;
  v_position integer := 0;
  v_max_iterations integer := 500;
  v_i integer := 0;
  v_signals jsonb;
  v_busy_key integer;
  v_cat_sensitivity text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.task_manager_is_business_manager(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM public.task_manager_generate_due_tasks(p_business_id);
  PERFORM public.task_manager_reset_weekly_round_robin(p_business_id);
  PERFORM public.task_manager_reset_shift_checklists(p_business_id);

  v_signals := public.task_manager_facility_busy_signals(p_business_id);

  LOOP
    v_i := v_i + 1;
    EXIT WHEN v_i > v_max_iterations;

    SELECT tm.* INTO v_next
    FROM public.task_manager_tasks tm
    LEFT JOIN LATERAL (
      SELECT h.id AS head_task_id
      FROM public.task_manager_tasks h
      WHERE h.round_robin_group_id = tm.round_robin_group_id
        AND h.business_id = p_business_id
        AND h.status IN ('to_do', 'in_progress')
        AND NOT (h.id = ANY(v_done_ids))
      ORDER BY h.round_robin_sort_order ASC NULLS LAST, h.created_at ASC
      LIMIT 1
    ) rr ON tm.round_robin_group_id IS NOT NULL
    LEFT JOIN public.task_manager_categories cat ON cat.id = tm.category_id
    WHERE tm.business_id = p_business_id
      AND tm.status IN ('to_do', 'in_progress')
      AND tm.available_at <= now()
      AND tm.due_schedule_mode NOT IN ('opening_checklist', 'closing_checklist', 'kiosk_checklist')
      AND COALESCE(cat.kiosk_checklist_button, false) = false
      AND NOT (tm.id = ANY(v_done_ids))
      AND (
        p_employee_id IS NULL
          AND tm.assignment_scope = 'facility'
          AND tm.assigned_to IS NULL
        OR p_employee_id IS NOT NULL
          AND tm.assigned_to = p_employee_id
      )
      AND (
        p_employee_id IS NULL
        OR tm.category_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.task_manager_category_employees ce
          WHERE ce.category_id = tm.category_id
        )
        OR EXISTS (
          SELECT 1 FROM public.task_manager_category_employees ce
          WHERE ce.category_id = tm.category_id
            AND ce.employee_id = p_employee_id
        )
      )
      AND (tm.round_robin_group_id IS NULL OR tm.id = rr.head_task_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.forms_submissions fs
        WHERE fs.business_id = p_business_id
          AND fs.task_template_id = tm.template_id
          AND fs.scheduled_for = tm.scheduled_for
      )
    ORDER BY
      public.task_manager_kiosk_queue_tier(tm, p_business_id) ASC,
      public.task_manager_task_queue_busy_sort_key(tm.due_schedule_mode, COALESCE(cat.location_sensitivity, 'none'), v_signals) ASC,
      CASE WHEN tm.handoff_at IS NOT NULL AND tm.status = 'in_progress' THEN 0 ELSE 1 END,
      CASE WHEN p_employee_id IS NOT NULL AND tm.handoff_by IS NOT NULL AND tm.handoff_by = p_employee_id THEN 1 ELSE 0 END,
      tm.last_skipped_at ASC NULLS FIRST,
      tm.handoff_at DESC NULLS LAST,
      tm.priority_boost DESC,
      CASE WHEN p_employee_id IS NOT NULL AND tm.assigned_to = p_employee_id THEN 0 ELSE 1 END,
      CASE tm.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      COALESCE(tm.due_at, tm.available_at) ASC,
      tm.round_robin_sort_order ASC NULLS LAST,
      tm.created_at ASC
    LIMIT 1;

    EXIT WHEN v_next.id IS NULL;

    SELECT COALESCE(cat.location_sensitivity, 'none') INTO v_cat_sensitivity
    FROM public.task_manager_categories cat
    WHERE cat.id = v_next.category_id;

    v_cat_sensitivity := COALESCE(v_cat_sensitivity, 'none');
    v_busy_key := public.task_manager_task_queue_busy_sort_key(v_next.due_schedule_mode, v_cat_sensitivity, v_signals);
    v_position := v_position + 1;
    v_done_ids := array_append(v_done_ids, v_next.id);

    task_id := v_next.id;
    title := v_next.title;
    queue_position := v_position;
    status_flag := CASE
      WHEN public.task_manager_kiosk_queue_tier(v_next, p_business_id) = 0 THEN 'today_priority'
      WHEN public.task_manager_kiosk_queue_tier(v_next, p_business_id) = 3 THEN 'overdue'
      ELSE 'not_completed'
    END;
    last_completed_at := public.task_manager_task_last_completed_at(v_next);
    priority := v_next.priority;
    category := v_next.category;
    busy_sort_key := v_busy_key;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_get_kiosk_queue_preview(uuid, uuid) TO authenticated;
