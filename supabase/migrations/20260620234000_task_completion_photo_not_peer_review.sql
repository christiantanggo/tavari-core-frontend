-- Decouple completion photo from peer review: photo on complete only when requires_photo is true.
-- Peer review verification photo remains required in task_manager_submit_kiosk_peer_review.

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
    jsonb_build_object('completion_id', v_completion_id, 'review_status', v_review_status)
  );

  RETURN jsonb_build_object(
    'success', true,
    'completion_id', v_completion_id,
    'review_status', v_review_status
  );
END;
$$;
