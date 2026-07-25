-- Skip task (PIN + reason + notes) and sales-aware kiosk queue prioritization.

ALTER TABLE public.task_manager_categories
  ADD COLUMN IF NOT EXISTS location_sensitivity text NOT NULL DEFAULT 'none';

ALTER TABLE public.task_manager_categories
  DROP CONSTRAINT IF EXISTS task_manager_categories_location_sensitivity_check;

ALTER TABLE public.task_manager_categories
  ADD CONSTRAINT task_manager_categories_location_sensitivity_check
  CHECK (location_sensitivity IN ('none', 'customer_area', 'kitchen', 'concession', 'back_of_house'));

COMMENT ON COLUMN public.task_manager_categories.location_sensitivity IS
  'Kiosk queue: customer_area deprioritized when admission traffic is high; kitchen when food orders are high.';

ALTER TABLE public.task_manager_tasks
  ADD COLUMN IF NOT EXISTS skip_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_skipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_skipped_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.task_manager_queue_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  sales_aware_queue_enabled boolean NOT NULL DEFAULT true,
  admission_lookback_minutes integer NOT NULL DEFAULT 180 CHECK (admission_lookback_minutes BETWEEN 15 AND 720),
  kitchen_lookback_minutes integer NOT NULL DEFAULT 60 CHECK (kitchen_lookback_minutes BETWEEN 5 AND 240),
  admission_busy_threshold integer NOT NULL DEFAULT 15 CHECK (admission_busy_threshold BETWEEN 1 AND 500),
  kitchen_busy_threshold integer NOT NULL DEFAULT 8 CHECK (kitchen_busy_threshold BETWEEN 1 AND 500),
  admission_slow_threshold integer NOT NULL DEFAULT 5 CHECK (admission_slow_threshold BETWEEN 0 AND 500),
  kitchen_slow_threshold integer NOT NULL DEFAULT 3 CHECK (kitchen_slow_threshold BETWEEN 0 AND 500),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.task_manager_queue_settings IS
  'Per-business thresholds for sales-aware task kiosk queue ordering.';

ALTER TABLE public.task_manager_queue_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Task manager queue settings managers" ON public.task_manager_queue_settings;
CREATE POLICY "Task manager queue settings managers"
  ON public.task_manager_queue_settings FOR ALL TO authenticated
  USING (public.task_manager_is_business_manager(business_id))
  WITH CHECK (public.task_manager_is_business_manager(business_id));

DROP POLICY IF EXISTS "Task manager queue settings members read" ON public.task_manager_queue_settings;
CREATE POLICY "Task manager queue settings members read"
  ON public.task_manager_queue_settings FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_manager_queue_settings TO authenticated;

-- Best-effort backfill for common OTWK-style category names.
UPDATE public.task_manager_categories c
SET location_sensitivity = 'customer_area'
WHERE c.location_sensitivity = 'none'
  AND (
    c.name ILIKE '%structure%'
    OR c.name ILIKE '%play%'
    OR c.name ILIKE '%customer%'
    OR c.name ILIKE '%admission%'
  );

UPDATE public.task_manager_categories c
SET location_sensitivity = 'kitchen'
WHERE c.location_sensitivity = 'none'
  AND (
    c.name ILIKE '%kitchen%'
    OR c.name ILIKE '%grill%'
    OR c.name ILIKE '%food%'
  );

UPDATE public.task_manager_categories c
SET location_sensitivity = 'concession'
WHERE c.location_sensitivity = 'none'
  AND (
    c.name ILIKE '%concession%'
    OR c.name ILIKE '%cleaning%'
    OR c.name ILIKE '%pop%'
    OR c.name ILIKE '%nacho%'
  );

CREATE OR REPLACE FUNCTION public.task_manager_queue_settings_row(p_business_id uuid)
RETURNS public.task_manager_queue_settings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.task_manager_queue_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.task_manager_queue_settings
  WHERE business_id = p_business_id;

  IF v_row.business_id IS NULL THEN
    v_row.business_id := p_business_id;
    v_row.sales_aware_queue_enabled := true;
    v_row.admission_lookback_minutes := 180;
    v_row.kitchen_lookback_minutes := 60;
    v_row.admission_busy_threshold := 15;
    v_row.kitchen_busy_threshold := 8;
    v_row.admission_slow_threshold := 5;
    v_row.kitchen_slow_threshold := 3;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_pos_inventory_is_kitchen_item(p_inventory_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pos_inventory pi
    WHERE pi.id = p_inventory_id
      AND pi.station_ids IS NOT NULL
      AND NULLIF(trim(both '[]' from COALESCE(pi.station_ids::text, '')), '') IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.task_manager_pos_inventory_is_admission_item(p_inventory_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pos_inventory pi
    LEFT JOIN public.pos_categories pc ON pc.id = pi.category_id
    WHERE pi.id = p_inventory_id
      AND (
        COALESCE(pi.website_show_admission_pricing, false) = true
        OR COALESCE(pc.name, '') ILIKE '%admission%'
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.task_manager_facility_busy_signals(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.task_manager_queue_settings%ROWTYPE;
  v_admission_count integer := 0;
  v_kitchen_count integer := 0;
  v_checkin_count integer := 0;
BEGIN
  v_settings := public.task_manager_queue_settings_row(p_business_id);

  SELECT COUNT(DISTINCT ps.id)::integer INTO v_admission_count
  FROM public.pos_sales ps
  WHERE ps.business_id = p_business_id
    AND ps.created_at >= now() - make_interval(mins => v_settings.admission_lookback_minutes)
    AND EXISTS (
      SELECT 1
      FROM public.pos_sale_items psi
      WHERE psi.sale_id = ps.id
        AND psi.business_id = p_business_id
        AND public.task_manager_pos_inventory_is_admission_item(psi.inventory_id)
    );

  SELECT COUNT(DISTINCT ps.id)::integer INTO v_kitchen_count
  FROM public.pos_sales ps
  WHERE ps.business_id = p_business_id
    AND ps.created_at >= now() - make_interval(mins => v_settings.kitchen_lookback_minutes)
    AND EXISTS (
      SELECT 1
      FROM public.pos_sale_items psi
      WHERE psi.sale_id = ps.id
        AND psi.business_id = p_business_id
        AND public.task_manager_pos_inventory_is_kitchen_item(psi.inventory_id)
    );

  BEGIN
    SELECT COUNT(*)::integer INTO v_checkin_count
    FROM public.booking_participants bp
    JOIN public.bookings b ON b.id = bp.booking_id
    WHERE b.business_id = p_business_id
      AND bp.checked_in_at IS NOT NULL
      AND bp.checked_in_at >= now() - make_interval(mins => v_settings.admission_lookback_minutes);
  EXCEPTION
    WHEN undefined_column THEN
      v_checkin_count := 0;
  END;

  RETURN jsonb_build_object(
    'sales_aware_queue_enabled', COALESCE(v_settings.sales_aware_queue_enabled, true),
    'admission_txn_count', v_admission_count,
    'kitchen_order_count', v_kitchen_count,
    'booking_checkin_count', v_checkin_count,
    'admission_activity_count', v_admission_count + v_checkin_count,
    'admission_lookback_minutes', v_settings.admission_lookback_minutes,
    'kitchen_lookback_minutes', v_settings.kitchen_lookback_minutes,
    'admission_busy_threshold', v_settings.admission_busy_threshold,
    'kitchen_busy_threshold', v_settings.kitchen_busy_threshold,
    'admission_slow_threshold', v_settings.admission_slow_threshold,
    'kitchen_slow_threshold', v_settings.kitchen_slow_threshold,
    'play_area_busy', (v_admission_count + v_checkin_count) >= v_settings.admission_busy_threshold,
    'kitchen_busy', v_kitchen_count >= v_settings.kitchen_busy_threshold,
    'play_area_slow', (v_admission_count + v_checkin_count) <= v_settings.admission_slow_threshold,
    'kitchen_slow', v_kitchen_count <= v_settings.kitchen_slow_threshold
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_task_busy_sort_key(
  p_location_sensitivity text,
  p_signals jsonb
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean := COALESCE((p_signals->>'sales_aware_queue_enabled')::boolean, true);
  v_zone text := COALESCE(p_location_sensitivity, 'none');
  v_admission_activity integer := COALESCE((p_signals->>'admission_activity_count')::integer, 0);
  v_kitchen_count integer := COALESCE((p_signals->>'kitchen_order_count')::integer, 0);
  v_admission_busy boolean := COALESCE((p_signals->>'play_area_busy')::boolean, false);
  v_kitchen_busy boolean := COALESCE((p_signals->>'kitchen_busy')::boolean, false);
  v_admission_slow boolean := COALESCE((p_signals->>'play_area_slow')::boolean, false);
  v_kitchen_slow boolean := COALESCE((p_signals->>'kitchen_slow')::boolean, false);
BEGIN
  IF NOT v_enabled OR v_zone = 'none' THEN
    RETURN 0;
  END IF;

  IF v_zone = 'customer_area' THEN
    IF v_admission_busy THEN
      RETURN 1000;
    ELSIF v_admission_slow THEN
      RETURN -100;
    END IF;
    RETURN 0;
  END IF;

  IF v_zone = 'kitchen' THEN
    IF v_kitchen_busy THEN
      RETURN 1000;
    ELSIF v_kitchen_slow THEN
      RETURN -100;
    END IF;
    RETURN 0;
  END IF;

  -- concession / back_of_house stay neutral; they surface when other zones are penalized.
  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_skip_task(
  p_business_id uuid,
  p_task_id uuid,
  p_employee_id uuid,
  p_pin text,
  p_reason text,
  p_notes text
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
  WHERE id = p_task_id;

  INSERT INTO public.task_manager_activity (business_id, task_id, actor_id, action, details)
  VALUES (
    p_business_id,
    p_task_id,
    p_employee_id,
    'task_skipped',
    jsonb_build_object(
      'reason', v_reason,
      'notes', trim(p_notes),
      'skip_count', COALESCE(v_task.skip_count, 0) + 1
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_queue_settings_row(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_facility_busy_signals(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.task_manager_task_busy_sort_key(text, jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.task_manager_skip_task(uuid, uuid, uuid, text, text, text) TO anon, authenticated;

-- Patch facility queue ordering (sales-aware + recently skipped to back).
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
    SELECT tm.*, COALESCE(cat.location_sensitivity, 'none') AS location_sensitivity
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
    c.id, c.template_id, c.title, c.description, c.category, c.priority, c.assignment_scope,
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

-- Employee-scoped next task uses the same sales-aware ordering.
DROP FUNCTION IF EXISTS public.task_manager_get_next_task(uuid, uuid);

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
    SELECT tm.*
    FROM public.task_manager_tasks tm
    LEFT JOIN round_robin_heads rr ON rr.round_robin_group_id = tm.round_robin_group_id
    LEFT JOIN public.task_manager_categories cat ON cat.id = tm.category_id
    WHERE tm.business_id = p_business_id
      AND tm.status IN ('to_do', 'in_progress')
      AND tm.available_at <= now()
      AND tm.due_schedule_mode NOT IN ('opening_checklist', 'closing_checklist', 'kiosk_checklist')
      AND COALESCE(cat.kiosk_checklist_button, false) = false
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
      public.task_manager_kiosk_queue_tier(tm, p_business_id) ASC,
      public.task_manager_task_busy_sort_key(COALESCE(cat.location_sensitivity, 'none'), v_signals) ASC,
      CASE WHEN tm.handoff_at IS NOT NULL AND tm.status = 'in_progress' THEN 0 ELSE 1 END,
      CASE WHEN tm.handoff_by IS NOT NULL AND tm.handoff_by = p_employee_id THEN 1 ELSE 0 END,
      tm.last_skipped_at ASC NULLS FIRST,
      tm.handoff_at DESC NULLS LAST,
      tm.priority_boost DESC,
      CASE WHEN tm.assigned_to = p_employee_id THEN 0 ELSE 1 END,
      CASE tm.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      COALESCE(tm.due_at, tm.available_at) ASC,
      tm.round_robin_sort_order ASC NULLS LAST,
      tm.created_at ASC
    LIMIT 1
  )
  SELECT
    c.id, c.template_id, c.title, c.description, c.category, c.priority, c.assignment_scope,
    c.due_at, c.requires_photo, c.requires_notes, c.instructions, c.checklist,
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
          'scope', CASE WHEN tr.task_id = c.id THEN 'task' ELSE 'template' END,
          'hr_training_item_id', tr.hr_training_item_id,
          'sort_order', CASE WHEN tr.task_id = c.id THEN 0 ELSE 1000 END + row_number() OVER (ORDER BY tr.created_at)
        ) AS resource_row
        FROM public.task_manager_training_resources tr
        LEFT JOIN public.task_manager_employee_training_completions etc
          ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
        WHERE tr.hr_training_item_id IS NULL
          AND (
            tr.task_id = c.id
            OR (c.template_id IS NOT NULL AND tr.template_id = c.template_id AND tr.task_id IS NULL)
          )
        UNION ALL
        SELECT jsonb_array_elements(public.task_manager_hr_training_resource_rows(hti, tr.id, p_employee_id)) AS resource_row
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
      LEFT JOIN public.task_manager_employee_training_completions etc
        ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
      WHERE (
          tr.task_id = c.id
          OR (c.template_id IS NOT NULL AND tr.template_id = c.template_id AND tr.task_id IS NULL)
        )
        AND tr.is_required = true
        AND etc.id IS NULL
    ), 0),
    c.required_form_id,
    (SELECT ft.title FROM public.forms_templates ft WHERE ft.id = c.required_form_id),
    c.scheduled_for,
    c.priority_boost,
    c.module_link_key,
    (public.task_manager_module_link_def(c.module_link_key)->>'path')::text,
    (public.task_manager_module_link_def(c.module_link_key)->>'button_label')::text,
    public.task_manager_module_link_allowed(p_business_id, p_employee_id, c.module_link_key),
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

GRANT EXECUTE ON FUNCTION public.task_manager_get_next_task(uuid, uuid) TO anon, authenticated;

-- Queue preview uses the same ordering.
DROP FUNCTION IF EXISTS public.task_manager_get_kiosk_queue_preview(uuid, uuid);

CREATE OR REPLACE FUNCTION public.task_manager_get_kiosk_queue_preview(
  p_business_id uuid,
  p_employee_id uuid DEFAULT NULL
)
RETURNS TABLE (
  task_id uuid,
  title text,
  queue_position integer,
  status_flag text,
  last_completed_at timestamptz,
  priority text,
  category text,
  busy_sort_key integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done_ids uuid[] := '{}';
  v_next public.task_manager_tasks%ROWTYPE;
  v_position integer := 0;
  v_max_iterations integer := 500;
  v_i integer := 0;
  v_signals jsonb;
  v_busy_key integer;
  v_cat_sensitivity text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.task_manager_is_business_manager(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM public.task_manager_generate_due_tasks(p_business_id);
  PERFORM public.task_manager_reset_weekly_round_robin(p_business_id);
  PERFORM public.task_manager_reset_shift_checklists(p_business_id);

  v_signals := public.task_manager_facility_busy_signals(p_business_id);

  LOOP
    v_i := v_i + 1;
    EXIT WHEN v_i > v_max_iterations;

    SELECT tm.* INTO v_next
    FROM public.task_manager_tasks tm
    LEFT JOIN LATERAL (
      SELECT h.id AS head_task_id
      FROM public.task_manager_tasks h
      WHERE h.round_robin_group_id = tm.round_robin_group_id
        AND h.business_id = p_business_id
        AND h.status IN ('to_do', 'in_progress')
        AND NOT (h.id = ANY(v_done_ids))
      ORDER BY h.round_robin_sort_order ASC NULLS LAST, h.created_at ASC
      LIMIT 1
    ) rr ON tm.round_robin_group_id IS NOT NULL
    LEFT JOIN public.task_manager_categories cat ON cat.id = tm.category_id
    WHERE tm.business_id = p_business_id
      AND tm.status IN ('to_do', 'in_progress')
      AND tm.available_at <= now()
      AND tm.due_schedule_mode NOT IN ('opening_checklist', 'closing_checklist', 'kiosk_checklist')
      AND COALESCE(cat.kiosk_checklist_button, false) = false
      AND NOT (tm.id = ANY(v_done_ids))
      AND (
        p_employee_id IS NULL
          AND tm.assignment_scope = 'facility'
          AND tm.assigned_to IS NULL
        OR p_employee_id IS NOT NULL
          AND tm.assigned_to = p_employee_id
      )
      AND (
        p_employee_id IS NULL
        OR tm.category_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.task_manager_category_employees ce
          WHERE ce.category_id = tm.category_id
        )
        OR EXISTS (
          SELECT 1 FROM public.task_manager_category_employees ce
          WHERE ce.category_id = tm.category_id
            AND ce.employee_id = p_employee_id
        )
      )
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
      CASE WHEN p_employee_id IS NOT NULL AND tm.handoff_by IS NOT NULL AND tm.handoff_by = p_employee_id THEN 1 ELSE 0 END,
      tm.last_skipped_at ASC NULLS FIRST,
      tm.handoff_at DESC NULLS LAST,
      tm.priority_boost DESC,
      CASE WHEN p_employee_id IS NOT NULL AND tm.assigned_to = p_employee_id THEN 0 ELSE 1 END,
      CASE tm.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      COALESCE(tm.due_at, tm.available_at) ASC,
      tm.round_robin_sort_order ASC NULLS LAST,
      tm.created_at ASC
    LIMIT 1;

    EXIT WHEN v_next.id IS NULL;

    SELECT COALESCE(cat.location_sensitivity, 'none') INTO v_cat_sensitivity
    FROM public.task_manager_categories cat
    WHERE cat.id = v_next.category_id;

    v_cat_sensitivity := COALESCE(v_cat_sensitivity, 'none');
    v_busy_key := public.task_manager_task_busy_sort_key(v_cat_sensitivity, v_signals);
    v_position := v_position + 1;
    v_done_ids := array_append(v_done_ids, v_next.id);

    task_id := v_next.id;
    title := v_next.title;
    queue_position := v_position;
    status_flag := CASE
      WHEN public.task_manager_kiosk_queue_tier(v_next, p_business_id) = 3 THEN 'overdue'
      ELSE 'not_completed'
    END;
    last_completed_at := public.task_manager_task_last_completed_at(v_next);
    priority := v_next.priority;
    category := v_next.category;
    busy_sort_key := v_busy_key;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_get_kiosk_queue_preview(uuid, uuid) TO authenticated;
