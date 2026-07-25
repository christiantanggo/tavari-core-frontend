-- Enforce form submission windows: block expired slots, missed earlier slots, and backdating
-- after a later slot on the same day was already submitted.

CREATE OR REPLACE FUNCTION public.forms_parse_time_text(p_time text)
RETURNS time
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_raw text := lower(trim(coalesce(p_time, '')));
  v_match text[];
BEGIN
  IF v_raw = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN v_raw::time;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  v_match := regexp_match(v_raw, '^(\d{1,2}):(\d{2})\s*(am|pm)?$');
  IF v_match IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN to_timestamp(
    lpad(v_match[1], 2, '0') || ':' || v_match[2] || coalesce(' ' || v_match[3], ''),
    'HH12:MI AM'
  )::time;
END;
$$;

CREATE OR REPLACE FUNCTION public.forms_slot_at(
  p_date date,
  p_time text,
  p_tz text
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ((p_date + public.forms_parse_time_text(p_time)) AT TIME ZONE coalesce(nullif(trim(p_tz), ''), 'America/Toronto'));
$$;

CREATE OR REPLACE FUNCTION public.forms_get_linked_task_template(
  p_business_id uuid,
  p_form_template_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.task_manager_templates
  WHERE business_id = p_business_id
    AND required_form_id = p_form_template_id
    AND status = 'active'
  ORDER BY created_at
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.forms_validate_submission_slot(
  p_business_id uuid,
  p_form_template_id uuid,
  p_scheduled timestamptz,
  p_task_template_id uuid DEFAULT NULL,
  p_manager_override boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form public.forms_templates%ROWTYPE;
  v_tz text;
  v_task_template_id uuid;
  v_due_window integer := 60;
  v_schedule_times text[];
  v_occurrence_key text;
  v_submission record;
  v_task record;
  v_scheduled_date date;
  v_due_deadline timestamptz;
  v_later_submission record;
  v_later_slot timestamptz;
  v_schedule_time text;
BEGIN
  IF p_scheduled IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Scheduled time is required');
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

  v_task_template_id := COALESCE(p_task_template_id, public.forms_get_linked_task_template(p_business_id, p_form_template_id));

  IF v_task_template_id IS NOT NULL THEN
    SELECT COALESCE(due_window_minutes, 60), schedule_times
    INTO v_due_window, v_schedule_times
    FROM public.task_manager_templates
    WHERE id = v_task_template_id
      AND business_id = p_business_id;
  END IF;

  v_scheduled_date := (p_scheduled AT TIME ZONE v_tz)::date;

  IF p_scheduled > now() THEN
    RETURN jsonb_build_object(
      'success', true,
      'allowed', false,
      'status', 'future',
      'message', 'You cannot complete a check for a future date or time.',
      'scheduled_for', p_scheduled,
      'task_template_id', v_task_template_id
    );
  END IF;

  IF v_task_template_id IS NOT NULL THEN
    v_occurrence_key := public.forms_build_occurrence_key(v_task_template_id, p_scheduled);
  ELSE
    v_occurrence_key := p_form_template_id::text || ':' || to_char(p_scheduled AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
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
      'scheduled_for', p_scheduled,
      'task_template_id', v_task_template_id,
      'submission', jsonb_build_object(
        'id', v_submission.id,
        'submitted_at', v_submission.submitted_at,
        'employee_name', v_submission.employee_name
      )
    );
  END IF;

  SELECT fs.id, fs.submitted_at, fs.scheduled_for,
         COALESCE(u.full_name, trim(concat_ws(' ', u.first_name, u.last_name)), 'Staff') AS employee_name
  INTO v_later_submission
  FROM public.forms_submissions fs
  LEFT JOIN public.users u ON u.id = fs.employee_id
  WHERE fs.business_id = p_business_id
    AND fs.form_template_id = p_form_template_id
    AND (fs.scheduled_for AT TIME ZONE v_tz)::date = v_scheduled_date
    AND fs.scheduled_for > p_scheduled
  ORDER BY fs.scheduled_for ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'allowed', false,
      'status', 'missed',
      'message', 'This check can no longer be submitted — a later check for this day was already completed.',
      'occurrence_key', v_occurrence_key,
      'scheduled_for', p_scheduled,
      'task_template_id', v_task_template_id,
      'submission', jsonb_build_object(
        'id', v_later_submission.id,
        'submitted_at', v_later_submission.submitted_at,
        'scheduled_for', v_later_submission.scheduled_for,
        'employee_name', v_later_submission.employee_name
      )
    );
  END IF;

  v_due_deadline := p_scheduled + make_interval(mins => COALESCE(v_due_window, 60));

  IF COALESCE(cardinality(v_schedule_times), 0) > 0 THEN
    FOREACH v_schedule_time IN ARRAY v_schedule_times
    LOOP
      v_later_slot := public.forms_slot_at(v_scheduled_date, v_schedule_time, v_tz);
      IF v_later_slot > p_scheduled AND v_later_slot <= now() THEN
        RETURN jsonb_build_object(
          'success', true,
          'allowed', false,
          'status', 'missed',
          'message', 'The window for this check has passed. A later scheduled check time for this day has already started.',
          'occurrence_key', v_occurrence_key,
          'scheduled_for', p_scheduled,
          'task_template_id', v_task_template_id,
          'missed_at', now()
        );
      END IF;
    END LOOP;
  END IF;

  IF now() > v_due_deadline AND NOT p_manager_override THEN
    RETURN jsonb_build_object(
      'success', true,
      'allowed', false,
      'status', 'missed',
      'message', 'The due window for this check has passed. Contact a manager if you need to submit late.',
      'occurrence_key', v_occurrence_key,
      'scheduled_for', p_scheduled,
      'task_template_id', v_task_template_id,
      'due_deadline', v_due_deadline
    );
  END IF;

  SELECT t.id, t.status, t.occurrence_status, t.missed_at
  INTO v_task
  FROM public.task_manager_tasks t
  WHERE t.business_id = p_business_id
    AND t.scheduled_for = p_scheduled
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
        'scheduled_for', p_scheduled,
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
        'scheduled_for', p_scheduled,
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
    'scheduled_for', p_scheduled,
    'task_template_id', v_task_template_id,
    'task_id', CASE WHEN FOUND AND v_task.status IN ('to_do', 'in_progress', 'backlog') THEN v_task.id ELSE NULL END
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
  v_tz text;
  v_scheduled timestamptz;
  v_time text;
  v_today date;
  v_validate jsonb;
BEGIN
  IF p_scheduled_date IS NULL OR p_scheduled_time IS NULL OR length(trim(p_scheduled_time)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Date and time are required');
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

  v_time := trim(p_scheduled_time);
  v_scheduled := public.forms_slot_at(p_scheduled_date, v_time, v_tz);

  IF v_scheduled IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid scheduled time');
  END IF;

  v_validate := public.forms_validate_submission_slot(
    p_business_id,
    p_form_template_id,
    v_scheduled,
    NULL,
    false
  );

  IF COALESCE((v_validate->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_validate;
  END IF;

  RETURN v_validate || jsonb_build_object('max_date', v_today);
END;
$$;

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
    SELECT to_char(public.forms_parse_time_text(st::text), 'HH24:MI') AS slot_time
    FROM public.task_manager_templates t
    CROSS JOIN unnest(t.schedule_times) AS st
    WHERE t.business_id = p_business_id
      AND t.required_form_id = p_form_template_id
      AND t.status = 'active'
      AND t.recurrence_type = 'daily'
      AND public.forms_parse_time_text(st::text) IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.task_manager_mark_missed_occurrences(p_business_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_row record;
  v_next_boost integer;
  v_tz text;
BEGIN
  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;

  FOR v_row IN
    SELECT t.id, t.template_id, t.scheduled_for, t.title
    FROM public.task_manager_tasks t
    WHERE t.business_id = p_business_id
      AND t.template_id IS NOT NULL
      AND t.status IN ('to_do', 'in_progress')
      AND t.scheduled_for IS NOT NULL
      AND (
        EXISTS (
          SELECT 1
          FROM public.task_manager_templates tmpl
          CROSS JOIN LATERAL unnest(tmpl.schedule_times) AS st(schedule_time)
          CROSS JOIN LATERAL (
            SELECT public.forms_slot_at(
              (t.scheduled_for AT TIME ZONE v_tz)::date,
              st.schedule_time::text,
              v_tz
            ) AS slot_at
          ) slots
          WHERE tmpl.id = t.template_id
            AND slots.slot_at > t.scheduled_for
            AND slots.slot_at <= now()
        )
        OR EXISTS (
          SELECT 1
          FROM public.forms_submissions fs
          WHERE fs.business_id = p_business_id
            AND fs.task_template_id = t.template_id
            AND (fs.scheduled_for AT TIME ZONE v_tz)::date = (t.scheduled_for AT TIME ZONE v_tz)::date
            AND fs.scheduled_for > t.scheduled_for
        )
        OR now() > t.scheduled_for + make_interval(mins => COALESCE(
          (SELECT due_window_minutes FROM public.task_manager_templates WHERE id = t.template_id),
          60
        ))
      )
  LOOP
    UPDATE public.task_manager_tasks
    SET
      status = 'incomplete',
      occurrence_status = 'missed',
      missed_at = now(),
      review_status = 'flagged',
      manager_review_required = true
    WHERE id = v_row.id;

    INSERT INTO public.forms_manager_alerts (business_id, alert_type, task_id, form_template_id, message, details)
    SELECT
      p_business_id,
      'missed_occurrence',
      v_row.id,
      tmpl.required_form_id,
      'Missed task occurrence: ' || v_row.title,
      jsonb_build_object(
        'task_id', v_row.id,
        'template_id', v_row.template_id,
        'scheduled_for', v_row.scheduled_for
      )
    FROM public.task_manager_templates tmpl
    WHERE tmpl.id = v_row.template_id;

    SELECT COALESCE(MAX(priority_boost), 0) + 1 INTO v_next_boost
    FROM public.task_manager_tasks
    WHERE business_id = p_business_id
      AND template_id = v_row.template_id
      AND scheduled_for > v_row.scheduled_for
      AND status IN ('to_do', 'in_progress', 'backlog');

    UPDATE public.task_manager_tasks
    SET priority_boost = GREATEST(priority_boost, v_next_boost)
    WHERE business_id = p_business_id
      AND template_id = v_row.template_id
      AND status IN ('to_do', 'in_progress', 'backlog')
      AND scheduled_for > v_row.scheduled_for;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Patch forms_submit: enforce slot validation server-side (not just in the UI picker).
CREATE OR REPLACE FUNCTION public.forms_submit(
  p_business_id uuid,
  p_form_template_id uuid,
  p_employee_id uuid,
  p_pin text,
  p_responses jsonb,
  p_task_id uuid DEFAULT NULL,
  p_task_template_id uuid DEFAULT NULL,
  p_scheduled_for timestamptz DEFAULT NULL,
  p_manager_override boolean DEFAULT false,
  p_override_explanation text DEFAULT NULL,
  p_submitted_via text DEFAULT 'forms_kiosk'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified uuid;
  v_template public.forms_templates%ROWTYPE;
  v_field record;
  v_value text;
  v_num numeric;
  v_min numeric;
  v_max numeric;
  v_requires_review boolean := false;
  v_out_of_range_fields jsonb := '[]'::jsonb;
  v_occurrence_key text;
  v_scheduled timestamptz;
  v_task_template_id uuid;
  v_submission_id uuid;
  v_alert_id uuid;
  v_task_id uuid;
  v_satisfy jsonb;
  v_task_form_id uuid;
  v_submitter_name text;
  v_alert_message text;
  v_validate jsonb;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  SELECT * INTO v_template
  FROM public.forms_templates
  WHERE id = p_form_template_id AND business_id = p_business_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Form not found');
  END IF;

  IF p_manager_override AND (p_override_explanation IS NULL OR length(trim(p_override_explanation)) < 3) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Manager override requires an explanation');
  END IF;

  SELECT COALESCE(full_name, trim(concat_ws(' ', first_name, last_name)), 'Staff')
  INTO v_submitter_name
  FROM public.users
  WHERE id = p_employee_id;

  v_task_id := p_task_id;
  v_task_template_id := p_task_template_id;

  IF v_task_id IS NOT NULL THEN
    SELECT t.template_id, t.scheduled_for, t.required_form_id
    INTO v_task_template_id, v_scheduled, v_task_form_id
    FROM public.task_manager_tasks t
    WHERE t.id = v_task_id AND t.business_id = p_business_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Task not found');
    END IF;

    IF v_task_form_id IS NOT NULL AND v_task_form_id <> p_form_template_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Form does not match this task');
    END IF;
  END IF;

  IF v_task_template_id IS NULL THEN
    v_task_template_id := public.forms_get_linked_task_template(p_business_id, p_form_template_id);
  END IF;

  v_scheduled := COALESCE(
    p_scheduled_for,
    CASE WHEN v_task_id IS NOT NULL THEN (SELECT scheduled_for FROM public.task_manager_tasks WHERE id = v_task_id) END,
    CASE WHEN v_task_template_id IS NOT NULL THEN public.forms_resolve_scheduled_for_slot(p_business_id, v_task_template_id, now()) END,
    NULL
  );

  IF v_scheduled IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Scheduled date and time are required for this form');
  END IF;

  v_validate := public.forms_validate_submission_slot(
    p_business_id,
    p_form_template_id,
    v_scheduled,
    v_task_template_id,
    p_manager_override
  );

  IF COALESCE((v_validate->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_validate->>'error', 'Could not validate submission slot'));
  END IF;

  IF COALESCE((v_validate->>'allowed')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_validate->>'message', 'This check cannot be submitted for the selected time'));
  END IF;

  IF v_task_id IS NULL AND (v_validate->>'task_id') IS NOT NULL THEN
    v_task_id := (v_validate->>'task_id')::uuid;
  END IF;

  v_occurrence_key := v_validate->>'occurrence_key';

  FOR v_field IN
    SELECT * FROM public.forms_fields
    WHERE form_template_id = p_form_template_id
    ORDER BY display_order
  LOOP
    v_value := p_responses ->> v_field.field_key;

    IF v_field.is_required AND (v_value IS NULL OR length(trim(v_value)) = 0) THEN
      IF NOT (v_field.field_type = 'checkbox' AND (p_responses -> v_field.field_key)::boolean IS TRUE) THEN
        IF v_field.field_type <> 'checkbox' OR COALESCE((p_responses ->> v_field.field_key)::boolean, false) IS NOT TRUE THEN
          RETURN jsonb_build_object('success', false, 'error', v_field.field_label || ' is required');
        END IF;
      END IF;
    END IF;

    IF v_field.field_type = 'number' AND v_value IS NOT NULL AND length(trim(v_value)) > 0 THEN
      v_num := v_value::numeric;
      v_min := (v_field.validation_rules ->> 'min')::numeric;
      v_max := (v_field.validation_rules ->> 'max')::numeric;

      IF COALESCE((v_field.validation_rules ->> 'flag_out_of_range')::boolean, true)
         AND ((v_min IS NOT NULL AND v_num < v_min) OR (v_max IS NOT NULL AND v_num > v_max)) THEN
        v_requires_review := true;
        v_out_of_range_fields := v_out_of_range_fields || jsonb_build_array(
          jsonb_build_object(
            'field_key', v_field.field_key,
            'field_label', v_field.field_label,
            'value', v_num,
            'min', v_min,
            'max', v_max,
            'unit', v_field.validation_rules ->> 'unit'
          )
        );
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.forms_submissions (
    business_id, form_template_id, task_id, task_template_id, scheduled_for,
    occurrence_key, employee_id, responses, requires_manager_review,
    manager_review_status, manager_override, override_explanation, submitted_via
  )
  VALUES (
    p_business_id, p_form_template_id, v_task_id, v_task_template_id, v_scheduled,
    v_occurrence_key, p_employee_id, COALESCE(p_responses, '{}'::jsonb), v_requires_review OR p_manager_override,
    CASE WHEN v_requires_review OR p_manager_override THEN 'pending' ELSE 'not_required' END,
    COALESCE(p_manager_override, false), nullif(trim(p_override_explanation), ''), COALESCE(p_submitted_via, 'forms_kiosk')
  )
  RETURNING id INTO v_submission_id;

  IF v_requires_review OR p_manager_override THEN
    v_alert_message := CASE
      WHEN p_manager_override THEN 'Form submitted with manager override'
      WHEN jsonb_array_length(v_out_of_range_fields) > 0 THEN
        v_template.title || ': out-of-range reading(s) from ' || v_submitter_name
      ELSE 'Form submission requires manager review'
    END;

    INSERT INTO public.forms_manager_alerts (
      business_id, alert_type, task_id, form_submission_id, form_template_id,
      notify_employee_id, message, details
    )
    VALUES (
      p_business_id,
      CASE WHEN p_manager_override THEN 'manager_override' ELSE 'out_of_range' END,
      v_task_id,
      v_submission_id,
      p_form_template_id,
      v_template.alert_employee_id,
      v_alert_message,
      jsonb_build_object(
        'submission_id', v_submission_id,
        'submitted_by', p_employee_id,
        'submitter_name', v_submitter_name,
        'out_of_range_fields', v_out_of_range_fields,
        'override_explanation', p_override_explanation
      )
    )
    RETURNING id INTO v_alert_id;

    PERFORM public.forms_trigger_alert_email(v_alert_id);
  END IF;

  PERFORM public.task_manager_generate_due_tasks(p_business_id);

  IF v_task_id IS NULL AND v_task_template_id IS NOT NULL THEN
    SELECT id INTO v_task_id
    FROM public.task_manager_tasks
    WHERE business_id = p_business_id
      AND template_id = v_task_template_id
      AND scheduled_for = v_scheduled
    LIMIT 1;
  END IF;

  v_satisfy := public.task_manager_satisfy_occurrence(p_business_id, v_task_id, v_submission_id, p_employee_id);

  RETURN jsonb_build_object(
    'success', true,
    'submission_id', v_submission_id,
    'task_id', v_task_id,
    'requires_manager_review', v_requires_review OR p_manager_override,
    'out_of_range_count', jsonb_array_length(v_out_of_range_fields),
    'alert_employee_id', v_template.alert_employee_id,
    'satisfy', v_satisfy
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.forms_parse_time_text(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forms_slot_at(date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forms_get_linked_task_template(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forms_validate_submission_slot(uuid, uuid, timestamptz, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forms_check_completion_slot(uuid, uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forms_get_form_schedule_info(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forms_submit(uuid, uuid, uuid, text, jsonb, uuid, uuid, timestamptz, boolean, text, text) TO anon, authenticated;
