-- Tavari Forms / Checklists module + Task Manager occurrence satisfaction
-- Separate from waivers; integrates via required_form_id on task templates.

CREATE TABLE IF NOT EXISTS public.forms_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.forms_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_template_id uuid NOT NULL REFERENCES public.forms_templates(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  field_label text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('number', 'text', 'textarea', 'checkbox', 'select')),
  field_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_required boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  validation_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_template_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_forms_fields_template
  ON public.forms_fields (form_template_id, display_order);

CREATE TABLE IF NOT EXISTS public.forms_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  form_template_id uuid NOT NULL REFERENCES public.forms_templates(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.task_manager_tasks(id) ON DELETE SET NULL,
  task_template_id uuid REFERENCES public.task_manager_templates(id) ON DELETE SET NULL,
  scheduled_for timestamptz,
  occurrence_key text NOT NULL,
  employee_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  responses jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_manager_review boolean NOT NULL DEFAULT false,
  manager_review_status text NOT NULL DEFAULT 'not_required'
    CHECK (manager_review_status IN ('not_required', 'pending', 'acknowledged', 'resolved')),
  manager_override boolean NOT NULL DEFAULT false,
  override_explanation text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  submitted_via text NOT NULL DEFAULT 'forms_kiosk',
  UNIQUE (business_id, occurrence_key)
);

CREATE INDEX IF NOT EXISTS idx_forms_submissions_business_date
  ON public.forms_submissions (business_id, form_template_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.forms_manager_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('missed_occurrence', 'out_of_range', 'manager_override')),
  task_id uuid REFERENCES public.task_manager_tasks(id) ON DELETE SET NULL,
  form_submission_id uuid REFERENCES public.forms_submissions(id) ON DELETE SET NULL,
  form_template_id uuid REFERENCES public.forms_templates(id) ON DELETE SET NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forms_manager_alerts_business_open
  ON public.forms_manager_alerts (business_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

ALTER TABLE public.task_manager_templates
  ADD COLUMN IF NOT EXISTS required_form_id uuid REFERENCES public.forms_templates(id) ON DELETE SET NULL;

ALTER TABLE public.task_manager_tasks
  DROP CONSTRAINT IF EXISTS task_manager_tasks_status_check;

ALTER TABLE public.task_manager_tasks
  ADD CONSTRAINT task_manager_tasks_status_check
  CHECK (status IN ('backlog', 'to_do', 'in_progress', 'blocked', 'done', 'cancelled', 'incomplete'));

ALTER TABLE public.task_manager_tasks
  ADD COLUMN IF NOT EXISTS occurrence_status text NOT NULL DEFAULT 'pending'
    CHECK (occurrence_status IN ('pending', 'satisfied', 'missed', 'incomplete')),
  ADD COLUMN IF NOT EXISTS form_submission_id uuid REFERENCES public.forms_submissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority_boost integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missed_at timestamptz,
  ADD COLUMN IF NOT EXISTS required_form_id uuid REFERENCES public.forms_templates(id) ON DELETE SET NULL;

ALTER TABLE public.task_manager_completions
  ADD COLUMN IF NOT EXISTS form_submission_id uuid REFERENCES public.forms_submissions(id) ON DELETE SET NULL;

-- Module catalog
INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'forms',
  'Tavari Forms',
  'Operational checklists and compliance forms (temperature logs, inspections). Separate from waivers.',
  'FiClipboard',
  false,
  'Compliance'
)
ON CONFLICT (module_key) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  module_category = EXCLUDED.module_category;

CREATE OR REPLACE FUNCTION public.forms_is_business_member(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.task_manager_is_business_member(p_business_id);
$$;

CREATE OR REPLACE FUNCTION public.forms_is_business_manager(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.task_manager_is_business_manager(p_business_id);
$$;

ALTER TABLE public.forms_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms_manager_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Forms templates visible to business members" ON public.forms_templates;
CREATE POLICY "Forms templates visible to business members"
  ON public.forms_templates FOR SELECT TO authenticated
  USING (public.forms_is_business_member(business_id));

DROP POLICY IF EXISTS "Forms templates managed by managers" ON public.forms_templates;
CREATE POLICY "Forms templates managed by managers"
  ON public.forms_templates FOR ALL TO authenticated
  USING (public.forms_is_business_manager(business_id))
  WITH CHECK (public.forms_is_business_manager(business_id));

DROP POLICY IF EXISTS "Forms fields visible to business members" ON public.forms_fields;
CREATE POLICY "Forms fields visible to business members"
  ON public.forms_fields FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.forms_templates ft
    WHERE ft.id = form_template_id AND public.forms_is_business_member(ft.business_id)
  ));

DROP POLICY IF EXISTS "Forms fields managed by managers" ON public.forms_fields;
CREATE POLICY "Forms fields managed by managers"
  ON public.forms_fields FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.forms_templates ft
    WHERE ft.id = form_template_id AND public.forms_is_business_manager(ft.business_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.forms_templates ft
    WHERE ft.id = form_template_id AND public.forms_is_business_manager(ft.business_id)
  ));

DROP POLICY IF EXISTS "Forms submissions visible to business members" ON public.forms_submissions;
CREATE POLICY "Forms submissions visible to business members"
  ON public.forms_submissions FOR SELECT TO authenticated
  USING (public.forms_is_business_member(business_id));

DROP POLICY IF EXISTS "Forms alerts visible to managers" ON public.forms_manager_alerts;
CREATE POLICY "Forms alerts visible to managers"
  ON public.forms_manager_alerts FOR SELECT TO authenticated
  USING (public.forms_is_business_manager(business_id));

DROP POLICY IF EXISTS "Forms alerts managed by managers" ON public.forms_manager_alerts;
CREATE POLICY "Forms alerts managed by managers"
  ON public.forms_manager_alerts FOR UPDATE TO authenticated
  USING (public.forms_is_business_manager(business_id))
  WITH CHECK (public.forms_is_business_manager(business_id));

CREATE OR REPLACE FUNCTION public.forms_build_occurrence_key(
  p_task_template_id uuid,
  p_scheduled_for timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_task_template_id::text || ':' || to_char(p_scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;

CREATE OR REPLACE FUNCTION public.forms_resolve_scheduled_for_slot(
  p_business_id uuid,
  p_task_template_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template public.task_manager_templates%ROWTYPE;
  v_best timestamptz;
  v_scheduled timestamptz;
  v_schedule_time text;
BEGIN
  SELECT * INTO v_template
  FROM public.task_manager_templates
  WHERE id = p_task_template_id AND business_id = p_business_id;

  IF NOT FOUND THEN
    RETURN date_trunc('hour', p_at);
  END IF;

  v_best := NULL;

  FOREACH v_schedule_time IN ARRAY COALESCE(v_template.schedule_times, ARRAY[]::text[])
  LOOP
    v_scheduled := date_trunc('day', p_at) + (v_schedule_time::time);
    IF v_scheduled <= p_at + make_interval(mins => COALESCE(v_template.due_window_minutes, 60))
       AND v_scheduled >= p_at - make_interval(mins => COALESCE(v_template.due_window_minutes, 60) * 2) THEN
      IF v_best IS NULL OR abs(extract(epoch from (v_scheduled - p_at))) < abs(extract(epoch from (v_best - p_at))) THEN
        v_best := v_scheduled;
      END IF;
    END IF;
  END LOOP;

  IF v_best IS NULL THEN
    RETURN date_trunc('hour', p_at);
  END IF;

  RETURN v_best;
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
BEGIN
  FOR v_row IN
    SELECT t.id, t.template_id, t.scheduled_for, t.title
    FROM public.task_manager_tasks t
    WHERE t.business_id = p_business_id
      AND t.template_id IS NOT NULL
      AND t.status IN ('to_do', 'in_progress')
      AND t.scheduled_for IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.task_manager_templates tmpl
        CROSS JOIN LATERAL unnest(tmpl.schedule_times) AS st(schedule_time)
        CROSS JOIN LATERAL (
          SELECT (date_trunc('day', now()) + (st.schedule_time::time)) AS slot_at
        ) slots
        WHERE tmpl.id = t.template_id
          AND slots.slot_at > t.scheduled_for
          AND slots.slot_at <= now() + interval '30 minutes'
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

CREATE OR REPLACE FUNCTION public.task_manager_satisfy_occurrence(
  p_business_id uuid,
  p_task_id uuid,
  p_form_submission_id uuid,
  p_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.task_manager_tasks%ROWTYPE;
  v_sub public.forms_submissions%ROWTYPE;
  v_completion_id uuid;
BEGIN
  SELECT * INTO v_sub
  FROM public.forms_submissions
  WHERE id = p_form_submission_id AND business_id = p_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Submission not found');
  END IF;

  IF p_task_id IS NOT NULL THEN
    SELECT * INTO v_task
    FROM public.task_manager_tasks
    WHERE id = p_task_id AND business_id = p_business_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Task not found');
    END IF;

    IF v_task.status IN ('done', 'incomplete', 'cancelled') THEN
      RETURN jsonb_build_object('success', true, 'task_id', v_task.id, 'already_satisfied', true);
    END IF;

    INSERT INTO public.task_manager_completions (
      business_id, task_id, employee_id, notes, evidence, completed_checklist, form_submission_id
    )
    VALUES (
      p_business_id, v_task.id, p_employee_id,
      'Completed via form submission',
      jsonb_build_object('form_submission_id', p_form_submission_id),
      '[]'::jsonb,
      p_form_submission_id
    )
    RETURNING id INTO v_completion_id;

    UPDATE public.task_manager_tasks
    SET
      status = 'done',
      occurrence_status = 'satisfied',
      form_submission_id = p_form_submission_id,
      completed_by = p_employee_id,
      completed_at = now(),
      review_status = CASE WHEN v_sub.requires_manager_review THEN 'pending_manager' ELSE review_status END,
      manager_review_required = manager_review_required OR v_sub.requires_manager_review,
      completion_summary = jsonb_build_object('completion_id', v_completion_id, 'form_submission_id', p_form_submission_id)
    WHERE id = v_task.id;

    UPDATE public.forms_submissions SET task_id = v_task.id WHERE id = p_form_submission_id;

    RETURN jsonb_build_object('success', true, 'task_id', v_task.id, 'completion_id', v_completion_id);
  END IF;

  SELECT * INTO v_task
  FROM public.task_manager_tasks
  WHERE business_id = p_business_id
    AND template_id = v_sub.task_template_id
    AND scheduled_for = v_sub.scheduled_for
  FOR UPDATE;

  IF FOUND AND v_task.status IN ('to_do', 'in_progress') THEN
    RETURN public.task_manager_satisfy_occurrence(p_business_id, v_task.id, p_form_submission_id, p_employee_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'task_id', null, 'standalone', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.forms_get_template_for_fill(p_form_template_id uuid, p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template public.forms_templates%ROWTYPE;
  v_fields jsonb;
BEGIN
  SELECT * INTO v_template
  FROM public.forms_templates
  WHERE id = p_form_template_id AND business_id = p_business_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Form not found');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', f.id,
      'field_key', f.field_key,
      'field_label', f.field_label,
      'field_type', f.field_type,
      'field_options', f.field_options,
      'is_required', f.is_required,
      'validation_rules', f.validation_rules,
      'display_order', f.display_order
    ) ORDER BY f.display_order, f.created_at
  ), '[]'::jsonb)
  INTO v_fields
  FROM public.forms_fields f
  WHERE f.form_template_id = p_form_template_id;

  RETURN jsonb_build_object(
    'success', true,
    'template', jsonb_build_object(
      'id', v_template.id,
      'title', v_template.title,
      'description', v_template.description
    ),
    'fields', v_fields
  );
END;
$$;

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
  v_field record;
  v_value text;
  v_num numeric;
  v_min numeric;
  v_max numeric;
  v_requires_review boolean := false;
  v_occurrence_key text;
  v_scheduled timestamptz;
  v_task_template_id uuid;
  v_submission_id uuid;
  v_task_id uuid;
  v_satisfy jsonb;
  v_task_form_id uuid;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.forms_templates
    WHERE id = p_form_template_id AND business_id = p_business_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Form not found');
  END IF;

  IF p_manager_override AND (p_override_explanation IS NULL OR length(trim(p_override_explanation)) < 3) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Manager override requires an explanation');
  END IF;

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
      IF v_min IS NOT NULL AND v_num < v_min AND NOT p_manager_override THEN
        RETURN jsonb_build_object('success', false, 'error', v_field.field_label || ' is below minimum (' || v_min || '). Request manager override.');
      END IF;
      IF v_max IS NOT NULL AND v_num > v_max AND NOT p_manager_override THEN
        RETURN jsonb_build_object('success', false, 'error', v_field.field_label || ' is above maximum (' || v_max || '). Request manager override.');
      END IF;
      IF (
        (v_min IS NOT NULL AND v_num < v_min) OR (v_max IS NOT NULL AND v_num > v_max)
      ) AND NOT p_manager_override THEN
        v_requires_review := true;
      ELSIF (v_min IS NOT NULL AND v_num < v_min) OR (v_max IS NOT NULL AND v_num > v_max) THEN
        v_requires_review := true;
      END IF;
      IF COALESCE((v_field.validation_rules ->> 'flag_out_of_range')::boolean, true)
         AND ((v_min IS NOT NULL AND v_num < v_min) OR (v_max IS NOT NULL AND v_num > v_max)) THEN
        v_requires_review := true;
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
    INSERT INTO public.forms_manager_alerts (business_id, alert_type, task_id, form_submission_id, form_template_id, message, details)
    VALUES (
      p_business_id,
      CASE WHEN p_manager_override THEN 'manager_override' ELSE 'out_of_range' END,
      v_task_id,
      v_submission_id,
      p_form_template_id,
      CASE WHEN p_manager_override THEN 'Form submitted with manager override' ELSE 'Form submission requires manager review (out of range)' END,
      jsonb_build_object('submission_id', v_submission_id, 'override_explanation', p_override_explanation)
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
    'satisfy', v_satisfy
  );
END;
$$;

DROP FUNCTION IF EXISTS public.task_manager_get_next_task(uuid, uuid);

CREATE OR REPLACE FUNCTION public.task_manager_generate_due_tasks(p_business_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  v_missed integer;
  v_prev_missed integer;
BEGIN
  v_missed := public.task_manager_mark_missed_occurrences(p_business_id);

  SELECT count(*)::integer INTO v_prev_missed
  FROM public.task_manager_tasks
  WHERE business_id = p_business_id
    AND occurrence_status = 'missed'
    AND missed_at > now() - interval '24 hours';

  INSERT INTO public.task_manager_tasks (
    business_id, template_id, title, description, category, category_id, priority,
    assignment_scope, assigned_to, status, available_at, due_at, scheduled_for,
    requires_photo, requires_notes, peer_review_required, instructions, checklist,
    required_form_id, priority_boost, created_by
  )
  SELECT
    t.business_id, t.id, t.title, t.description, t.category, t.category_id, t.priority,
    t.assignment_scope, t.default_assigned_to, 'to_do',
    scheduled_at, scheduled_at + make_interval(mins => t.due_window_minutes), scheduled_at,
    t.requires_photo, t.requires_notes, t.peer_review_required, t.instructions, t.checklist,
    t.required_form_id,
    CASE WHEN v_prev_missed > 0 THEN 1 ELSE 0 END,
    t.created_by
  FROM public.task_manager_templates t
  CROSS JOIN LATERAL (
    SELECT (date_trunc('day', now()) + (schedule_time::time)) AS scheduled_at
    FROM unnest(t.schedule_times) AS schedule_time
  ) s
  WHERE t.business_id = p_business_id
    AND t.status = 'active'
    AND t.recurrence_type = 'daily'
    AND cardinality(t.schedule_times) > 0
    AND scheduled_at <= now() + interval '30 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.forms_submissions fs
      WHERE fs.business_id = p_business_id
        AND fs.task_template_id = t.id
        AND fs.scheduled_for = scheduled_at
    )
  ON CONFLICT (template_id, scheduled_for) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

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
  priority_boost integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.task_manager_generate_due_tasks(p_business_id);

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
    WHERE tm.business_id = p_business_id
      AND tm.status IN ('to_do', 'in_progress')
      AND tm.available_at <= now()
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
      tm.priority_boost DESC,
      CASE WHEN tm.assigned_to = p_employee_id THEN 0 ELSE 1 END,
      CASE tm.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      COALESCE(tm.due_at, tm.available_at) ASC,
      tm.created_at ASC
    LIMIT 1
  )
  SELECT
    c.id, c.template_id, c.title, c.description, c.category, c.priority, c.assignment_scope,
    c.due_at, c.requires_photo, c.requires_notes, c.instructions, c.checklist,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', tr.id, 'title', tr.title, 'resource_type', tr.resource_type,
        'resource_url', tr.resource_url, 'content', tr.content,
        'is_required', tr.is_required, 'completed', etc.id IS NOT NULL
      ) ORDER BY tr.created_at)
      FROM public.task_manager_training_resources tr
      LEFT JOIN public.task_manager_employee_training_completions etc
        ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
      WHERE tr.template_id = c.template_id
    ), '[]'::jsonb),
    COALESCE((
      SELECT count(*)::integer
      FROM public.task_manager_training_resources tr
      LEFT JOIN public.task_manager_employee_training_completions etc
        ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
      WHERE tr.template_id = c.template_id AND tr.is_required = true AND etc.id IS NULL
    ), 0),
    c.required_form_id,
    (SELECT ft.title FROM public.forms_templates ft WHERE ft.id = c.required_form_id),
    c.scheduled_for,
    c.priority_boost
  FROM candidate c;
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_generate_due_tasks(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_get_next_task(uuid, uuid) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.forms_get_template_for_fill(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forms_submit(uuid, uuid, uuid, text, jsonb, uuid, uuid, timestamptz, boolean, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forms_build_occurrence_key(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forms_resolve_scheduled_for_slot(uuid, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_mark_missed_occurrences(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_satisfy_occurrence(uuid, uuid, uuid, uuid) TO authenticated;
