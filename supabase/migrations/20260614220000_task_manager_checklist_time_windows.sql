-- Kiosk checklist categories: configurable time window + audit time for form submissions.

ALTER TABLE public.task_manager_categories
  ADD COLUMN IF NOT EXISTS checklist_window_start time,
  ADD COLUMN IF NOT EXISTS checklist_window_end time,
  ADD COLUMN IF NOT EXISTS checklist_audit_time time;

CREATE OR REPLACE FUNCTION public.task_manager_time_in_window(
  p_now time,
  p_start time,
  p_end time
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_start IS NULL OR p_end IS NULL THEN false
    WHEN p_start = p_end THEN true
    WHEN p_start < p_end THEN p_now >= p_start AND p_now < p_end
    ELSE p_now >= p_start OR p_now < p_end
  END;
$$;

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
  v_audit_time time;
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

  IF v_category.checklist_window_start IS NULL
     OR v_category.checklist_window_end IS NULL
     OR v_category.checklist_audit_time IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_checklist_category', true,
      'available', false,
      'configured', false,
      'message', 'Checklist hours are not configured yet. Ask a manager to set the time window under Task Manager → Categories.',
      'category_id', v_category.id,
      'category_name', v_category.name,
      'button_label', COALESCE(NULLIF(trim(v_category.kiosk_button_label), ''), v_category.name)
    );
  END IF;

  v_audit_time := v_category.checklist_audit_time;
  v_scheduled := public.forms_slot_at(v_business_date, to_char(v_audit_time, 'HH24:MI'), v_tz);
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
      'audit_time', to_char(v_category.checklist_audit_time, 'HH24:MI'),
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
    'audit_time', to_char(v_category.checklist_audit_time, 'HH24:MI'),
    'scheduled_for', v_scheduled
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_evaluate_checklist_task(
  p_business_id uuid,
  p_task_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.task_manager_tasks%ROWTYPE;
  v_eval jsonb;
BEGIN
  SELECT * INTO v_task
  FROM public.task_manager_tasks
  WHERE id = p_task_id
    AND business_id = p_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Task not found');
  END IF;

  IF v_task.category_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_checklist_task', false,
      'available', true
    );
  END IF;

  v_eval := public.task_manager_evaluate_checklist_category(v_task.category_id, p_at);

  IF COALESCE((v_eval->>'is_checklist_category')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_checklist_task', false,
      'available', true,
      'task_id', v_task.id
    );
  END IF;

  RETURN v_eval || jsonb_build_object(
    'success', true,
    'is_checklist_task', true,
    'task_id', v_task.id,
    'required_form_id', v_task.required_form_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_get_task_form_fill_context(
  p_business_id uuid,
  p_task_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eval jsonb;
BEGIN
  v_eval := public.task_manager_evaluate_checklist_task(p_business_id, p_task_id, now());
  IF COALESCE((v_eval->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_eval;
  END IF;
  RETURN v_eval;
END;
$$;

DROP FUNCTION IF EXISTS public.task_manager_get_kiosk_checklist_categories(uuid, uuid);

CREATE OR REPLACE FUNCTION public.task_manager_get_kiosk_checklist_categories(
  p_business_id uuid,
  p_employee_id uuid
)
RETURNS TABLE (
  category_id uuid,
  name text,
  button_label text,
  sort_order integer,
  window_start text,
  window_end text,
  audit_time text,
  is_available boolean,
  unavailable_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_eval jsonb;
BEGIN
  FOR v_row IN
    SELECT c.id, c.name, c.kiosk_button_label, c.sort_order
    FROM public.task_manager_categories c
    WHERE c.business_id = p_business_id
      AND c.is_active = true
      AND c.kiosk_checklist_button = true
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.task_manager_category_employees ce
          WHERE ce.category_id = c.id
        )
        OR EXISTS (
          SELECT 1 FROM public.task_manager_category_employees ce
          WHERE ce.category_id = c.id AND ce.employee_id = p_employee_id
        )
      )
    ORDER BY c.sort_order ASC, c.name ASC
  LOOP
    v_eval := public.task_manager_evaluate_checklist_category(v_row.id, now());
    category_id := v_row.id;
    name := v_row.name;
    button_label := COALESCE(NULLIF(trim(v_row.kiosk_button_label), ''), v_row.name);
    sort_order := v_row.sort_order;
    window_start := v_eval->>'window_start';
    window_end := v_eval->>'window_end';
    audit_time := v_eval->>'audit_time';
    is_available := COALESCE((v_eval->>'available')::boolean, false);
    unavailable_message := CASE
      WHEN COALESCE((v_eval->>'available')::boolean, false) THEN NULL
      ELSE COALESCE(v_eval->>'message', 'This checklist is not available right now.')
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_get_checklist_tasks(
  p_business_id uuid,
  p_employee_id uuid,
  p_category_id uuid
)
RETURNS TABLE (
  task_id uuid,
  title text,
  description text,
  priority text,
  status text,
  instructions text,
  checklist jsonb,
  requires_photo boolean,
  requires_notes boolean,
  required_form_id uuid,
  required_form_title text,
  checklist_sort_order integer,
  completed_at timestamptz,
  training_resources jsonb,
  missing_required_training integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_today date;
  v_category public.task_manager_categories%ROWTYPE;
  v_eval jsonb;
BEGIN
  SELECT * INTO v_category
  FROM public.task_manager_categories
  WHERE id = p_category_id
    AND business_id = p_business_id
    AND is_active = true
    AND kiosk_checklist_button = true;

  IF v_category.id IS NULL THEN
    RETURN;
  END IF;

  v_eval := public.task_manager_evaluate_checklist_category(p_category_id, now());
  IF COALESCE((v_eval->>'is_checklist_category')::boolean, false) IS TRUE
     AND COALESCE((v_eval->>'available')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', COALESCE(v_eval->>'message', 'This checklist is not available right now.');
  END IF;

  PERFORM public.task_manager_reset_shift_checklists(p_business_id);

  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;

  v_today := (now() AT TIME ZONE v_tz)::date;

  RETURN QUERY
  SELECT
    tm.id,
    tm.title,
    tm.description,
    tm.priority,
    tm.status,
    tm.instructions,
    tm.checklist,
    tm.requires_photo,
    tm.requires_notes,
    tm.required_form_id,
    (SELECT ft.title FROM public.forms_templates ft WHERE ft.id = tm.required_form_id),
    tm.checklist_sort_order,
    tm.completed_at,
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
          'sort_order', row_number() OVER (ORDER BY tr.created_at)
        ) AS resource_row
        FROM public.task_manager_training_resources tr
        LEFT JOIN public.task_manager_employee_training_completions etc
          ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
        WHERE tr.task_id = tm.id
        UNION ALL
        SELECT jsonb_array_elements(public.task_manager_hr_training_resource_rows(hti, tr.id, p_employee_id)) AS resource_row
        FROM public.task_manager_training_resources tr
        JOIN public.hr_training_items hti ON hti.id = tr.hr_training_item_id
        WHERE hti.is_active = true AND tr.task_id = tm.id
      ) resources
    ), '[]'::jsonb),
    COALESCE((
      SELECT count(*)::integer
      FROM public.task_manager_training_resources tr
      LEFT JOIN public.task_manager_employee_training_completions etc
        ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
      WHERE tr.task_id = tm.id
        AND tr.is_required = true
        AND etc.id IS NULL
    ), 0)
  FROM public.task_manager_tasks tm
  WHERE tm.business_id = p_business_id
    AND tm.category_id = p_category_id
    AND tm.status <> 'cancelled'
    AND (
      tm.status IN ('to_do', 'in_progress')
      OR (
        tm.status = 'done'
        AND tm.completed_at IS NOT NULL
        AND (tm.completed_at AT TIME ZONE v_tz)::date = v_today
      )
    )
    AND (
      tm.assigned_to = p_employee_id
      OR (tm.assignment_scope = 'facility' AND tm.assigned_to IS NULL)
    )
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.task_manager_category_employees ce
        WHERE ce.category_id = tm.category_id
      )
      OR EXISTS (
        SELECT 1 FROM public.task_manager_category_employees ce
        WHERE ce.category_id = tm.category_id AND ce.employee_id = p_employee_id
      )
    )
  ORDER BY tm.checklist_sort_order ASC NULLS LAST, tm.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.forms_validate_submission_slot(
  p_business_id uuid,
  p_form_template_id uuid,
  p_scheduled timestamptz,
  p_task_template_id uuid DEFAULT NULL,
  p_manager_override boolean DEFAULT false,
  p_task_id uuid DEFAULT NULL
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
  v_checklist_task record;
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

  IF p_task_id IS NOT NULL THEN
    SELECT tm.id, tm.category_id, c.kiosk_checklist_button
    INTO v_checklist_task
    FROM public.task_manager_tasks tm
    LEFT JOIN public.task_manager_categories c ON c.id = tm.category_id
    WHERE tm.id = p_task_id
      AND tm.business_id = p_business_id;

    IF FOUND AND COALESCE(v_checklist_task.kiosk_checklist_button, false) IS TRUE THEN
      v_scheduled_date := (p_scheduled AT TIME ZONE v_tz)::date;
      v_occurrence_key := 'checklist:' || v_checklist_task.id::text || ':' || to_char(v_scheduled_date, 'YYYY-MM-DD');

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
          'message', 'This checklist item was already completed for today.',
          'occurrence_key', v_occurrence_key,
          'scheduled_for', p_scheduled,
          'task_id', p_task_id
        );
      END IF;

      IF p_scheduled > now() + interval '5 minutes' THEN
        RETURN jsonb_build_object(
          'success', true,
          'allowed', false,
          'status', 'future',
          'message', 'You cannot complete a check for a future date or time.',
          'occurrence_key', v_occurrence_key,
          'scheduled_for', p_scheduled,
          'task_id', p_task_id
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'allowed', true,
        'status', 'available',
        'message', 'You can complete this checklist form.',
        'occurrence_key', v_occurrence_key,
        'scheduled_for', p_scheduled,
        'task_id', p_task_id
      );
    END IF;
  END IF;

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

-- Patch forms_submit: checklist scheduled_for + window enforcement + pass task_id to validate.
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

  SELECT COALESCE(full_name, trim(concat_ws(' ', u.first_name, u.last_name)), 'Staff')
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
    IF COALESCE((v_checklist->>'is_checklist_task')::boolean, false) IS TRUE THEN
      IF COALESCE((v_checklist->>'available')::boolean, false) IS NOT TRUE AND NOT p_manager_override THEN
        RETURN jsonb_build_object('success', false, 'error', COALESCE(v_checklist->>'message', 'This checklist is not available right now.'));
      END IF;
      v_scheduled := COALESCE(
        p_scheduled_for,
        NULLIF(v_checklist->>'scheduled_for', '')::timestamptz,
        v_scheduled
      );
    END IF;
  END IF;

  IF v_task_template_id IS NULL THEN
    v_task_template_id := public.forms_get_linked_task_template(p_business_id, p_form_template_id);
  END IF;

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
    'satisfy', v_satisfy
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_evaluate_checklist_category(uuid, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_evaluate_checklist_task(uuid, uuid, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_get_task_form_fill_context(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_get_kiosk_checklist_categories(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_get_checklist_tasks(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forms_validate_submission_slot(uuid, uuid, timestamptz, uuid, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forms_validate_submission_slot(uuid, uuid, timestamptz, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forms_submit(uuid, uuid, uuid, text, jsonb, uuid, uuid, timestamptz, boolean, text, text) TO anon, authenticated;
