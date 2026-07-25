-- Opening / closing shift checklists: full list on kiosk (button), not one-at-a-time queue.

ALTER TABLE public.task_manager_tasks
  DROP CONSTRAINT IF EXISTS task_manager_tasks_due_schedule_mode_check;

ALTER TABLE public.task_manager_tasks
  ADD CONSTRAINT task_manager_tasks_due_schedule_mode_check
  CHECK (due_schedule_mode IN (
    'specific_date', 'frequency', 'round_robin', 'weekly_round_robin',
    'daily_required', 'opening_checklist', 'closing_checklist'
  ));

ALTER TABLE public.task_manager_tasks
  ADD COLUMN IF NOT EXISTS checklist_sort_order integer;

CREATE INDEX IF NOT EXISTS idx_task_manager_tasks_checklist
  ON public.task_manager_tasks (business_id, due_schedule_mode, checklist_sort_order)
  WHERE due_schedule_mode IN ('opening_checklist', 'closing_checklist');

-- Re-open opening/closing checklist tasks on a new business day.
CREATE OR REPLACE FUNCTION public.task_manager_reset_shift_checklists(p_business_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_today date;
  v_reset_count integer := 0;
BEGIN
  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;

  v_today := (now() AT TIME ZONE v_tz)::date;

  UPDATE public.task_manager_tasks
  SET
    status = 'to_do',
    claimed_by = NULL,
    completed_by = NULL,
    completed_at = NULL,
    review_status = 'not_required',
    manager_review_required = false,
    completion_summary = '{}'::jsonb,
    available_at = now()
  WHERE business_id = p_business_id
    AND due_schedule_mode IN ('opening_checklist', 'closing_checklist')
    AND status = 'done'
    AND (
      completed_at IS NULL
      OR (completed_at AT TIME ZONE v_tz)::date < v_today
    );

  GET DIAGNOSTICS v_reset_count = ROW_COUNT;
  RETURN v_reset_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_get_checklist_tasks(
  p_business_id uuid,
  p_employee_id uuid,
  p_checklist_mode text
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
  training_resources jsonb,
  missing_required_training integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_today date;
BEGIN
  IF p_checklist_mode NOT IN ('opening_checklist', 'closing_checklist') THEN
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
        WHERE tr.task_id = tm.id OR (tr.hr_training_item_id IS NOT NULL AND tr.task_id = tm.id)
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
    ), 0)
  FROM public.task_manager_tasks tm
  WHERE tm.business_id = p_business_id
    AND tm.due_schedule_mode = p_checklist_mode
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
      tm.category_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.task_manager_category_employees ce WHERE ce.category_id = tm.category_id)
      OR EXISTS (SELECT 1 FROM public.task_manager_category_employees ce WHERE ce.category_id = tm.category_id AND ce.employee_id = p_employee_id)
    )
  ORDER BY tm.checklist_sort_order ASC NULLS LAST, tm.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_get_checklist_tasks(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_reset_shift_checklists(uuid) TO anon, authenticated;

-- Exclude checklist tasks from the one-at-a-time kiosk queue.
CREATE OR REPLACE FUNCTION public.task_manager_get_next_task(
  p_business_id uuid,
  p_employee_id uuid
)
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
  priority_boost integer
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
    WHERE tm.business_id = p_business_id
      AND tm.status IN ('to_do', 'in_progress')
      AND tm.available_at <= now()
      AND tm.due_schedule_mode NOT IN ('opening_checklist', 'closing_checklist')
      AND (
        tm.assigned_to = p_employee_id
        OR (tm.assignment_scope = 'facility' AND tm.assigned_to IS NULL)
      )
      AND (
        tm.category_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.task_manager_category_employees ce WHERE ce.category_id = tm.category_id)
        OR EXISTS (SELECT 1 FROM public.task_manager_category_employees ce WHERE ce.category_id = tm.category_id AND ce.employee_id = p_employee_id)
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
      tm.priority_boost DESC,
      CASE WHEN tm.assigned_to = p_employee_id THEN 0 ELSE 1 END,
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
          'completed', etc.id IS NOT NULL,
          'scope', CASE WHEN tr.task_id = c.id THEN 'task' ELSE 'template' END,
          'hr_training_item_id', tr.hr_training_item_id,
          'sort_order', CASE WHEN tr.task_id = c.id THEN 0 ELSE 1000 END + row_number() OVER (ORDER BY tr.created_at)
        ) AS resource_row
        FROM public.task_manager_training_resources tr
        LEFT JOIN public.task_manager_employee_training_completions etc
          ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
        WHERE tr.hr_training_item_id IS NULL
          AND (
            tr.task_id = c.id
            OR (c.template_id IS NOT NULL AND tr.template_id = c.template_id AND tr.task_id IS NULL)
          )
        UNION ALL
        SELECT jsonb_array_elements(public.task_manager_hr_training_resource_rows(hti, tr.id, p_employee_id)) AS resource_row
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
      LEFT JOIN public.task_manager_employee_training_completions etc
        ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
      WHERE (
          tr.task_id = c.id
          OR (c.template_id IS NOT NULL AND tr.template_id = c.template_id AND tr.task_id IS NULL)
        )
        AND tr.is_required = true
        AND etc.id IS NULL
    ), 0),
    c.required_form_id,
    (SELECT ft.title FROM public.forms_templates ft WHERE ft.id = c.required_form_id),
    c.scheduled_for,
    c.priority_boost
  FROM candidate c;
END;
$$;

-- Patch generate_due_tasks to reset shift checklists each poll.
CREATE OR REPLACE FUNCTION public.task_manager_generate_due_tasks(p_business_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  v_missed integer;
  v_prev_missed integer;
  v_tz text;
  v_business_date date;
BEGIN
  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;

  v_business_date := (now() AT TIME ZONE v_tz)::date;
  v_missed := public.task_manager_mark_missed_occurrences(p_business_id);

  SELECT count(*)::integer INTO v_prev_missed
  FROM public.task_manager_tasks
  WHERE business_id = p_business_id
    AND occurrence_status = 'missed'
    AND missed_at > now() - interval '24 hours';

  INSERT INTO public.task_manager_tasks (
    business_id, template_id, title, description, category, category_id, priority,
    assignment_scope, assigned_to, status, available_at, due_at, scheduled_for,
    requires_photo, requires_notes, peer_review_required, instructions, checklist,
    required_form_id, priority_boost, created_by
  )
  SELECT
    t.business_id, t.id, t.title, t.description, t.category, t.category_id, t.priority,
    t.assignment_scope, t.default_assigned_to, 'to_do',
    scheduled_at, scheduled_at + make_interval(mins => t.due_window_minutes), scheduled_at,
    t.requires_photo, t.requires_notes, t.peer_review_required, t.instructions, t.checklist,
    t.required_form_id,
    CASE WHEN v_prev_missed > 0 THEN 1 ELSE 0 END,
    t.created_by
  FROM public.task_manager_templates t
  CROSS JOIN LATERAL (
    SELECT public.forms_slot_at(v_business_date, schedule_time::text, v_tz) AS scheduled_at
    FROM unnest(t.schedule_times) AS schedule_time
  ) s
  WHERE t.business_id = p_business_id
    AND t.status = 'active'
    AND t.recurrence_type = 'daily'
    AND cardinality(t.schedule_times) > 0
    AND scheduled_at <= now() + interval '30 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.forms_submissions fs
      WHERE fs.business_id = p_business_id
        AND fs.task_template_id = t.id
        AND fs.scheduled_for = scheduled_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.task_manager_tasks existing
      WHERE existing.business_id = p_business_id
        AND existing.template_id = t.id
        AND existing.scheduled_for = scheduled_at
    )
  ON CONFLICT (template_id, scheduled_for) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  PERFORM public.task_manager_reset_weekly_round_robin(p_business_id);
  PERFORM public.task_manager_reset_shift_checklists(p_business_id);
  RETURN v_inserted;
END;
$$;
