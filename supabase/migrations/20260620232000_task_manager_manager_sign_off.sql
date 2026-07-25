-- Manager dashboard sign-off: mark a due open task complete and attribute it to a staff member.

CREATE OR REPLACE FUNCTION public.task_manager_manager_sign_off_task(
  p_business_id uuid,
  p_task_id uuid,
  p_completed_by uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.task_manager_tasks%ROWTYPE;
  v_completion_id uuid;
  v_group_id uuid;
  v_open_in_group integer := 0;
  v_reset_cadence text;
  v_next_due timestamptz;
  v_occurrences integer;
  v_notes text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.task_manager_is_business_manager(p_business_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF p_completed_by IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select the employee who completed this task');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = p_business_id AND bu.user_id = p_completed_by
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Selected employee is not part of this business');
  END IF;

  SELECT * INTO v_task
  FROM public.task_manager_tasks
  WHERE id = p_task_id
    AND business_id = p_business_id
    AND status IN ('to_do', 'in_progress', 'blocked')
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Task is not open for sign-off');
  END IF;

  v_notes := NULLIF(trim(COALESCE(p_notes, '')), '');
  IF v_notes IS NULL THEN
    v_notes := 'Manager sign-off';
  END IF;

  INSERT INTO public.task_manager_completions (
    business_id, task_id, employee_id, notes, evidence, completed_checklist
  )
  VALUES (
    p_business_id,
    p_task_id,
    p_completed_by,
    v_notes,
    jsonb_build_object(
      'manager_sign_off', true,
      'signed_off_by', auth.uid()
    ),
    '[]'::jsonb
  )
  RETURNING id INTO v_completion_id;

  v_occurrences := COALESCE(v_task.occurrences_completed, 0) + 1;

  IF (v_task.due_schedule_mode = 'daily_required'
      OR (v_task.due_schedule_mode = 'frequency' AND v_task.schedule_type IS NOT NULL)) THEN
    IF v_task.due_schedule_mode = 'frequency'
       AND v_task.ends_on IS NOT NULL
       AND current_date > v_task.ends_on THEN
      UPDATE public.task_manager_tasks
      SET status = 'done', claimed_by = COALESCE(claimed_by, p_completed_by), completed_by = p_completed_by,
          completed_at = now(), manager_review_required = false, review_status = 'not_required',
          occurrences_completed = v_occurrences,
          completion_summary = jsonb_build_object('completion_id', v_completion_id, 'notes', v_notes, 'manager_sign_off', true)
      WHERE id = p_task_id;
    ELSIF v_task.due_schedule_mode = 'frequency'
          AND v_task.max_occurrences IS NOT NULL
          AND v_occurrences >= v_task.max_occurrences THEN
      UPDATE public.task_manager_tasks
      SET status = 'done', claimed_by = COALESCE(claimed_by, p_completed_by), completed_by = p_completed_by,
          completed_at = now(), manager_review_required = false, review_status = 'not_required',
          occurrences_completed = v_occurrences,
          completion_summary = jsonb_build_object('completion_id', v_completion_id, 'notes', v_notes, 'manager_sign_off', true)
      WHERE id = p_task_id;
    ELSIF v_task.due_schedule_mode = 'frequency' AND v_task.schedule_type = 'once' THEN
      UPDATE public.task_manager_tasks
      SET status = 'done', claimed_by = COALESCE(claimed_by, p_completed_by), completed_by = p_completed_by,
          completed_at = now(), manager_review_required = false, review_status = 'not_required',
          occurrences_completed = v_occurrences,
          completion_summary = jsonb_build_object('completion_id', v_completion_id, 'notes', v_notes, 'manager_sign_off', true)
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
      claimed_by = COALESCE(claimed_by, p_completed_by),
      completed_by = p_completed_by,
      completed_at = now(),
      manager_review_required = false,
      review_status = 'not_required',
      completion_summary = jsonb_build_object(
        'completion_id', v_completion_id,
        'notes', v_notes,
        'manager_sign_off', true
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

  INSERT INTO public.task_manager_activity (business_id, task_id, actor_id, action, details)
  VALUES (
    p_business_id,
    p_task_id,
    auth.uid(),
    'manager_sign_off',
    jsonb_build_object(
      'completion_id', v_completion_id,
      'completed_by', p_completed_by,
      'notes', v_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'completion_id', v_completion_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_manager_sign_off_task(uuid, uuid, uuid, text) TO authenticated;
