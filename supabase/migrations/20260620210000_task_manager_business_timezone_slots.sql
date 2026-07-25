-- Generate template task slots in the business timezone instead of UTC midnight + time.

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
  v_tz text;
  v_best timestamptz;
  v_scheduled timestamptz;
  v_schedule_time text;
  v_business_date date;
BEGIN
  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;

  SELECT * INTO v_template
  FROM public.task_manager_templates
  WHERE id = p_task_template_id AND business_id = p_business_id;

  IF NOT FOUND THEN
    RETURN date_trunc('hour', p_at);
  END IF;

  v_business_date := (p_at AT TIME ZONE v_tz)::date;
  v_best := NULL;

  FOREACH v_schedule_time IN ARRAY COALESCE(v_template.schedule_times, ARRAY[]::text[])
  LOOP
    v_scheduled := public.forms_slot_at(v_business_date, v_schedule_time, v_tz);
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
  v_tz text;
  v_business_date date;
BEGIN
  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;

  v_business_date := (now() AT TIME ZONE v_tz)::date;
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
    SELECT public.forms_slot_at(v_business_date, schedule_time::text, v_tz) AS scheduled_at
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
