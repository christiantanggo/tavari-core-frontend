-- Skip = back of the line for now. Rotate through other tasks before retrying skipped ones.

ALTER TABLE public.task_manager_tasks
  ADD COLUMN IF NOT EXISTS skip_queue_stamp bigint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_task_manager_tasks_skip_queue_stamp
  ON public.task_manager_tasks (business_id, skip_queue_stamp)
  WHERE last_skipped_at IS NOT NULL;

-- Backfill stamps for already-skipped open tasks (oldest skip = lowest stamp).
WITH ranked AS (
  SELECT
    tm.id,
    ROW_NUMBER() OVER (
      PARTITION BY tm.business_id
      ORDER BY tm.last_skipped_at ASC NULLS LAST, tm.created_at ASC, tm.id ASC
    )::bigint AS stamp
  FROM public.task_manager_tasks tm
  WHERE tm.last_skipped_at IS NOT NULL
    AND tm.status IN ('to_do', 'in_progress', 'blocked')
)
UPDATE public.task_manager_tasks tm
SET skip_queue_stamp = ranked.stamp
FROM ranked
WHERE tm.id = ranked.id
  AND tm.skip_queue_stamp = 0;

CREATE OR REPLACE FUNCTION public.task_manager_next_skip_queue_stamp(p_business_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stamp bigint;
BEGIN
  SELECT COALESCE(MAX(skip_queue_stamp), 0) INTO v_stamp
  FROM public.task_manager_tasks
  WHERE business_id = p_business_id;

  RETURN v_stamp + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_skip_task(
  p_business_id uuid,
  p_task_id uuid,
  p_employee_id uuid,
  p_pin text,
  p_reason text,
  p_notes text,
  p_scope text DEFAULT 'task'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified uuid;
  v_task public.task_manager_tasks%ROWTYPE;
  v_cat public.task_manager_categories%ROWTYPE;
  v_reason text := lower(trim(COALESCE(p_reason, '')));
  v_scope text := lower(trim(COALESCE(p_scope, 'task')));
  v_target_id uuid;
  v_skipped integer := 0;
  v_stale_minutes integer := 45;
  v_skip_stamp bigint;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  IF v_reason NOT IN ('customer_location_busy', 'area_being_repaired', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select a valid skip reason');
  END IF;

  IF length(trim(COALESCE(p_notes, ''))) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Notes are required when skipping a task');
  END IF;

  IF v_scope NOT IN ('task', 'category', 'location_zone') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select a valid skip scope');
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

  IF v_task.assigned_to IS NOT NULL AND v_task.assigned_to <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'This task is assigned to another employee');
  END IF;

  IF v_task.claimed_by IS NOT NULL
     AND v_task.claimed_by <> p_employee_id
     AND NOT public.task_manager_kiosk_task_claim_available(
       v_task.claimed_by,
       v_task.status,
       v_task.handoff_at,
       v_task.claimed_at,
       p_employee_id,
       v_stale_minutes
     )
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'This task is being worked on by another employee');
  END IF;

  SELECT * INTO v_cat
  FROM public.task_manager_categories
  WHERE id = v_task.category_id;

  IF v_task.due_schedule_mode IN ('opening_checklist', 'closing_checklist', 'kiosk_checklist')
     OR COALESCE(v_cat.kiosk_checklist_button, false) IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'Use the checklist screen to update this item');
  END IF;

  IF v_scope = 'category' AND v_task.category_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This task has no category to skip as a group');
  END IF;

  IF v_scope = 'location_zone'
     AND (v_cat.id IS NULL OR COALESCE(v_cat.location_sensitivity, 'none') = 'none') THEN
    RETURN jsonb_build_object('success', false, 'error', 'This task is not in a skippable location zone');
  END IF;

  FOR v_target_id IN
    SELECT sid
    FROM public.task_manager_skip_scope_matches(p_business_id, p_task_id, v_scope) AS sid
  LOOP
    v_skip_stamp := public.task_manager_next_skip_queue_stamp(p_business_id);

    UPDATE public.task_manager_tasks
    SET
      status = 'to_do',
      claimed_by = NULL,
      claimed_at = NULL,
      handoff_notes = NULL,
      handoff_at = NULL,
      handoff_by = NULL,
      handoff_checklist = NULL,
      skip_count = COALESCE(skip_count, 0) + 1,
      last_skipped_at = now(),
      last_skipped_by = p_employee_id,
      skip_queue_stamp = v_skip_stamp
    WHERE id = v_target_id
      AND business_id = p_business_id
      AND status IN ('to_do', 'in_progress')
      AND (
        claimed_by IS NULL
        OR claimed_by = p_employee_id
        OR public.task_manager_kiosk_task_claim_available(
          claimed_by,
          status,
          handoff_at,
          claimed_at,
          p_employee_id,
          v_stale_minutes
        )
      );

    IF FOUND THEN
      v_skipped := v_skipped + 1;
      INSERT INTO public.task_manager_activity (business_id, task_id, actor_id, action, details)
      VALUES (
        p_business_id,
        v_target_id,
        p_employee_id,
        'task_skipped',
        jsonb_build_object(
          'reason', v_reason,
          'notes', trim(p_notes),
          'scope', v_scope,
          'anchor_task_id', p_task_id,
          'category_id', v_task.category_id,
          'location_sensitivity', COALESCE(v_cat.location_sensitivity, 'none'),
          'skip_queue_stamp', v_skip_stamp
        )
      );
    END IF;
  END LOOP;

  IF v_skipped = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tasks were available to skip');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'skipped_count', v_skipped,
    'scope', v_scope
  );
END;
$$;

DROP FUNCTION IF EXISTS public.task_manager_get_next_facility_task(uuid);
DROP FUNCTION IF EXISTS public.task_manager_get_next_facility_task(uuid, uuid);

CREATE OR REPLACE FUNCTION public.task_manager_get_next_facility_task(
  p_business_id uuid,
  p_employee_id uuid DEFAULT NULL,
  p_exclude_task_id uuid DEFAULT NULL
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
    ORDER BY
      tm.round_robin_group_id,
      CASE WHEN tm.last_skipped_at IS NULL THEN 0 ELSE 1 END ASC,
      tm.skip_queue_stamp ASC,
      tm.last_skipped_at ASC NULLS FIRST,
      tm.round_robin_sort_order ASC NULLS LAST,
      tm.created_at ASC
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
      CASE WHEN p_exclude_task_id IS NOT NULL AND tm.id = p_exclude_task_id THEN 1 ELSE 0 END ASC,
      public.task_manager_kiosk_queue_tier(tm, p_business_id) ASC,
      public.task_manager_task_queue_busy_sort_key(tm.due_schedule_mode, COALESCE(cat.location_sensitivity, 'none'), v_signals) ASC,
      public.task_manager_kiosk_today_priority_sort_key(tm.due_schedule_mode, tm.today_priority_sort_order) ASC,
      CASE WHEN tm.handoff_at IS NOT NULL AND tm.status = 'in_progress' THEN 0 ELSE 1 END,
      CASE WHEN tm.last_skipped_at IS NULL THEN 0 ELSE 1 END ASC,
      tm.skip_queue_stamp ASC,
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

  -- If the just-skipped task was the only candidate, restart the rotation cycle.
  IF v_task_id IS NULL AND p_exclude_task_id IS NOT NULL THEN
    WITH round_robin_heads AS (
      SELECT DISTINCT ON (tm.round_robin_group_id)
        tm.round_robin_group_id,
        tm.id AS head_task_id
      FROM public.task_manager_tasks tm
      WHERE tm.business_id = p_business_id
        AND tm.round_robin_group_id IS NOT NULL
        AND tm.status IN ('to_do', 'in_progress')
      ORDER BY
        tm.round_robin_group_id,
        CASE WHEN tm.last_skipped_at IS NULL THEN 0 ELSE 1 END ASC,
        tm.skip_queue_stamp ASC,
        tm.last_skipped_at ASC NULLS FIRST,
        tm.round_robin_sort_order ASC NULLS LAST,
        tm.created_at ASC
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
        CASE WHEN tm.last_skipped_at IS NULL THEN 0 ELSE 1 END ASC,
        tm.skip_queue_stamp ASC,
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
  END IF;

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

GRANT EXECUTE ON FUNCTION public.task_manager_get_next_facility_task(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_skip_task(uuid, uuid, uuid, text, text, text, text) TO anon, authenticated;

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
      ORDER BY
        CASE WHEN h.last_skipped_at IS NULL THEN 0 ELSE 1 END ASC,
        h.skip_queue_stamp ASC,
        h.last_skipped_at ASC NULLS FIRST,
        h.round_robin_sort_order ASC NULLS LAST,
        h.created_at ASC
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
      CASE WHEN tm.last_skipped_at IS NULL THEN 0 ELSE 1 END ASC,
      tm.skip_queue_stamp ASC,
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
