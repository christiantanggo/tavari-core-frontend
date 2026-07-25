-- Partial completion handoff: notes for the next worker, surfaced first within queue tier.

ALTER TABLE public.task_manager_tasks
  ADD COLUMN IF NOT EXISTS handoff_notes text,
  ADD COLUMN IF NOT EXISTS handoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS handoff_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS handoff_checklist jsonb;

CREATE INDEX IF NOT EXISTS idx_task_manager_tasks_handoff_queue
  ON public.task_manager_tasks (business_id, handoff_at DESC NULLS LAST)
  WHERE handoff_at IS NOT NULL AND status = 'in_progress';

CREATE OR REPLACE FUNCTION public.task_manager_handoff_task(
  p_business_id uuid,
  p_task_id uuid,
  p_employee_id uuid,
  p_pin text,
  p_notes text,
  p_completed_checklist jsonb DEFAULT '[]'::jsonb
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
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  IF length(trim(COALESCE(p_notes, ''))) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Notes for the next person are required');
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

  SELECT * INTO v_cat
  FROM public.task_manager_categories
  WHERE id = v_task.category_id;

  IF v_task.due_schedule_mode IN ('opening_checklist', 'closing_checklist')
     OR COALESCE(v_cat.kiosk_checklist_button, false) IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'Use the checklist screen to update this item');
  END IF;

  UPDATE public.task_manager_tasks
  SET
    status = 'in_progress',
    claimed_by = NULL,
    handoff_notes = trim(p_notes),
    handoff_at = now(),
    handoff_by = p_employee_id,
    handoff_checklist = NULLIF(COALESCE(p_completed_checklist, '[]'::jsonb), '[]'::jsonb)
  WHERE id = p_task_id;

  INSERT INTO public.task_manager_activity (business_id, task_id, actor_id, action, details)
  VALUES (
    p_business_id,
    p_task_id,
    p_employee_id,
    'task_handoff',
    jsonb_build_object(
      'notes', trim(p_notes),
      'completed_checklist', COALESCE(p_completed_checklist, '[]'::jsonb)
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_handoff_task(uuid, uuid, uuid, text, text, jsonb) TO anon, authenticated;

-- Clear handoff metadata when a task is finished or reset.
CREATE OR REPLACE FUNCTION public.task_manager_clear_task_handoff(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.task_manager_tasks
  SET
    handoff_notes = NULL,
    handoff_at = NULL,
    handoff_by = NULL,
    handoff_checklist = NULL
  WHERE id = p_task_id;
END;
$$;

-- Patch complete_task to clear handoff after any completion path.
CREATE OR REPLACE FUNCTION public.task_manager_complete_task(
  p_business_id uuid,
  p_task_id uuid,
  p_employee_id uuid,
  p_pin text,
  p_notes text DEFAULT NULL,
  p_completed_checklist jsonb DEFAULT '[]'::jsonb,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified uuid;
  v_task public.task_manager_tasks%ROWTYPE;
  v_completion_id uuid;
  v_missing_required integer := 0;
  v_manager_review_rate numeric := 0;
  v_employee_hire_date date;
  v_prior_flags integer := 0;
  v_should_manager_review boolean := false;
  v_review_status text := 'not_required';
  v_group_id uuid;
  v_open_in_group integer := 0;
  v_reset_cadence text;
  v_next_due timestamptz;
  v_occurrences integer;
  v_result jsonb;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  SELECT * INTO v_task
  FROM public.task_manager_tasks
  WHERE id = p_task_id
    AND business_id = p_business_id
    AND status IN ('to_do', 'in_progress')
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Task is no longer available');
  END IF;

  IF v_task.assigned_to IS NOT NULL AND v_task.assigned_to <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'This task is assigned to another employee');
  END IF;

  SELECT count(*)::integer INTO v_missing_required
  FROM public.task_manager_training_resources tr
  LEFT JOIN public.task_manager_employee_training_completions etc
    ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
  WHERE (tr.task_id = v_task.id OR (v_task.template_id IS NOT NULL AND tr.template_id = v_task.template_id AND tr.task_id IS NULL))
    AND tr.is_required = true
    AND etc.id IS NULL;

  IF v_missing_required > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Required training must be completed first', 'training_required', true);
  END IF;

  IF v_task.requires_notes AND length(trim(COALESCE(p_notes, ''))) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Completion notes are required');
  END IF;

  IF v_task.requires_photo AND COALESCE(p_evidence->>'photo_data_url', p_evidence->>'photo_url', '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Photo evidence is required');
  END IF;

  SELECT COALESCE(t.manager_review_rate, 0), u.hire_date
    INTO v_manager_review_rate, v_employee_hire_date
  FROM public.task_manager_tasks task
  LEFT JOIN public.task_manager_templates t ON t.id = task.template_id
  LEFT JOIN public.users u ON u.id = p_employee_id
  WHERE task.id = p_task_id;

  SELECT count(*)::integer INTO v_prior_flags
  FROM public.task_manager_reviews r
  JOIN public.task_manager_tasks task ON task.id = r.task_id
  WHERE task.completed_by = p_employee_id
    AND r.status = 'flagged'
    AND r.created_at > now() - interval '90 days';

  v_manager_review_rate := LEAST(
    1,
    COALESCE(v_manager_review_rate, 0)
    + CASE WHEN v_employee_hire_date IS NOT NULL AND v_employee_hire_date > current_date - 90 THEN 0.15 ELSE 0 END
    + LEAST(0.35, v_prior_flags * 0.05)
  );
  v_should_manager_review := random() < v_manager_review_rate;

  IF v_task.peer_review_required THEN
    v_review_status := 'pending_peer';
  ELSIF v_should_manager_review THEN
    v_review_status := 'pending_manager';
  END IF;

  INSERT INTO public.task_manager_completions (
    business_id, task_id, employee_id, notes, evidence, completed_checklist
  )
  VALUES (
    p_business_id, p_task_id, p_employee_id, p_notes,
    COALESCE(p_evidence, '{}'::jsonb), COALESCE(p_completed_checklist, '[]'::jsonb)
  )
  RETURNING id INTO v_completion_id;

  v_occurrences := COALESCE(v_task.occurrences_completed, 0) + 1;

  IF (v_task.due_schedule_mode = 'daily_required'
      OR (v_task.due_schedule_mode = 'frequency' AND v_task.schedule_type IS NOT NULL)) THEN
    IF v_task.due_schedule_mode = 'frequency'
       AND v_task.ends_on IS NOT NULL
       AND current_date > v_task.ends_on THEN
      UPDATE public.task_manager_tasks
      SET status = 'done', claimed_by = COALESCE(claimed_by, p_employee_id), completed_by = p_employee_id,
          completed_at = now(), manager_review_required = v_should_manager_review, review_status = v_review_status,
          occurrences_completed = v_occurrences,
          completion_summary = jsonb_build_object('completion_id', v_completion_id, 'notes', p_notes, 'evidence', COALESCE(p_evidence, '{}'::jsonb))
      WHERE id = p_task_id;
    ELSIF v_task.due_schedule_mode = 'frequency'
          AND v_task.max_occurrences IS NOT NULL
          AND v_occurrences >= v_task.max_occurrences THEN
      UPDATE public.task_manager_tasks
      SET status = 'done', claimed_by = COALESCE(claimed_by, p_employee_id), completed_by = p_employee_id,
          completed_at = now(), manager_review_required = v_should_manager_review, review_status = v_review_status,
          occurrences_completed = v_occurrences,
          completion_summary = jsonb_build_object('completion_id', v_completion_id, 'notes', p_notes, 'evidence', COALESCE(p_evidence, '{}'::jsonb))
      WHERE id = p_task_id;
    ELSIF v_task.due_schedule_mode = 'frequency' AND v_task.schedule_type = 'once' THEN
      UPDATE public.task_manager_tasks
      SET status = 'done', claimed_by = COALESCE(claimed_by, p_employee_id), completed_by = p_employee_id,
          completed_at = now(), manager_review_required = v_should_manager_review, review_status = v_review_status,
          occurrences_completed = v_occurrences,
          completion_summary = jsonb_build_object('completion_id', v_completion_id, 'notes', p_notes, 'evidence', COALESCE(p_evidence, '{}'::jsonb))
      WHERE id = p_task_id;
    ELSE
      v_next_due := COALESCE(v_task.due_at, now());
      IF v_task.due_schedule_mode = 'daily_required'
         OR v_task.schedule_type = 'daily' THEN
        v_next_due := v_next_due + interval '1 day';
      ELSIF v_task.schedule_type = 'weekly' THEN
        v_next_due := v_next_due + interval '7 days';
      ELSIF v_task.schedule_type = 'biweekly' THEN
        v_next_due := v_next_due + interval '14 days';
      ELSIF v_task.schedule_type IN ('monthly', 'monthly_weekday') THEN
        v_next_due := v_next_due + interval '1 month';
      END IF;

      UPDATE public.task_manager_tasks
      SET
        status = 'to_do',
        claimed_by = NULL,
        completed_by = NULL,
        completed_at = NULL,
        available_at = v_next_due,
        due_at = v_next_due,
        occurrences_completed = v_occurrences,
        manager_review_required = false,
        review_status = 'not_required',
        completion_summary = '{}'::jsonb
      WHERE id = p_task_id;
    END IF;
  ELSE
    UPDATE public.task_manager_tasks
    SET
      status = 'done',
      claimed_by = COALESCE(claimed_by, p_employee_id),
      completed_by = p_employee_id,
      completed_at = now(),
      manager_review_required = v_should_manager_review,
      review_status = v_review_status,
      completion_summary = jsonb_build_object(
        'completion_id', v_completion_id,
        'notes', p_notes,
        'evidence', COALESCE(p_evidence, '{}'::jsonb)
      )
    WHERE id = p_task_id;
  END IF;

  PERFORM public.task_manager_clear_task_handoff(p_task_id);

  IF v_task.round_robin_group_id IS NOT NULL THEN
    v_group_id := v_task.round_robin_group_id;
    SELECT reset_cadence INTO v_reset_cadence
    FROM public.task_manager_round_robin_groups
    WHERE id = v_group_id;

    IF COALESCE(v_reset_cadence, 'on_complete') = 'on_complete' THEN
      SELECT count(*)::integer INTO v_open_in_group
      FROM public.task_manager_tasks
      WHERE round_robin_group_id = v_group_id
        AND business_id = p_business_id
        AND status IN ('to_do', 'in_progress');

      IF v_open_in_group = 0 THEN
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
        WHERE round_robin_group_id = v_group_id
          AND business_id = p_business_id
          AND status <> 'cancelled';
      END IF;
    END IF;
  END IF;

  IF v_task.peer_review_required THEN
    INSERT INTO public.task_manager_reviews (business_id, task_id, completion_id, review_type)
    VALUES (p_business_id, p_task_id, v_completion_id, 'peer');
  END IF;

  IF v_should_manager_review THEN
    INSERT INTO public.task_manager_reviews (business_id, task_id, completion_id, review_type)
    VALUES (p_business_id, p_task_id, v_completion_id, 'manager');
  END IF;

  INSERT INTO public.task_manager_activity (business_id, task_id, actor_id, action, details)
  VALUES (
    p_business_id, p_task_id, p_employee_id, 'task_completed',
    jsonb_build_object('completion_id', v_completion_id, 'review_status', v_review_status)
  );

  RETURN jsonb_build_object(
    'success', true,
    'completion_id', v_completion_id,
    'review_status', v_review_status
  );
END;
$$;

-- Handed-off tasks sort first within their queue tier (prefer another employee over the handoff author).
DROP FUNCTION IF EXISTS public.task_manager_get_next_task(uuid, uuid);

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
      AND tm.due_schedule_mode NOT IN ('opening_checklist', 'closing_checklist')
      AND COALESCE(cat.kiosk_checklist_button, false) = false
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
      CASE WHEN tm.handoff_at IS NOT NULL AND tm.status = 'in_progress' THEN 0 ELSE 1 END,
      CASE WHEN tm.handoff_by IS NOT NULL AND tm.handoff_by = p_employee_id THEN 1 ELSE 0 END,
      tm.handoff_at DESC NULLS LAST,
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
    c.priority_boost,
    c.module_link_key,
    (public.task_manager_module_link_def(c.module_link_key)->>'path')::text,
    (public.task_manager_module_link_def(c.module_link_key)->>'button_label')::text,
    public.task_manager_module_link_allowed(p_business_id, p_employee_id, c.module_link_key),
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

GRANT EXECUTE ON FUNCTION public.task_manager_get_next_task(uuid, uuid) TO anon, authenticated;

-- Clear handoff when shift checklists reset.
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

  UPDATE public.task_manager_tasks tm
  SET
    status = 'to_do',
    claimed_by = NULL,
    completed_by = NULL,
    completed_at = NULL,
    review_status = 'not_required',
    manager_review_required = false,
    completion_summary = '{}'::jsonb,
    handoff_notes = NULL,
    handoff_at = NULL,
    handoff_by = NULL,
    handoff_checklist = NULL,
    available_at = now()
  FROM public.task_manager_categories c
  WHERE tm.business_id = p_business_id
    AND tm.category_id = c.id
    AND (
      c.kiosk_checklist_button = true
      OR tm.due_schedule_mode IN ('opening_checklist', 'closing_checklist')
    )
    AND tm.status = 'done'
    AND (
      tm.completed_at IS NULL
      OR (tm.completed_at AT TIME ZONE v_tz)::date < v_today
    );

  GET DIAGNOSTICS v_reset_count = ROW_COUNT;
  RETURN v_reset_count;
END;
$$;
