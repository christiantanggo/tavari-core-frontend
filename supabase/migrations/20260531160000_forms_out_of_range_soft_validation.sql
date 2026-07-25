-- Allow out-of-range form values to submit with employee warning + designated alert recipient.

ALTER TABLE public.forms_templates
  ADD COLUMN IF NOT EXISTS alert_employee_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.forms_manager_alerts
  ADD COLUMN IF NOT EXISTS notify_employee_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_forms_manager_alerts_notify_employee_open
  ON public.forms_manager_alerts (notify_employee_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

DROP POLICY IF EXISTS "Forms alerts visible to managers" ON public.forms_manager_alerts;
CREATE POLICY "Forms alerts visible to managers"
  ON public.forms_manager_alerts FOR SELECT TO authenticated
  USING (
    public.forms_is_business_manager(business_id)
    OR notify_employee_id = auth.uid()
  );

DROP POLICY IF EXISTS "Forms alerts managed by managers" ON public.forms_manager_alerts;
CREATE POLICY "Forms alerts managed by managers"
  ON public.forms_manager_alerts FOR UPDATE TO authenticated
  USING (
    public.forms_is_business_manager(business_id)
    OR notify_employee_id = auth.uid()
  )
  WITH CHECK (
    public.forms_is_business_manager(business_id)
    OR notify_employee_id = auth.uid()
  );

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
  v_task_id uuid;
  v_satisfy jsonb;
  v_task_form_id uuid;
  v_submitter_name text;
  v_alert_message text;
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

    IF v_task_template_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Task not found');
    END IF;

    IF v_task_form_id IS NOT NULL AND v_task_form_id <> p_form_template_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Form does not match this task');
    END IF;
  END IF;

  IF v_task_template_id IS NULL THEN
    SELECT id INTO v_task_template_id
    FROM public.task_manager_templates
    WHERE business_id = p_business_id
      AND required_form_id = p_form_template_id
      AND status = 'active'
    ORDER BY created_at
    LIMIT 1;
  END IF;

  v_scheduled := COALESCE(
    p_scheduled_for,
    CASE WHEN v_task_id IS NOT NULL THEN (SELECT scheduled_for FROM public.task_manager_tasks WHERE id = v_task_id) END,
    CASE WHEN v_task_template_id IS NOT NULL THEN public.forms_resolve_scheduled_for_slot(p_business_id, v_task_template_id, now()) END,
    date_trunc('hour', now())
  );

  v_occurrence_key := CASE
    WHEN v_task_template_id IS NOT NULL THEN public.forms_build_occurrence_key(v_task_template_id, v_scheduled)
    ELSE p_form_template_id::text || ':' || to_char(v_scheduled AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  END;

  IF EXISTS (
    SELECT 1 FROM public.forms_submissions
    WHERE business_id = p_business_id AND occurrence_key = v_occurrence_key
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This check was already submitted for this time slot');
  END IF;

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
    );
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

GRANT EXECUTE ON FUNCTION public.forms_submit(uuid, uuid, uuid, text, jsonb, uuid, uuid, timestamptz, boolean, text, text) TO anon, authenticated;
