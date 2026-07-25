-- Weekly round robin carryover: incomplete tasks stay at the top; each Sunday appends
-- a fresh copy of every slot (A,B,C,D) to the bottom of the queue.

ALTER TABLE public.task_manager_tasks
  ADD COLUMN IF NOT EXISTS round_robin_slot_order integer,
  ADD COLUMN IF NOT EXISTS round_robin_week_start date;

CREATE INDEX IF NOT EXISTS idx_task_manager_tasks_weekly_round_robin_queue
  ON public.task_manager_tasks (round_robin_group_id, round_robin_sort_order)
  WHERE round_robin_group_id IS NOT NULL AND status IN ('to_do', 'in_progress');

-- Backfill slot/week for existing weekly round robin tasks.
UPDATE public.task_manager_tasks t
SET
  round_robin_slot_order = COALESCE(t.round_robin_slot_order, t.round_robin_sort_order),
  round_robin_week_start = COALESCE(
    t.round_robin_week_start,
    public.task_manager_business_week_start(t.business_id)
  )
FROM public.task_manager_round_robin_groups g
WHERE t.round_robin_group_id = g.id
  AND g.reset_cadence = 'weekly_sunday'
  AND t.round_robin_slot_order IS NULL
  AND t.round_robin_sort_order IS NOT NULL;

CREATE OR REPLACE FUNCTION public.task_manager_reset_weekly_round_robin(p_business_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start date;
  v_reset_count integer := 0;
  g RECORD;
  slot RECORD;
  v_next_sort integer;
  v_new_task_id uuid;
  anchor public.task_manager_tasks%ROWTYPE;
BEGIN
  v_week_start := public.task_manager_business_week_start(p_business_id);

  FOR g IN
    SELECT id
    FROM public.task_manager_round_robin_groups
    WHERE business_id = p_business_id
      AND reset_cadence = 'weekly_sunday'
      AND COALESCE(current_week_start, '1900-01-01'::date) < v_week_start
  LOOP
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
          AND round_robin_week_start = v_week_start
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
        required_form_id, due_schedule_mode, round_robin_group_id,
        round_robin_sort_order, round_robin_slot_order, round_robin_week_start,
        review_status, created_by
      )
      VALUES (
        anchor.business_id, anchor.title, anchor.description, anchor.category, anchor.category_id, anchor.priority,
        anchor.assignment_scope, anchor.assigned_to, 'to_do', now(), NULL,
        anchor.requires_photo, anchor.requires_notes, anchor.peer_review_required, anchor.instructions, anchor.checklist,
        anchor.required_form_id, anchor.due_schedule_mode, g.id,
        v_next_sort, slot.slot_order, v_week_start,
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
    SET current_week_start = v_week_start
    WHERE id = g.id;

    v_reset_count := v_reset_count + 1;
  END LOOP;

  RETURN v_reset_count;
END;
$$;
