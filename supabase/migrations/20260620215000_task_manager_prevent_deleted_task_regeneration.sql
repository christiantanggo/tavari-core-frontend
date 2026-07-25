-- Prevent recurring template task slots from being regenerated after a manager removes them.
-- Hard-deleting a row freed the (template_id, scheduled_for) unique slot; generate_due_tasks then recreated it.

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
    AND NOT EXISTS (
      SELECT 1 FROM public.task_manager_tasks existing
      WHERE existing.business_id = p_business_id
        AND existing.template_id = t.id
        AND existing.scheduled_for = scheduled_at
    )
  ON CONFLICT (template_id, scheduled_for) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;
