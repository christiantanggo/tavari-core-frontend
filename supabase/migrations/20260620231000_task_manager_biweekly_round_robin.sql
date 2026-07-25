-- Bi-weekly round robin: same carryover model as weekly, but fresh copies append every 2 weeks (Sunday-based).

ALTER TABLE public.task_manager_round_robin_groups
  DROP CONSTRAINT IF EXISTS task_manager_round_robin_groups_reset_cadence_check;

ALTER TABLE public.task_manager_round_robin_groups
  ADD CONSTRAINT task_manager_round_robin_groups_reset_cadence_check
  CHECK (reset_cadence IN ('on_complete', 'weekly_sunday', 'biweekly_sunday'));

ALTER TABLE public.task_manager_tasks
  DROP CONSTRAINT IF EXISTS task_manager_tasks_due_schedule_mode_check;

ALTER TABLE public.task_manager_tasks
  ADD CONSTRAINT task_manager_tasks_due_schedule_mode_check
  CHECK (due_schedule_mode IN (
    'specific_date', 'frequency', 'round_robin', 'weekly_round_robin', 'biweekly_round_robin',
    'daily_required', 'opening_checklist', 'closing_checklist', 'kiosk_checklist'
  ));

-- Fixed Sunday anchor so all businesses share predictable even/odd fortnights.
CREATE OR REPLACE FUNCTION public.task_manager_business_biweekly_period_start(p_business_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start date;
  v_anchor date := '2024-01-07'::date;
  v_weeks integer;
BEGIN
  v_week_start := public.task_manager_business_week_start(p_business_id);
  v_weeks := (v_week_start - v_anchor) / 7;
  IF v_weeks % 2 = 0 THEN
    RETURN v_week_start;
  END IF;
  RETURN v_week_start - 7;
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_business_biweekly_period_start(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.task_manager_reset_weekly_round_robin(p_business_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start date;
  v_biweekly_period_start date;
  v_reset_count integer := 0;
  g RECORD;
  slot RECORD;
  v_next_sort integer;
  v_new_task_id uuid;
  v_period_start date;
  anchor public.task_manager_tasks%ROWTYPE;
BEGIN
  v_week_start := public.task_manager_business_week_start(p_business_id);
  v_biweekly_period_start := public.task_manager_business_biweekly_period_start(p_business_id);

  FOR g IN
    SELECT id, reset_cadence
    FROM public.task_manager_round_robin_groups
    WHERE business_id = p_business_id
      AND reset_cadence IN ('weekly_sunday', 'biweekly_sunday')
  LOOP
    v_period_start := CASE
      WHEN g.reset_cadence = 'biweekly_sunday' THEN v_biweekly_period_start
      ELSE v_week_start
    END;

    IF COALESCE(
      (SELECT current_week_start FROM public.task_manager_round_robin_groups WHERE id = g.id),
      '1900-01-01'::date
    ) >= v_period_start THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(max(round_robin_sort_order), -1) + 1 INTO v_next_sort
    FROM public.task_manager_tasks
    WHERE round_robin_group_id = g.id
      AND business_id = p_business_id
      AND status <> 'cancelled';

    FOR slot IN
      SELECT DISTINCT round_robin_slot_order AS slot_order
      FROM public.task_manager_tasks
      WHERE round_robin_group_id = g.id
        AND business_id = p_business_id
        AND round_robin_slot_order IS NOT NULL
        AND status <> 'cancelled'
      ORDER BY 1
    LOOP
      IF EXISTS (
        SELECT 1
        FROM public.task_manager_tasks
        WHERE round_robin_group_id = g.id
          AND business_id = p_business_id
          AND round_robin_slot_order = slot.slot_order
          AND round_robin_week_start = v_period_start
          AND status <> 'cancelled'
      ) THEN
        CONTINUE;
      END IF;

      SELECT * INTO anchor
      FROM public.task_manager_tasks
      WHERE round_robin_group_id = g.id
        AND business_id = p_business_id
        AND round_robin_slot_order = slot.slot_order
        AND status <> 'cancelled'
      ORDER BY created_at ASC
      LIMIT 1;

      IF anchor.id IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.task_manager_tasks (
        business_id, title, description, category, category_id, priority,
        assignment_scope, assigned_to, status, available_at, due_at,
        requires_photo, requires_notes, peer_review_required, instructions, checklist,
        required_form_id, module_link_key, due_schedule_mode, round_robin_group_id,
        round_robin_sort_order, round_robin_slot_order, round_robin_week_start,
        review_status, created_by
      )
      VALUES (
        anchor.business_id, anchor.title, anchor.description, anchor.category, anchor.category_id, anchor.priority,
        anchor.assignment_scope, anchor.assigned_to, 'to_do', now(), NULL,
        anchor.requires_photo, anchor.requires_notes, anchor.peer_review_required, anchor.instructions, anchor.checklist,
        anchor.required_form_id, anchor.module_link_key, anchor.due_schedule_mode, g.id,
        v_next_sort, slot.slot_order, v_period_start,
        'not_required', anchor.created_by
      )
      RETURNING id INTO v_new_task_id;

      INSERT INTO public.task_manager_training_resources (
        business_id, task_id, template_id, hr_training_item_id, title, resource_type,
        resource_url, content, is_required, created_by
      )
      SELECT
        tr.business_id, v_new_task_id, NULL, tr.hr_training_item_id, tr.title, tr.resource_type,
        tr.resource_url, tr.content, tr.is_required, tr.created_by
      FROM public.task_manager_training_resources tr
      WHERE tr.task_id = anchor.id;

      v_next_sort := v_next_sort + 1;
    END LOOP;

    UPDATE public.task_manager_round_robin_groups
    SET current_week_start = v_period_start
    WHERE id = g.id;

    v_reset_count := v_reset_count + 1;
  END LOOP;

  RETURN v_reset_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_kiosk_queue_tier(
  p_task public.task_manager_tasks,
  p_business_id uuid
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_today date;
  v_week_start date;
  v_biweekly_period_start date;
  v_due_date date;
BEGIN
  IF p_task.due_schedule_mode = 'daily_required' THEN
    RETURN 1;
  END IF;

  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;

  v_today := (now() AT TIME ZONE v_tz)::date;
  v_week_start := public.task_manager_business_week_start(p_business_id);
  v_biweekly_period_start := public.task_manager_business_biweekly_period_start(p_business_id);
  v_due_date := COALESCE(
    (p_task.due_at AT TIME ZONE v_tz)::date,
    (p_task.available_at AT TIME ZONE v_tz)::date,
    p_task.schedule_once_date
  );

  IF p_task.due_schedule_mode = 'specific_date' AND v_due_date = v_today THEN
    RETURN 2;
  END IF;
  IF p_task.due_schedule_mode = 'frequency'
     AND p_task.schedule_type = 'once'
     AND p_task.schedule_once_date = v_today THEN
    RETURN 2;
  END IF;

  IF COALESCE(p_task.priority_boost, 0) > 0 THEN
    RETURN 3;
  END IF;
  IF p_task.occurrence_status IN ('missed', 'incomplete') THEN
    RETURN 3;
  END IF;
  IF p_task.due_schedule_mode = 'weekly_round_robin'
     AND p_task.round_robin_week_start IS NOT NULL
     AND p_task.round_robin_week_start < v_week_start THEN
    RETURN 3;
  END IF;
  IF p_task.due_schedule_mode = 'biweekly_round_robin'
     AND p_task.round_robin_week_start IS NOT NULL
     AND p_task.round_robin_week_start < v_biweekly_period_start THEN
    RETURN 3;
  END IF;
  IF p_task.due_schedule_mode IN ('weekly_round_robin', 'biweekly_round_robin', 'round_robin', 'frequency')
     AND p_task.due_at IS NOT NULL
     AND p_task.due_at < now() THEN
    RETURN 3;
  END IF;
  IF p_task.template_id IS NOT NULL
     AND p_task.due_at IS NOT NULL
     AND p_task.due_at < now() THEN
    RETURN 3;
  END IF;
  IF p_task.due_schedule_mode = 'specific_date'
     AND v_due_date IS NOT NULL
     AND v_due_date < v_today THEN
    RETURN 3;
  END IF;

  RETURN 4;
END;
$$;
