-- HR training linked to multiple tasks counts as completed once per employee per module
-- (e.g. Slush Puppie clean training on all four slushie deep-clean tasks).

CREATE OR REPLACE FUNCTION public.task_manager_hr_training_completed(
  p_business_id uuid,
  p_hr_training_item_id uuid,
  p_employee_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.hr_training_assignments a
      WHERE a.business_id = p_business_id
        AND a.training_item_id = p_hr_training_item_id
        AND a.employee_id = p_employee_id
        AND a.status <> 'cancelled'
        AND a.status IN ('completed', 'acknowledged')
    )
    OR EXISTS (
      SELECT 1
      FROM public.task_manager_training_resources tr
      JOIN public.task_manager_employee_training_completions c
        ON c.resource_id = tr.id
       AND c.employee_id = p_employee_id
      WHERE tr.business_id = p_business_id
        AND tr.hr_training_item_id = p_hr_training_item_id
    );
$$;

CREATE OR REPLACE FUNCTION public.task_manager_training_resource_completed(
  p_business_id uuid,
  p_resource_id uuid,
  p_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hr_training_item_id uuid;
BEGIN
  IF p_employee_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT tr.hr_training_item_id
  INTO v_hr_training_item_id
  FROM public.task_manager_training_resources tr
  WHERE tr.id = p_resource_id
    AND tr.business_id = p_business_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_hr_training_item_id IS NOT NULL THEN
    RETURN public.task_manager_hr_training_completed(
      p_business_id,
      v_hr_training_item_id,
      p_employee_id
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.task_manager_employee_training_completions c
    WHERE c.resource_id = p_resource_id
      AND c.employee_id = p_employee_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_hr_training_resource_rows(
  p_training public.hr_training_items,
  p_resource_id uuid,
  p_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb;
  v_step jsonb;
  v_section jsonb;
  v_idx integer := 0;
  v_completed boolean;
BEGIN
  IF p_employee_id IS NULL THEN
    v_completed := false;
  ELSE
    v_completed := public.task_manager_hr_training_completed(
      p_training.business_id,
      p_training.id,
      p_employee_id
    );
  END IF;

  v_section := p_training.sections->'overview';
  IF v_section IS NOT NULL AND (COALESCE(v_section->>'text', '') <> '' OR COALESCE(v_section->>'image_url', '') <> '') THEN
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', p_resource_id,
      'title', p_training.title || ' - Overview',
      'resource_type', CASE WHEN COALESCE(v_section->>'image_url', '') <> '' THEN 'document' ELSE 'text' END,
      'resource_url', NULLIF(v_section->>'image_url', ''),
      'content', NULLIF(v_section->>'text', ''),
      'is_required', true,
      'completed', v_completed,
      'scope', 'hr_training',
      'hr_training_item_id', p_training.id,
      'sort_order', v_idx
    ));
    v_idx := v_idx + 1;
  END IF;

  FOR v_step IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_training.steps, '[]'::jsonb)) AS step(value)
    ORDER BY COALESCE((value->>'order')::integer, 9999)
  LOOP
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', p_resource_id,
      'title', COALESCE(NULLIF(v_step->>'title', ''), p_training.title || ' step'),
      'resource_type', CASE
        WHEN COALESCE(v_step->>'resource_url', '') <> '' THEN 'link'
        WHEN COALESCE(v_step->>'file_url', v_step->>'image_url', '') <> '' THEN 'document'
        ELSE 'text'
      END,
      'resource_url', COALESCE(NULLIF(v_step->>'file_url', ''), NULLIF(v_step->>'image_url', ''), NULLIF(v_step->>'resource_url', '')),
      'content', NULLIF(v_step->>'body', ''),
      'is_required', COALESCE((v_step->>'is_required')::boolean, true),
      'completed', v_completed,
      'scope', 'hr_training',
      'hr_training_item_id', p_training.id,
      'sort_order', v_idx
    ));
    v_idx := v_idx + 1;
  END LOOP;

  v_section := p_training.sections->'objectives';
  IF v_section IS NOT NULL AND (COALESCE(v_section->>'text', '') <> '' OR COALESCE(v_section->>'image_url', '') <> '') THEN
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', p_resource_id,
      'title', p_training.title || ' - Objectives',
      'resource_type', CASE WHEN COALESCE(v_section->>'image_url', '') <> '' THEN 'document' ELSE 'text' END,
      'resource_url', NULLIF(v_section->>'image_url', ''),
      'content', NULLIF(v_section->>'text', ''),
      'is_required', true,
      'completed', v_completed,
      'scope', 'hr_training',
      'hr_training_item_id', p_training.id,
      'sort_order', v_idx
    ));
    v_idx := v_idx + 1;
  END IF;

  v_section := p_training.sections->'notes';
  IF v_section IS NOT NULL AND (COALESCE(v_section->>'text', '') <> '' OR COALESCE(v_section->>'image_url', '') <> '') THEN
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', p_resource_id,
      'title', p_training.title || ' - Notes',
      'resource_type', CASE WHEN COALESCE(v_section->>'image_url', '') <> '' THEN 'document' ELSE 'text' END,
      'resource_url', NULLIF(v_section->>'image_url', ''),
      'content', COALESCE(NULLIF(v_section->>'text', ''), NULLIF(p_training.content, '')),
      'is_required', true,
      'completed', v_completed,
      'scope', 'hr_training',
      'hr_training_item_id', p_training.id,
      'sort_order', v_idx
    ));
  END IF;

  IF jsonb_array_length(v_rows) = 0 THEN
    v_rows := jsonb_build_array(jsonb_build_object(
      'id', p_resource_id,
      'title', p_training.title,
      'resource_type', CASE WHEN COALESCE(p_training.resource_url, '') <> '' THEN 'link' ELSE 'text' END,
      'resource_url', NULLIF(p_training.resource_url, ''),
      'content', COALESCE(NULLIF(p_training.description, ''), NULLIF(p_training.content, ''), 'Review this training module.'),
      'is_required', true,
      'completed', v_completed,
      'scope', 'hr_training',
      'hr_training_item_id', p_training.id,
      'sort_order', 0
    ));
  END IF;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_mark_training_complete(
  p_business_id uuid,
  p_resource_id uuid,
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
  v_hr_training_item_id uuid;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  SELECT hr_training_item_id INTO v_hr_training_item_id
  FROM public.task_manager_training_resources
  WHERE id = p_resource_id
    AND business_id = p_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Training resource not found');
  END IF;

  IF v_hr_training_item_id IS NOT NULL THEN
    INSERT INTO public.task_manager_employee_training_completions (business_id, resource_id, employee_id)
    SELECT p_business_id, tr.id, p_employee_id
    FROM public.task_manager_training_resources tr
    WHERE tr.business_id = p_business_id
      AND tr.hr_training_item_id = v_hr_training_item_id
    ON CONFLICT (resource_id, employee_id) DO NOTHING;
  ELSE
    INSERT INTO public.task_manager_employee_training_completions (business_id, resource_id, employee_id)
    VALUES (p_business_id, p_resource_id, p_employee_id)
    ON CONFLICT (resource_id, employee_id) DO NOTHING;
  END IF;

  IF v_hr_training_item_id IS NOT NULL THEN
    UPDATE public.hr_training_assignments
    SET
      status = CASE
        WHEN hr_training_assignments.status IN ('assigned', 'in_progress') THEN
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM public.hr_training_items hti
              WHERE hti.id = v_hr_training_item_id
                AND hti.requires_acknowledgement = true
            ) THEN 'acknowledged'
            ELSE 'completed'
          END
        ELSE hr_training_assignments.status
      END,
      started_at = COALESCE(started_at, now()),
      completed_at = COALESCE(completed_at, now()),
      acknowledged_at = COALESCE(acknowledged_at, now()),
      updated_at = now()
    WHERE business_id = p_business_id
      AND employee_id = p_employee_id
      AND training_item_id = v_hr_training_item_id
      AND status <> 'cancelled';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

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
  v_photo_required boolean := false;
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
  WHERE (tr.task_id = v_task.id OR (v_task.template_id IS NOT NULL AND tr.template_id = v_task.template_id AND tr.task_id IS NULL))
    AND tr.is_required = true
    AND NOT public.task_manager_training_resource_completed(p_business_id, tr.id, p_employee_id);

  IF v_missing_required > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Required training must be completed first', 'training_required', true);
  END IF;

  IF v_task.requires_notes AND length(trim(COALESCE(p_notes, ''))) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Completion notes are required');
  END IF;

  v_photo_required := public.task_manager_effective_photo_required(p_business_id, p_task_id, p_employee_id);

  IF v_photo_required AND COALESCE(p_evidence->>'photo_data_url', p_evidence->>'photo_url', '') = '' THEN
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

  IF v_should_manager_review THEN
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

  IF v_task.peer_review_required THEN
    PERFORM public.task_manager_maybe_add_peer_review_pool(
      p_business_id, p_task_id, v_completion_id, p_employee_id, v_task.title
    );
  END IF;

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

  IF v_should_manager_review THEN
    INSERT INTO public.task_manager_reviews (business_id, task_id, completion_id, review_type)
    VALUES (p_business_id, p_task_id, v_completion_id, 'manager');
  END IF;

  INSERT INTO public.task_manager_activity (business_id, task_id, actor_id, action, details)
  VALUES (
    p_business_id, p_task_id, p_employee_id, 'task_completed',
    jsonb_build_object('completion_id', v_completion_id, 'review_status', v_review_status, 'photo_required', v_photo_required)
  );

  RETURN jsonb_build_object(
    'success', true,
    'completion_id', v_completion_id,
    'review_status', v_review_status,
    'photo_required', v_photo_required
  );
END;
$$;

DROP FUNCTION IF EXISTS public.task_manager_get_next_facility_task(uuid);

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
    COALESCE(c.handoff_checklist, '[]'::jsonb)
  FROM candidate c;
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_hr_training_completed(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_training_resource_completed(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_get_next_facility_task(uuid, uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.task_manager_hr_training_completed(uuid, uuid, uuid) IS
  'True when an employee has completed an HR training module via assignment or any linked task resource.';
