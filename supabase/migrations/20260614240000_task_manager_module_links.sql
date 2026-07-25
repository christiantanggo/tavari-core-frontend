-- Task module links: open an in-app Tavari page from a kiosk/queue task, then return to complete.

ALTER TABLE public.task_manager_tasks
  ADD COLUMN IF NOT EXISTS module_link_key text;

ALTER TABLE public.task_manager_templates
  ADD COLUMN IF NOT EXISTS module_link_key text;

COMMENT ON COLUMN public.task_manager_tasks.module_link_key IS
  'Registry key for an in-app page (see task_manager_module_link_def). Staff open the page, return, then tap Complete.';

CREATE OR REPLACE FUNCTION public.user_business_role(
  p_business_id uuid,
  p_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_business_id IS NULL OR p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ur.role INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id = p_user_id
    AND ur.business_id = p_business_id
    AND ur.active IS TRUE
  LIMIT 1;

  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;

  SELECT bu.role INTO v_role
  FROM public.business_users bu
  WHERE bu.user_id = p_user_id
    AND bu.business_id = p_business_id
  LIMIT 1;

  RETURN COALESCE(v_role, 'employee');
END;
$$;

CREATE OR REPLACE FUNCTION public.user_has_business_permission(
  p_business_id uuid,
  p_user_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_business_id IS NULL OR p_user_id IS NULL OR p_permission_key IS NULL OR length(trim(p_permission_key)) = 0 THEN
    RETURN false;
  END IF;

  v_role := public.user_business_role(p_business_id, p_user_id);

  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' AND p_permission_key NOT LIKE 'owner.%' THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.business_id = p_business_id
      AND rp.role_key = v_role
      AND rp.permission_key = p_permission_key
      AND rp.granted IS TRUE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.user_has_any_business_permission(
  p_business_id uuid,
  p_user_id uuid,
  p_permission_keys text[]
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  IF p_permission_keys IS NULL OR cardinality(p_permission_keys) = 0 THEN
    RETURN false;
  END IF;

  FOREACH v_key IN ARRAY p_permission_keys LOOP
    IF public.user_has_business_permission(p_business_id, p_user_id, v_key) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

-- Keep in sync with src/helpers/taskManagerModuleLinks.js
CREATE OR REPLACE FUNCTION public.task_manager_module_link_def(p_key text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_key
    WHEN 'pos.daily_deposit' THEN jsonb_build_object(
      'path', '/dashboard/pos/daily-deposit',
      'button_label', 'Open Daily Deposit',
      'permission_keys', jsonb_build_array(
        'pos.daily_deposit.view',
        'pos.daily_deposit.edit',
        'pos.daily_deposit.create'
      )
    )
    WHEN 'pos.register' THEN jsonb_build_object(
      'path', '/dashboard/pos/register',
      'button_label', 'Open Register',
      'permission_keys', jsonb_build_array('pos.register.view', 'pos.register.edit')
    )
    WHEN 'pos.inventory' THEN jsonb_build_object(
      'path', '/dashboard/pos/inventory',
      'button_label', 'Open Inventory',
      'permission_keys', jsonb_build_array('pos.inventory.view', 'pos.inventory.edit')
    )
    WHEN 'pos.receipts' THEN jsonb_build_object(
      'path', '/dashboard/pos/receipts',
      'button_label', 'Open Receipts',
      'permission_keys', jsonb_build_array('pos.receipts.view', 'pos.receipts.edit')
    )
    WHEN 'pos.reports' THEN jsonb_build_object(
      'path', '/dashboard/pos/reports',
      'button_label', 'Open POS Reports',
      'permission_keys', jsonb_build_array('pos.sales.view_all')
    )
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_module_link_allowed(
  p_business_id uuid,
  p_employee_id uuid,
  p_module_link_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_def jsonb;
  v_keys text[];
BEGIN
  IF p_module_link_key IS NULL OR length(trim(p_module_link_key)) = 0 THEN
    RETURN false;
  END IF;

  v_def := public.task_manager_module_link_def(p_module_link_key);
  IF v_def IS NULL THEN
    RETURN false;
  END IF;

  SELECT array_agg(value::text)
  INTO v_keys
  FROM jsonb_array_elements_text(v_def->'permission_keys') AS value;

  RETURN public.user_has_any_business_permission(p_business_id, p_employee_id, v_keys);
END;
$$;

DROP FUNCTION IF EXISTS public.task_manager_get_checklist_tasks(uuid, uuid, uuid);

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
  missing_required_training integer,
  module_link_key text,
  module_link_path text,
  module_link_button_label text,
  module_link_allowed boolean
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
    ), 0),
    tm.module_link_key,
    (public.task_manager_module_link_def(tm.module_link_key)->>'path')::text,
    (public.task_manager_module_link_def(tm.module_link_key)->>'button_label')::text,
    public.task_manager_module_link_allowed(p_business_id, p_employee_id, tm.module_link_key)
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
  module_link_allowed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.task_manager_generate_due_tasks(p_business_id);
  PERFORM public.task_manager_reset_weekly_round_robin(p_business_id);
  PERFORM public.task_manager_reset_shift_checklists(p_business_id);

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
      AND tm.due_schedule_mode NOT IN ('opening_checklist', 'closing_checklist')
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
    public.task_manager_module_link_allowed(p_business_id, p_employee_id, c.module_link_key)
  FROM candidate c;
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
    required_form_id, module_link_key, priority_boost, created_by
  )
  SELECT
    t.business_id, t.id, t.title, t.description, t.category, t.category_id, t.priority,
    t.assignment_scope, t.default_assigned_to, 'to_do',
    scheduled_at, scheduled_at + make_interval(mins => t.due_window_minutes), scheduled_at,
    t.requires_photo, t.requires_notes, t.peer_review_required, t.instructions, t.checklist,
    t.required_form_id, t.module_link_key,
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
  PERFORM public.task_manager_reset_weekly_round_robin(p_business_id);
  PERFORM public.task_manager_reset_shift_checklists(p_business_id);
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_business_role(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_business_permission(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_any_business_permission(uuid, uuid, text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_module_link_def(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_module_link_allowed(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_get_checklist_tasks(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_get_next_task(uuid, uuid) TO anon, authenticated;
