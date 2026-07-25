-- Block future date/time selection for form completion (business timezone).

CREATE OR REPLACE FUNCTION public.forms_get_form_schedule_info(
  p_business_id uuid,
  p_form_template_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form public.forms_templates%ROWTYPE;
  v_schedule_times text[];
  v_linked jsonb;
  v_tz text;
BEGIN
  SELECT * INTO v_form
  FROM public.forms_templates
  WHERE id = p_form_template_id
    AND business_id = p_business_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Form not found');
  END IF;

  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'schedule_times', t.schedule_times,
      'due_window_minutes', t.due_window_minutes,
      'recurrence_type', t.recurrence_type
    ) ORDER BY t.created_at
  ), '[]'::jsonb)
  INTO v_linked
  FROM public.task_manager_templates t
  WHERE t.business_id = p_business_id
    AND t.required_form_id = p_form_template_id
    AND t.status = 'active';

  SELECT COALESCE(array_agg(DISTINCT slot_time ORDER BY slot_time), ARRAY[]::text[])
  INTO v_schedule_times
  FROM (
    SELECT left(st::text, 5) AS slot_time
    FROM public.task_manager_templates t
    CROSS JOIN unnest(t.schedule_times) AS st
    WHERE t.business_id = p_business_id
      AND t.required_form_id = p_form_template_id
      AND t.status = 'active'
      AND t.recurrence_type = 'daily'
  ) slots;

  RETURN jsonb_build_object(
    'success', true,
    'form', jsonb_build_object('id', v_form.id, 'title', v_form.title, 'description', v_form.description),
    'linked_templates', v_linked,
    'schedule_times', to_jsonb(v_schedule_times),
    'uses_scheduled_slots', COALESCE(cardinality(v_schedule_times), 0) > 0,
    'timezone', v_tz,
    'max_date', (now() AT TIME ZONE v_tz)::date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.forms_check_completion_slot(
  p_business_id uuid,
  p_form_template_id uuid,
  p_scheduled_date date,
  p_scheduled_time text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form public.forms_templates%ROWTYPE;
  v_tz text;
  v_today date;
  v_scheduled timestamptz;
  v_task_template_id uuid;
  v_occurrence_key text;
  v_submission record;
  v_task record;
  v_time text;
BEGIN
  IF p_scheduled_date IS NULL OR p_scheduled_time IS NULL OR length(trim(p_scheduled_time)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Date and time are required');
  END IF;

  SELECT * INTO v_form
  FROM public.forms_templates
  WHERE id = p_form_template_id
    AND business_id = p_business_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Form not found');
  END IF;

  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;

  v_today := (now() AT TIME ZONE v_tz)::date;

  IF p_scheduled_date > v_today THEN
    RETURN jsonb_build_object(
      'success', true,
      'allowed', false,
      'status', 'future',
      'message', 'You cannot complete a check for a future date.',
      'max_date', v_today
    );
  END IF;

  v_time := left(trim(p_scheduled_time), 5);
  v_scheduled := (p_scheduled_date + v_time::time) AT TIME ZONE v_tz;

  IF v_scheduled > now() THEN
    RETURN jsonb_build_object(
      'success', true,
      'allowed', false,
      'status', 'future',
      'message', 'You cannot complete a check for a future date or time.',
      'max_date', v_today
    );
  END IF;

  SELECT id INTO v_task_template_id
  FROM public.task_manager_templates
  WHERE business_id = p_business_id
    AND required_form_id = p_form_template_id
    AND status = 'active'
  ORDER BY created_at
  LIMIT 1;

  IF v_task_template_id IS NOT NULL THEN
    v_occurrence_key := public.forms_build_occurrence_key(v_task_template_id, v_scheduled);
  ELSE
    v_occurrence_key := p_form_template_id::text || ':' || to_char(v_scheduled AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  END IF;

  SELECT fs.id, fs.submitted_at, fs.employee_id,
         COALESCE(u.full_name, trim(concat_ws(' ', u.first_name, u.last_name)), 'Staff') AS employee_name
  INTO v_submission
  FROM public.forms_submissions fs
  LEFT JOIN public.users u ON u.id = fs.employee_id
  WHERE fs.business_id = p_business_id
    AND fs.occurrence_key = v_occurrence_key
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'allowed', false,
      'status', 'completed',
      'message', 'This check was already completed for this date and time.',
      'occurrence_key', v_occurrence_key,
      'scheduled_for', v_scheduled,
      'task_template_id', v_task_template_id,
      'submission', jsonb_build_object(
        'id', v_submission.id,
        'submitted_at', v_submission.submitted_at,
        'employee_name', v_submission.employee_name
      )
    );
  END IF;

  SELECT t.id, t.status, t.occurrence_status, t.missed_at
  INTO v_task
  FROM public.task_manager_tasks t
  WHERE t.business_id = p_business_id
    AND t.scheduled_for = v_scheduled
    AND (
      (v_task_template_id IS NOT NULL AND t.template_id = v_task_template_id)
      OR t.required_form_id = p_form_template_id
    )
  ORDER BY t.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_task.status = 'done' OR v_task.occurrence_status = 'satisfied' THEN
      RETURN jsonb_build_object(
        'success', true,
        'allowed', false,
        'status', 'completed',
        'message', 'This check was already completed for this date and time.',
        'occurrence_key', v_occurrence_key,
        'scheduled_for', v_scheduled,
        'task_template_id', v_task_template_id,
        'task_id', v_task.id
      );
    END IF;

    IF v_task.status = 'incomplete' OR v_task.occurrence_status = 'missed' THEN
      RETURN jsonb_build_object(
        'success', true,
        'allowed', false,
        'status', 'missed',
        'message', 'This check was marked incomplete because the window was missed. Choose a different date or time.',
        'occurrence_key', v_occurrence_key,
        'scheduled_for', v_scheduled,
        'task_template_id', v_task_template_id,
        'task_id', v_task.id,
        'missed_at', v_task.missed_at
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'allowed', true,
    'status', 'available',
    'message', 'You can complete this check for the selected date and time.',
    'occurrence_key', v_occurrence_key,
    'scheduled_for', v_scheduled,
    'task_template_id', v_task_template_id,
    'task_id', CASE WHEN FOUND AND v_task.status IN ('to_do', 'in_progress', 'backlog') THEN v_task.id ELSE NULL END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.forms_get_form_schedule_info(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forms_check_completion_slot(uuid, uuid, date, text) TO authenticated;
