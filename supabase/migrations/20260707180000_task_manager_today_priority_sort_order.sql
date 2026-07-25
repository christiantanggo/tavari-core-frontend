-- Manual sort order for manager "tonight's list" tasks on the kiosk queue.

ALTER TABLE public.task_manager_tasks
  ADD COLUMN IF NOT EXISTS today_priority_sort_order integer;

CREATE INDEX IF NOT EXISTS idx_task_manager_tasks_today_priority_sort
  ON public.task_manager_tasks (business_id, today_priority_sort_order)
  WHERE due_schedule_mode = 'today_priority';

WITH ranked AS (
  SELECT
    tm.id,
    (ROW_NUMBER() OVER (
      PARTITION BY tm.business_id
      ORDER BY tm.created_at ASC, tm.id ASC
    ) - 1)::integer AS sort_ord
  FROM public.task_manager_tasks tm
  WHERE tm.due_schedule_mode = 'today_priority'
    AND tm.today_priority_sort_order IS NULL
)
UPDATE public.task_manager_tasks tm
SET today_priority_sort_order = ranked.sort_ord
FROM ranked
WHERE tm.id = ranked.id;

CREATE OR REPLACE FUNCTION public.task_manager_kiosk_today_priority_sort_key(
  p_due_schedule_mode text,
  p_today_priority_sort_order integer
)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_due_schedule_mode = 'today_priority' THEN COALESCE(p_today_priority_sort_order, 2147483647)::bigint
    ELSE 0::bigint
  END;
$$;

-- Patch kiosk next-task ordering (full function from latest claims migration + sort key).
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
  v_task_id uuid;
  v_stale_minutes integer := 45;
BEGIN
  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'Employee id is required for kiosk task assignment';
  END IF;

  PERFORM public.task_manager_generate_due_tasks(p_business_id);
  PERFORM public.task_manager_reset_weekly_round_robin(p_business_id);
  PERFORM public.task_manager_reset_shift_checklists(p_business_id);
  PERFORM public.task_manager_release_stale_task_claims(p_business_id, v_stale_minutes);

  v_signals := public.task_manager_facility_busy_signals(p_business_id);

  SELECT tm.id INTO v_task_id
  FROM public.task_manager_tasks tm
  LEFT JOIN public.task_manager_categories cat ON cat.id = tm.category_id
  WHERE tm.business_id = p_business_id
    AND tm.claimed_by = p_employee_id
    AND tm.status = 'in_progress'
    AND tm.available_at <= now()
    AND tm.due_schedule_mode NOT IN ('opening_checklist', 'closing_checklist', 'kiosk_checklist')
    AND COALESCE(cat.kiosk_checklist_button, false) = false
    AND tm.assignment_scope = 'facility'
    AND tm.assigned_to IS NULL
  ORDER BY tm.claimed_at DESC NULLS LAST, tm.created_at DESC
  LIMIT 1;

  IF v_task_id IS NOT NULL THEN
    UPDATE public.task_manager_tasks
    SET claimed_at = now()
    WHERE id = v_task_id;

    RETURN QUERY
    SELECT * FROM public.task_manager_facility_task_payload(
      p_business_id,
      p_employee_id,
      v_task_id,
      v_signals
    );
    RETURN;
  END IF;

  WITH round_robin_heads AS (
    SELECT DISTINCT ON (tm.round_robin_group_id)
      tm.round_robin_group_id,
      tm.id AS head_task_id
    FROM public.task_manager_tasks tm
    WHERE tm.business_id = p_business_id
      AND tm.round_robin_group_id IS NOT NULL
      AND tm.status IN ('to_do', 'in_progress')
    ORDER BY tm.round_robin_group_id, tm.round_robin_sort_order ASC NULLS LAST, tm.created_at ASC
  ),
  pick AS (
    SELECT tm.id
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
      AND public.task_manager_kiosk_task_claim_available(
        tm.claimed_by,
        tm.status,
        tm.handoff_at,
        tm.claimed_at,
        p_employee_id,
        v_stale_minutes
      )
    ORDER BY
      public.task_manager_kiosk_queue_tier(tm, p_business_id) ASC,
      public.task_manager_task_queue_busy_sort_key(tm.due_schedule_mode, COALESCE(cat.location_sensitivity, 'none'), v_signals) ASC,
      public.task_manager_kiosk_today_priority_sort_key(tm.due_schedule_mode, tm.today_priority_sort_order) ASC,
      CASE WHEN tm.handoff_at IS NOT NULL AND tm.status = 'in_progress' THEN 0 ELSE 1 END,
      tm.last_skipped_at ASC NULLS FIRST,
      tm.handoff_at DESC NULLS LAST,
      tm.priority_boost DESC,
      CASE tm.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      COALESCE(tm.due_at, tm.available_at) ASC,
      tm.round_robin_sort_order ASC NULLS LAST,
      tm.created_at ASC
    LIMIT 1
    FOR UPDATE OF tm SKIP LOCKED
  )
  UPDATE public.task_manager_tasks tm
  SET
    status = 'in_progress',
    claimed_by = p_employee_id,
    claimed_at = now()
  FROM pick
  WHERE tm.id = pick.id
  RETURNING tm.id INTO v_task_id;

  IF v_task_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT * FROM public.task_manager_facility_task_payload(
    p_business_id,
    p_employee_id,
    v_task_id,
    v_signals
  );
END;
$$;

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
  v_stale_minutes integer := 45;
BEGIN
  IF auth.uid() IS NULL OR NOT public.task_manager_is_business_manager(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM public.task_manager_generate_due_tasks(p_business_id);
  PERFORM public.task_manager_reset_weekly_round_robin(p_business_id);
  PERFORM public.task_manager_reset_shift_checklists(p_business_id);
  PERFORM public.task_manager_release_stale_task_claims(p_business_id, v_stale_minutes);

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
        OR public.task_manager_kiosk_task_claim_available(
          tm.claimed_by,
          tm.status,
          tm.handoff_at,
          tm.claimed_at,
          p_employee_id,
          v_stale_minutes
        )
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
      public.task_manager_kiosk_today_priority_sort_key(tm.due_schedule_mode, tm.today_priority_sort_order) ASC,
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
