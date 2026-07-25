-- Kiosk queue preview: open tasks in the order they would appear on the kiosk.

CREATE OR REPLACE FUNCTION public.task_manager_task_last_completed_at(
  p_task public.task_manager_tasks
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT max(c.completed_at)
  FROM public.task_manager_completions c
  JOIN public.task_manager_tasks t ON t.id = c.task_id
  WHERE t.business_id = p_task.business_id
    AND (
      (
        p_task.round_robin_group_id IS NOT NULL
        AND p_task.round_robin_slot_order IS NOT NULL
        AND t.round_robin_group_id = p_task.round_robin_group_id
        AND t.round_robin_slot_order = p_task.round_robin_slot_order
      )
      OR (
        (p_task.round_robin_group_id IS NULL OR p_task.round_robin_slot_order IS NULL)
        AND t.id = p_task.id
      )
    );
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
  category text
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
BEGIN
  IF auth.uid() IS NULL OR NOT public.task_manager_is_business_manager(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM public.task_manager_generate_due_tasks(p_business_id);
  PERFORM public.task_manager_reset_weekly_round_robin(p_business_id);
  PERFORM public.task_manager_reset_shift_checklists(p_business_id);

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
      CASE WHEN tm.handoff_at IS NOT NULL AND tm.status = 'in_progress' THEN 0 ELSE 1 END,
      CASE WHEN p_employee_id IS NOT NULL AND tm.handoff_by IS NOT NULL AND tm.handoff_by = p_employee_id THEN 1 ELSE 0 END,
      tm.handoff_at DESC NULLS LAST,
      tm.priority_boost DESC,
      CASE WHEN p_employee_id IS NOT NULL AND tm.assigned_to = p_employee_id THEN 0 ELSE 1 END,
      CASE tm.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      COALESCE(tm.due_at, tm.available_at) ASC,
      tm.round_robin_sort_order ASC NULLS LAST,
      tm.created_at ASC
    LIMIT 1;

    EXIT WHEN v_next.id IS NULL;

    v_position := v_position + 1;
    v_done_ids := array_append(v_done_ids, v_next.id);

    task_id := v_next.id;
    title := v_next.title;
    queue_position := v_position;
    status_flag := CASE
      WHEN public.task_manager_kiosk_queue_tier(v_next, p_business_id) = 3 THEN 'overdue'
      ELSE 'not_completed'
    END;
    last_completed_at := public.task_manager_task_last_completed_at(v_next);
    priority := v_next.priority;
    category := v_next.category;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_task_last_completed_at(public.task_manager_tasks) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_get_kiosk_queue_preview(uuid, uuid) TO authenticated;
