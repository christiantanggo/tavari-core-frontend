-- Task Manager: managed categories with optional employee assignments

CREATE TABLE IF NOT EXISTS public.task_manager_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS public.task_manager_category_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.task_manager_categories(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_task_manager_categories_business
  ON public.task_manager_categories (business_id, is_active, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_task_manager_category_employees_category
  ON public.task_manager_category_employees (category_id, employee_id);

ALTER TABLE public.task_manager_templates
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.task_manager_categories(id) ON DELETE SET NULL;

ALTER TABLE public.task_manager_tasks
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.task_manager_categories(id) ON DELETE SET NULL;

-- Backfill categories from existing free-text values
INSERT INTO public.task_manager_categories (business_id, name)
SELECT DISTINCT business_id, trim(category)
FROM (
  SELECT business_id, category FROM public.task_manager_templates WHERE category IS NOT NULL AND trim(category) <> ''
  UNION
  SELECT business_id, category FROM public.task_manager_tasks WHERE category IS NOT NULL AND trim(category) <> ''
) src
ON CONFLICT (business_id, name) DO NOTHING;

UPDATE public.task_manager_templates t
SET category_id = c.id
FROM public.task_manager_categories c
WHERE t.category_id IS NULL
  AND t.category IS NOT NULL
  AND trim(t.category) <> ''
  AND c.business_id = t.business_id
  AND c.name = trim(t.category);

UPDATE public.task_manager_tasks t
SET category_id = c.id
FROM public.task_manager_categories c
WHERE t.category_id IS NULL
  AND t.category IS NOT NULL
  AND trim(t.category) <> ''
  AND c.business_id = t.business_id
  AND c.name = trim(t.category);

DROP TRIGGER IF EXISTS trg_task_manager_categories_updated_at ON public.task_manager_categories;
CREATE TRIGGER trg_task_manager_categories_updated_at
BEFORE UPDATE ON public.task_manager_categories
FOR EACH ROW EXECUTE FUNCTION public.update_task_manager_updated_at();

ALTER TABLE public.task_manager_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_category_employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Task manager categories visible to business members" ON public.task_manager_categories;
CREATE POLICY "Task manager categories visible to business members"
  ON public.task_manager_categories FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));

DROP POLICY IF EXISTS "Task manager categories managed by managers" ON public.task_manager_categories;
CREATE POLICY "Task manager categories managed by managers"
  ON public.task_manager_categories FOR ALL TO authenticated
  USING (public.task_manager_is_business_manager(business_id))
  WITH CHECK (public.task_manager_is_business_manager(business_id));

DROP POLICY IF EXISTS "Task manager category employees visible to business members" ON public.task_manager_category_employees;
CREATE POLICY "Task manager category employees visible to business members"
  ON public.task_manager_category_employees FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));

DROP POLICY IF EXISTS "Task manager category employees managed by managers" ON public.task_manager_category_employees;
CREATE POLICY "Task manager category employees managed by managers"
  ON public.task_manager_category_employees FOR ALL TO authenticated
  USING (public.task_manager_is_business_manager(business_id))
  WITH CHECK (public.task_manager_is_business_manager(business_id));

-- Recurring task generation copies category_id
CREATE OR REPLACE FUNCTION public.task_manager_generate_due_tasks(p_business_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  INSERT INTO public.task_manager_tasks (
    business_id,
    template_id,
    title,
    description,
    category,
    category_id,
    priority,
    assignment_scope,
    assigned_to,
    available_at,
    due_at,
    scheduled_for,
    requires_photo,
    requires_notes,
    peer_review_required,
    instructions,
    checklist,
    created_by
  )
  SELECT
    t.business_id,
    t.id,
    t.title,
    t.description,
    t.category,
    t.category_id,
    t.priority,
    t.assignment_scope,
    t.default_assigned_to,
    scheduled_at,
    scheduled_at + make_interval(mins => t.due_window_minutes),
    scheduled_at,
    t.requires_photo,
    t.requires_notes,
    t.peer_review_required,
    t.instructions,
    t.checklist,
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
  ON CONFLICT (template_id, scheduled_for) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

-- Kiosk queue respects category employee assignments
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
  missing_required_training integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.task_manager_generate_due_tasks(p_business_id);

  RETURN QUERY
  WITH candidate AS (
    SELECT tm.*
    FROM public.task_manager_tasks tm
    WHERE tm.business_id = p_business_id
      AND tm.status IN ('to_do', 'in_progress')
      AND tm.available_at <= now()
      AND (
        tm.assigned_to = p_employee_id
        OR (tm.assignment_scope = 'facility' AND tm.assigned_to IS NULL)
      )
      AND (
        tm.category_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.task_manager_category_employees ce
          WHERE ce.category_id = tm.category_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.task_manager_category_employees ce
          WHERE ce.category_id = tm.category_id
            AND ce.employee_id = p_employee_id
        )
      )
    ORDER BY
      CASE WHEN tm.assigned_to = p_employee_id THEN 0 ELSE 1 END,
      CASE tm.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      COALESCE(tm.due_at, tm.available_at) ASC,
      tm.created_at ASC
    LIMIT 1
  )
  SELECT
    c.id,
    c.template_id,
    c.title,
    c.description,
    c.category,
    c.priority,
    c.assignment_scope,
    c.due_at,
    c.requires_photo,
    c.requires_notes,
    c.instructions,
    c.checklist,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', tr.id,
        'title', tr.title,
        'resource_type', tr.resource_type,
        'resource_url', tr.resource_url,
        'content', tr.content,
        'is_required', tr.is_required,
        'completed', etc.id IS NOT NULL
      ) ORDER BY tr.created_at)
      FROM public.task_manager_training_resources tr
      LEFT JOIN public.task_manager_employee_training_completions etc
        ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
      WHERE tr.template_id = c.template_id
    ), '[]'::jsonb) AS training_resources,
    COALESCE((
      SELECT count(*)::integer
      FROM public.task_manager_training_resources tr
      LEFT JOIN public.task_manager_employee_training_completions etc
        ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
      WHERE tr.template_id = c.template_id
        AND tr.is_required = true
        AND etc.id IS NULL
    ), 0) AS missing_required_training
  FROM candidate c;
END;
$$;
