-- Checklist form submissions use the actual submit time, not a preset audit time.
-- Only the available window (start/end) is configured on the category.

CREATE OR REPLACE FUNCTION public.task_manager_evaluate_checklist_category(
  p_category_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category public.task_manager_categories%ROWTYPE;
  v_tz text;
  v_business_date date;
  v_now_time time;
  v_scheduled timestamptz;
  v_start_label text;
  v_end_label text;
BEGIN
  SELECT * INTO v_category
  FROM public.task_manager_categories
  WHERE id = p_category_id;

  IF NOT FOUND OR COALESCE(v_category.kiosk_checklist_button, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_checklist_category', false,
      'available', true
    );
  END IF;

  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = v_category.business_id;

  v_business_date := (p_at AT TIME ZONE v_tz)::date;
  v_now_time := (p_at AT TIME ZONE v_tz)::time;
  v_scheduled := date_trunc('minute', p_at);

  IF v_category.checklist_window_start IS NULL OR v_category.checklist_window_end IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_checklist_category', true,
      'available', false,
      'configured', false,
      'message', 'Checklist hours are not configured yet. Ask a manager to set the available window under Task Manager → Categories.',
      'category_id', v_category.id,
      'category_name', v_category.name,
      'button_label', COALESCE(NULLIF(trim(v_category.kiosk_button_label), ''), v_category.name)
    );
  END IF;

  v_start_label := to_char(v_category.checklist_window_start, 'FMHH12:MI AM');
  v_end_label := to_char(v_category.checklist_window_end, 'FMHH12:MI AM');

  IF NOT public.task_manager_time_in_window(
    v_now_time,
    v_category.checklist_window_start,
    v_category.checklist_window_end
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_checklist_category', true,
      'available', false,
      'configured', true,
      'message', COALESCE(NULLIF(trim(v_category.kiosk_button_label), ''), v_category.name)
        || ' checklist is available ' || v_start_label || ' – ' || v_end_label || ' (business time).',
      'category_id', v_category.id,
      'category_name', v_category.name,
      'button_label', COALESCE(NULLIF(trim(v_category.kiosk_button_label), ''), v_category.name),
      'window_start', to_char(v_category.checklist_window_start, 'HH24:MI'),
      'window_end', to_char(v_category.checklist_window_end, 'HH24:MI'),
      'scheduled_for', v_scheduled
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'is_checklist_category', true,
    'available', true,
    'configured', true,
    'message', 'Checklist is available now.',
    'category_id', v_category.id,
    'category_name', v_category.name,
    'button_label', COALESCE(NULLIF(trim(v_category.kiosk_button_label), ''), v_category.name),
    'window_start', to_char(v_category.checklist_window_start, 'HH24:MI'),
    'window_end', to_char(v_category.checklist_window_end, 'HH24:MI'),
    'scheduled_for', v_scheduled
  );
END;
$$;

-- Patch forms_submit: checklist tasks always stamp scheduled_for at submit time.
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
  v_expected text;
  v_requires_review boolean := false;
  v_out_of_range_fields jsonb := '[]'::jsonb;
  v_escalations jsonb := COALESCE(p_responses->'_escalations', '{}'::jsonb);
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
  v_checklist jsonb;
  v_is_checklist_task boolean := false;
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
    SELECT t.template_id, COALESCE(t.scheduled_for, t.due_at), t.required_form_id
    INTO v_task_template_id, v_scheduled, v_task_form_id
    FROM public.task_manager_tasks t
    WHERE t.id = v_task_id AND t.business_id = p_business_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Task not found');
    END IF;

    IF v_task_form_id IS NOT NULL AND v_task_form_id <> p_form_template_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Form does not match this task');
    END IF;

    v_checklist := public.task_manager_evaluate_checklist_task(p_business_id, v_task_id, now());
    v_is_checklist_task := COALESCE((v_checklist->>'is_checklist_task')::boolean, false);

    IF v_is_checklist_task THEN
      IF COALESCE((v_checklist->>'available')::boolean, false) IS NOT TRUE AND NOT p_manager_override THEN
        RETURN jsonb_build_object('success', false, 'error', COALESCE(v_checklist->>'message', 'This checklist is not available right now.'));
      END IF;
      v_scheduled := date_trunc('minute', now());
    END IF;
  END IF;

  IF v_task_template_id IS NULL THEN
    v_task_template_id := public.forms_get_linked_task_template(p_business_id, p_form_template_id);
  END IF;

  IF NOT v_is_checklist_task THEN
    v_scheduled := COALESCE(
      p_scheduled_for,
      v_scheduled,
      CASE WHEN v_task_id IS NOT NULL THEN (
        SELECT COALESCE(scheduled_for, due_at)
        FROM public.task_manager_tasks
        WHERE id = v_task_id
      ) END,
      CASE WHEN v_task_template_id IS NOT NULL THEN public.forms_resolve_scheduled_for_slot(p_business_id, v_task_template_id, now()) END,
      NULL
    );
  END IF;

  IF v_scheduled IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Scheduled date and time are required for this form');
  END IF;

  v_validate := public.forms_validate_submission_slot(
    p_business_id,
    p_form_template_id,
    v_scheduled,
    v_task_template_id,
    p_manager_override,
    v_task_id
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
            'unit', v_field.validation_rules ->> 'unit',
            'issue_type', 'out_of_range',
            'escalation', COALESCE(v_escalations -> v_field.field_key, '{}'::jsonb)
          )
        );
      END IF;
    END IF;

    IF v_field.field_type = 'yes_no' AND v_value IS NOT NULL AND length(trim(v_value)) > 0 THEN
      v_expected := nullif(lower(trim(v_field.validation_rules ->> 'correct_answer')), '');

      IF COALESCE((v_field.validation_rules ->> 'flag_incorrect')::boolean, true)
         AND v_expected IS NOT NULL
         AND lower(trim(v_value)) <> v_expected THEN
        v_requires_review := true;
        v_out_of_range_fields := v_out_of_range_fields || jsonb_build_array(
          jsonb_build_object(
            'field_key', v_field.field_key,
            'field_label', v_field.field_label,
            'value', lower(trim(v_value)),
            'expected', v_expected,
            'issue_type', 'incorrect_answer',
            'escalation', COALESCE(v_escalations -> v_field.field_key, '{}'::jsonb)
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
        v_template.title || ': flagged response(s) from ' || v_submitter_name
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
        'escalations', v_escalations,
        'override_explanation', p_override_explanation,
        'checklist_context', v_checklist
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
    'satisfy', v_satisfy,
    'scheduled_for', v_scheduled
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_evaluate_checklist_category(uuid, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forms_submit(uuid, uuid, uuid, text, jsonb, uuid, uuid, timestamptz, boolean, text, text) TO anon, authenticated;
