-- Kiosk skip: single task, whole category, or entire location zone (e.g. all customer-area tasks).

CREATE OR REPLACE FUNCTION public.task_manager_skip_scope_matches(
  p_business_id uuid,
  p_anchor_task_id uuid,
  p_scope text
)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anchor public.task_manager_tasks%ROWTYPE;
  v_cat public.task_manager_categories%ROWTYPE;
  v_scope text := lower(trim(COALESCE(p_scope, 'task')));
BEGIN
  SELECT tm.* INTO v_anchor
  FROM public.task_manager_tasks tm
  WHERE tm.id = p_anchor_task_id
    AND tm.business_id = p_business_id;

  IF v_anchor.id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_cat
  FROM public.task_manager_categories
  WHERE id = v_anchor.category_id;

  IF v_scope NOT IN ('task', 'category', 'location_zone') THEN
    v_scope := 'task';
  END IF;

  IF v_scope = 'category' AND v_anchor.category_id IS NULL THEN
    v_scope := 'task';
  END IF;

  IF v_scope = 'location_zone'
     AND (v_cat.id IS NULL OR COALESCE(v_cat.location_sensitivity, 'none') = 'none') THEN
    v_scope := 'task';
  END IF;

  RETURN QUERY
  SELECT tm.id
  FROM public.task_manager_tasks tm
  LEFT JOIN public.task_manager_categories cat ON cat.id = tm.category_id
  WHERE tm.business_id = p_business_id
    AND tm.status IN ('to_do', 'in_progress')
    AND tm.available_at <= now()
    AND tm.due_schedule_mode NOT IN ('opening_checklist', 'closing_checklist', 'kiosk_checklist')
    AND COALESCE(cat.kiosk_checklist_button, false) = false
    AND tm.assignment_scope = 'facility'
    AND tm.assigned_to IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.forms_submissions fs
      WHERE fs.business_id = p_business_id
        AND fs.task_template_id = tm.template_id
        AND fs.scheduled_for = tm.scheduled_for
    )
    AND (
      (v_scope = 'task' AND tm.id = p_anchor_task_id)
      OR (v_scope = 'category' AND tm.category_id = v_anchor.category_id)
      OR (
        v_scope = 'location_zone'
        AND COALESCE(cat.location_sensitivity, 'none') = COALESCE(v_cat.location_sensitivity, 'none')
        AND COALESCE(v_cat.location_sensitivity, 'none') <> 'none'
      )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_skip_scope_preview(
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
  v_task public.task_manager_tasks%ROWTYPE;
  v_cat public.task_manager_categories%ROWTYPE;
  v_zone text;
  v_category_count integer := 0;
  v_zone_count integer := 0;
BEGIN
  SELECT tm.* INTO v_task
  FROM public.task_manager_tasks tm
  WHERE tm.id = p_task_id
    AND tm.business_id = p_business_id;

  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Task is no longer available');
  END IF;

  SELECT * INTO v_cat
  FROM public.task_manager_categories
  WHERE id = v_task.category_id;

  v_zone := COALESCE(v_cat.location_sensitivity, 'none');

  SELECT COUNT(*)::integer INTO v_category_count
  FROM public.task_manager_skip_scope_matches(p_business_id, p_task_id, 'category') AS sid
  WHERE v_task.category_id IS NOT NULL;

  SELECT COUNT(*)::integer INTO v_zone_count
  FROM public.task_manager_skip_scope_matches(p_business_id, p_task_id, 'location_zone') AS sid
  WHERE v_zone <> 'none';

  RETURN jsonb_build_object(
    'success', true,
    'category_id', v_task.category_id,
    'category_name', COALESCE(v_cat.name, v_task.category, 'Uncategorized'),
    'location_sensitivity', v_zone,
    'counts', jsonb_build_object(
      'task', 1,
      'category', CASE WHEN v_task.category_id IS NULL THEN 0 ELSE v_category_count END,
      'location_zone', CASE WHEN v_zone = 'none' THEN 0 ELSE v_zone_count END
    )
  );
END;
$$;

DROP FUNCTION IF EXISTS public.task_manager_skip_task(uuid, uuid, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.task_manager_skip_task(
  p_business_id uuid,
  p_task_id uuid,
  p_employee_id uuid,
  p_pin text,
  p_reason text,
  p_notes text,
  p_scope text DEFAULT 'task'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified uuid;
  v_task public.task_manager_tasks%ROWTYPE;
  v_cat public.task_manager_categories%ROWTYPE;
  v_reason text := lower(trim(COALESCE(p_reason, '')));
  v_scope text := lower(trim(COALESCE(p_scope, 'task')));
  v_target_id uuid;
  v_skipped integer := 0;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  IF v_reason NOT IN ('customer_location_busy', 'area_being_repaired', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select a valid skip reason');
  END IF;

  IF length(trim(COALESCE(p_notes, ''))) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Notes are required when skipping a task');
  END IF;

  IF v_scope NOT IN ('task', 'category', 'location_zone') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select a valid skip scope');
  END IF;

  SELECT tm.* INTO v_task
  FROM public.task_manager_tasks tm
  WHERE tm.id = p_task_id
    AND tm.business_id = p_business_id
    AND tm.status IN ('to_do', 'in_progress')
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Task is no longer available');
  END IF;

  IF v_task.assigned_to IS NOT NULL AND v_task.assigned_to <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'This task is assigned to another employee');
  END IF;

  SELECT * INTO v_cat
  FROM public.task_manager_categories
  WHERE id = v_task.category_id;

  IF v_task.due_schedule_mode IN ('opening_checklist', 'closing_checklist', 'kiosk_checklist')
     OR COALESCE(v_cat.kiosk_checklist_button, false) IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'Use the checklist screen to update this item');
  END IF;

  IF v_scope = 'category' AND v_task.category_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This task has no category to skip as a group');
  END IF;

  IF v_scope = 'location_zone'
     AND (v_cat.id IS NULL OR COALESCE(v_cat.location_sensitivity, 'none') = 'none') THEN
    RETURN jsonb_build_object('success', false, 'error', 'This task is not in a skippable location zone');
  END IF;

  FOR v_target_id IN
    SELECT sid
    FROM public.task_manager_skip_scope_matches(p_business_id, p_task_id, v_scope) AS sid
  LOOP
    UPDATE public.task_manager_tasks
    SET
      status = 'to_do',
      claimed_by = NULL,
      handoff_notes = NULL,
      handoff_at = NULL,
      handoff_by = NULL,
      handoff_checklist = NULL,
      skip_count = COALESCE(skip_count, 0) + 1,
      last_skipped_at = now(),
      last_skipped_by = p_employee_id
    WHERE id = v_target_id
      AND business_id = p_business_id
      AND status IN ('to_do', 'in_progress');

    IF FOUND THEN
      v_skipped := v_skipped + 1;
      INSERT INTO public.task_manager_activity (business_id, task_id, actor_id, action, details)
      VALUES (
        p_business_id,
        v_target_id,
        p_employee_id,
        'task_skipped',
        jsonb_build_object(
          'reason', v_reason,
          'notes', trim(p_notes),
          'scope', v_scope,
          'anchor_task_id', p_task_id,
          'category_id', v_task.category_id,
          'location_sensitivity', COALESCE(v_cat.location_sensitivity, 'none')
        )
      );
    END IF;
  END LOOP;

  IF v_skipped = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tasks were available to skip');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'skipped_count', v_skipped,
    'scope', v_scope
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_skip_scope_matches(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_skip_scope_preview(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_skip_task(uuid, uuid, uuid, text, text, text, text) TO anon, authenticated;

-- Expose category zone metadata on the next-task payload for kiosk UI labels.
DROP FUNCTION IF EXISTS public.task_manager_get_next_facility_task(uuid);
DROP FUNCTION IF EXISTS public.task_manager_get_next_facility_task(uuid, uuid);

CREATE OR REPLACE FUNCTION public.task_manager_get_next_facility_task(
  p_business_id uuid,
  p_employee_id uuid DEFAULT NULL
)
RETURNS TABLE (
  task_id uuid,
  template_id uuid,
  title text,
  description text,
  category text,
  category_id uuid,
  location_sensitivity text,
  priority text,
  assignment_scope text,
  due_at timestamptz,
  requires_photo boolean,
  photo_requirement_mode text,
  requires_notes boolean,
  instructions text,
  checklist jsonb,
  training_resources jsonb,
  missing_required_training integer,
  required_form_id uuid,
  required_form_title text,
  scheduled_for timestamptz,
  priority_boost integer,
  module_link_key text,
  module_link_path text,
  module_link_button_label text,
  module_link_allowed boolean,
  handoff_notes text,
  handoff_at timestamptz,
  handoff_by_name text,
  handoff_checklist jsonb,
  facility_busy_signals jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signals jsonb;
BEGIN
  PERFORM public.task_manager_generate_due_tasks(p_business_id);
  PERFORM public.task_manager_reset_weekly_round_robin(p_business_id);
  PERFORM public.task_manager_reset_shift_checklists(p_business_id);

  v_signals := public.task_manager_facility_busy_signals(p_business_id);

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
    SELECT tm.*, COALESCE(cat.location_sensitivity, 'none') AS cat_location_sensitivity
    FROM public.task_manager_tasks tm
    LEFT JOIN round_robin_heads rr ON rr.round_robin_group_id = tm.round_robin_group_id
    LEFT JOIN public.task_manager_categories cat ON cat.id = tm.category_id
    WHERE tm.business_id = p_business_id
      AND tm.status IN ('to_do', 'in_progress')
      AND tm.available_at <= now()
      AND tm.due_schedule_mode NOT IN ('opening_checklist', 'closing_checklist', 'kiosk_checklist')
      AND COALESCE(cat.kiosk_checklist_button, false) = false
      AND tm.assignment_scope = 'facility'
      AND tm.assigned_to IS NULL
      AND (tm.round_robin_group_id IS NULL OR tm.id = rr.head_task_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.forms_submissions fs
        WHERE fs.business_id = p_business_id
          AND fs.task_template_id = tm.template_id
          AND fs.scheduled_for = tm.scheduled_for
      )
    ORDER BY
      public.task_manager_kiosk_queue_tier(tm, p_business_id) ASC,
      public.task_manager_task_busy_sort_key(COALESCE(cat.location_sensitivity, 'none'), v_signals) ASC,
      CASE WHEN tm.handoff_at IS NOT NULL AND tm.status = 'in_progress' THEN 0 ELSE 1 END,
      tm.last_skipped_at ASC NULLS FIRST,
      tm.handoff_at DESC NULLS LAST,
      tm.priority_boost DESC,
      CASE tm.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      COALESCE(tm.due_at, tm.available_at) ASC,
      tm.round_robin_sort_order ASC NULLS LAST,
      tm.created_at ASC
    LIMIT 1
  )
  SELECT
    c.id, c.template_id, c.title, c.description, c.category, c.category_id, c.cat_location_sensitivity,
    c.priority, c.assignment_scope,
    c.due_at, c.requires_photo, c.photo_requirement_mode, c.requires_notes, c.instructions, c.checklist,
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
          'completed', (
            p_employee_id IS NOT NULL
            AND public.task_manager_training_resource_completed(p_business_id, tr.id, p_employee_id)
          ),
          'scope', CASE WHEN tr.task_id = c.id THEN 'task' ELSE 'template' END,
          'hr_training_item_id', tr.hr_training_item_id,
          'sort_order', CASE WHEN tr.task_id = c.id THEN 0 ELSE 1000 END + row_number() OVER (ORDER BY tr.created_at)
        ) AS resource_row
        FROM public.task_manager_training_resources tr
        WHERE tr.hr_training_item_id IS NULL
          AND (
            tr.task_id = c.id
            OR (c.template_id IS NOT NULL AND tr.template_id = c.template_id AND tr.task_id IS NULL)
          )
        UNION ALL
        SELECT jsonb_array_elements(
          public.task_manager_hr_training_resource_rows(hti, tr.id, p_employee_id)
        ) AS resource_row
        FROM public.task_manager_training_resources tr
        JOIN public.hr_training_items hti ON hti.id = tr.hr_training_item_id
        WHERE hti.is_active = true
          AND (
            tr.task_id = c.id
            OR (c.template_id IS NOT NULL AND tr.template_id = c.template_id AND tr.task_id IS NULL)
          )
      ) resources
    ), '[]'::jsonb),
    COALESCE((
      SELECT count(*)::integer
      FROM public.task_manager_training_resources tr
      WHERE (
          tr.task_id = c.id
          OR (c.template_id IS NOT NULL AND tr.template_id = c.template_id AND tr.task_id IS NULL)
        )
        AND tr.is_required = true
        AND (
          p_employee_id IS NULL
          OR NOT public.task_manager_training_resource_completed(p_business_id, tr.id, p_employee_id)
        )
    ), 0),
    c.required_form_id,
    (SELECT ft.title FROM public.forms_templates ft WHERE ft.id = c.required_form_id),
    c.scheduled_for,
    c.priority_boost,
    c.module_link_key,
    (public.task_manager_module_link_def(c.module_link_key)->>'path')::text,
    (public.task_manager_module_link_def(c.module_link_key)->>'button_label')::text,
    false,
    c.handoff_notes,
    c.handoff_at,
    (
      SELECT COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.first_name || ' ' || COALESCE(u.last_name, '')), ''), 'Staff')
      FROM public.users u
      WHERE u.id = c.handoff_by
    ),
    COALESCE(c.handoff_checklist, '[]'::jsonb),
    v_signals
  FROM candidate c;
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_get_next_facility_task(uuid, uuid) TO anon, authenticated;
