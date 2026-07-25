CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.task_manager_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignment_scope text NOT NULL DEFAULT 'facility' CHECK (assignment_scope IN ('facility', 'assigned')),
  default_assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  recurrence_type text NOT NULL DEFAULT 'none' CHECK (recurrence_type IN ('none', 'daily')),
  schedule_times text[] NOT NULL DEFAULT ARRAY[]::text[],
  due_window_minutes integer NOT NULL DEFAULT 60,
  requires_photo boolean NOT NULL DEFAULT false,
  requires_notes boolean NOT NULL DEFAULT false,
  peer_review_required boolean NOT NULL DEFAULT false,
  manager_review_rate numeric(5,4) NOT NULL DEFAULT 0.10 CHECK (manager_review_rate >= 0 AND manager_review_rate <= 1),
  training_required_before_completion boolean NOT NULL DEFAULT false,
  instructions text,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_manager_training_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.task_manager_templates(id) ON DELETE CASCADE,
  title text NOT NULL,
  resource_type text NOT NULL DEFAULT 'document' CHECK (resource_type IN ('document', 'video', 'link', 'text')),
  resource_url text,
  content text,
  is_required boolean NOT NULL DEFAULT true,
  require_once boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_manager_employee_training_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES public.task_manager_training_resources(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  completed_via text NOT NULL DEFAULT 'kiosk',
  UNIQUE (resource_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.task_manager_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.task_manager_templates(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  category text,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'to_do' CHECK (status IN ('backlog', 'to_do', 'in_progress', 'blocked', 'done', 'cancelled')),
  assignment_scope text NOT NULL DEFAULT 'facility' CHECK (assignment_scope IN ('facility', 'assigned')),
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  claimed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  scheduled_for timestamptz,
  requires_photo boolean NOT NULL DEFAULT false,
  requires_notes boolean NOT NULL DEFAULT false,
  peer_review_required boolean NOT NULL DEFAULT false,
  manager_review_required boolean NOT NULL DEFAULT false,
  review_status text NOT NULL DEFAULT 'not_required' CHECK (review_status IN ('not_required', 'pending_peer', 'pending_manager', 'approved', 'flagged')),
  instructions text,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  completion_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, scheduled_for)
);

CREATE TABLE IF NOT EXISTS public.task_manager_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.task_manager_tasks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notes text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_manager_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.task_manager_tasks(id) ON DELETE CASCADE,
  completion_id uuid REFERENCES public.task_manager_completions(id) ON DELETE SET NULL,
  review_type text NOT NULL CHECK (review_type IN ('peer', 'manager')),
  reviewer_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'flagged', 'skipped')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.task_manager_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.task_manager_tasks(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_manager_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.task_manager_tasks(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_manager_templates_business_status
  ON public.task_manager_templates (business_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_task_manager_tasks_business_queue
  ON public.task_manager_tasks (business_id, status, assignment_scope, assigned_to, available_at, due_at);
CREATE INDEX IF NOT EXISTS idx_task_manager_tasks_due
  ON public.task_manager_tasks (business_id, due_at) WHERE status <> 'done';
CREATE INDEX IF NOT EXISTS idx_task_manager_completions_employee
  ON public.task_manager_completions (business_id, employee_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_manager_reviews_pending
  ON public.task_manager_reviews (business_id, status, review_type, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_task_manager_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_manager_templates_updated_at ON public.task_manager_templates;
CREATE TRIGGER trg_task_manager_templates_updated_at
BEFORE UPDATE ON public.task_manager_templates
FOR EACH ROW EXECUTE FUNCTION public.update_task_manager_updated_at();

DROP TRIGGER IF EXISTS trg_task_manager_training_resources_updated_at ON public.task_manager_training_resources;
CREATE TRIGGER trg_task_manager_training_resources_updated_at
BEFORE UPDATE ON public.task_manager_training_resources
FOR EACH ROW EXECUTE FUNCTION public.update_task_manager_updated_at();

DROP TRIGGER IF EXISTS trg_task_manager_tasks_updated_at ON public.task_manager_tasks;
CREATE TRIGGER trg_task_manager_tasks_updated_at
BEFORE UPDATE ON public.task_manager_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_task_manager_updated_at();

CREATE OR REPLACE FUNCTION public.task_manager_is_business_member(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE business_id = p_business_id AND user_id = auth.uid() AND active = true
  )
  OR EXISTS (
    SELECT 1 FROM public.business_users
    WHERE business_id = p_business_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.task_manager_is_business_manager(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE business_id = p_business_id
      AND user_id = auth.uid()
      AND active = true
      AND role IN ('owner', 'admin', 'manager')
  )
  OR EXISTS (
    SELECT 1 FROM public.business_users
    WHERE business_id = p_business_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin', 'manager')
  );
$$;

ALTER TABLE public.task_manager_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_training_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_employee_training_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Task manager templates are visible to business members" ON public.task_manager_templates;
CREATE POLICY "Task manager templates are visible to business members"
  ON public.task_manager_templates FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));
DROP POLICY IF EXISTS "Task manager templates are managed by managers" ON public.task_manager_templates;
CREATE POLICY "Task manager templates are managed by managers"
  ON public.task_manager_templates FOR ALL TO authenticated
  USING (public.task_manager_is_business_manager(business_id))
  WITH CHECK (public.task_manager_is_business_manager(business_id));

DROP POLICY IF EXISTS "Task manager training visible to business members" ON public.task_manager_training_resources;
CREATE POLICY "Task manager training visible to business members"
  ON public.task_manager_training_resources FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));
DROP POLICY IF EXISTS "Task manager training managed by managers" ON public.task_manager_training_resources;
CREATE POLICY "Task manager training managed by managers"
  ON public.task_manager_training_resources FOR ALL TO authenticated
  USING (public.task_manager_is_business_manager(business_id))
  WITH CHECK (public.task_manager_is_business_manager(business_id));

DROP POLICY IF EXISTS "Task manager training completions visible to business members" ON public.task_manager_employee_training_completions;
CREATE POLICY "Task manager training completions visible to business members"
  ON public.task_manager_employee_training_completions FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));
DROP POLICY IF EXISTS "Task manager training completions inserted by members" ON public.task_manager_employee_training_completions;
CREATE POLICY "Task manager training completions inserted by members"
  ON public.task_manager_employee_training_completions FOR INSERT TO authenticated
  WITH CHECK (public.task_manager_is_business_member(business_id));

DROP POLICY IF EXISTS "Task manager tasks visible to business members" ON public.task_manager_tasks;
CREATE POLICY "Task manager tasks visible to business members"
  ON public.task_manager_tasks FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));
DROP POLICY IF EXISTS "Task manager tasks managed by managers" ON public.task_manager_tasks;
CREATE POLICY "Task manager tasks managed by managers"
  ON public.task_manager_tasks FOR ALL TO authenticated
  USING (public.task_manager_is_business_manager(business_id))
  WITH CHECK (public.task_manager_is_business_manager(business_id));

DROP POLICY IF EXISTS "Task manager completions visible to business members" ON public.task_manager_completions;
CREATE POLICY "Task manager completions visible to business members"
  ON public.task_manager_completions FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));
DROP POLICY IF EXISTS "Task manager completions inserted by business members" ON public.task_manager_completions;
CREATE POLICY "Task manager completions inserted by business members"
  ON public.task_manager_completions FOR INSERT TO authenticated
  WITH CHECK (public.task_manager_is_business_member(business_id));

DROP POLICY IF EXISTS "Task manager reviews visible to business members" ON public.task_manager_reviews;
CREATE POLICY "Task manager reviews visible to business members"
  ON public.task_manager_reviews FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));
DROP POLICY IF EXISTS "Task manager reviews managed by managers" ON public.task_manager_reviews;
CREATE POLICY "Task manager reviews managed by managers"
  ON public.task_manager_reviews FOR ALL TO authenticated
  USING (public.task_manager_is_business_manager(business_id))
  WITH CHECK (public.task_manager_is_business_manager(business_id));

DROP POLICY IF EXISTS "Task manager comments visible to business members" ON public.task_manager_comments;
CREATE POLICY "Task manager comments visible to business members"
  ON public.task_manager_comments FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));
DROP POLICY IF EXISTS "Task manager comments created by business members" ON public.task_manager_comments;
CREATE POLICY "Task manager comments created by business members"
  ON public.task_manager_comments FOR INSERT TO authenticated
  WITH CHECK (public.task_manager_is_business_member(business_id));

DROP POLICY IF EXISTS "Task manager activity visible to business members" ON public.task_manager_activity;
CREATE POLICY "Task manager activity visible to business members"
  ON public.task_manager_activity FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));

CREATE OR REPLACE FUNCTION public.task_manager_pin_matches(p_stored_pin text, p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_matches boolean := false;
BEGIN
  IF p_stored_pin IS NULL OR p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    RETURN false;
  END IF;

  IF p_stored_pin = p_pin THEN
    RETURN true;
  END IF;

  BEGIN
    v_matches := crypt(p_pin, p_stored_pin) = p_stored_pin;
  EXCEPTION WHEN OTHERS THEN
    v_matches := false;
  END;

  RETURN COALESCE(v_matches, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_verify_pin(
  p_business_id uuid,
  p_pin text
)
RETURNS TABLE (
  employee_id uuid,
  full_name text,
  first_name text,
  last_name text,
  role text,
  hire_date date,
  "position" text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    COALESCE(u.full_name, trim(concat_ws(' ', u.first_name, u.last_name)), u.email),
    u.first_name,
    u.last_name,
    COALESCE(ur.role, bu.role),
    u.hire_date,
    u.position
  FROM public.users u
  LEFT JOIN public.user_roles ur
    ON ur.user_id = u.id AND ur.business_id = p_business_id AND ur.active = true
  LEFT JOIN public.business_users bu
    ON bu.user_id = u.id AND bu.business_id = p_business_id
  WHERE (ur.user_id IS NOT NULL OR bu.user_id IS NOT NULL)
    AND public.task_manager_pin_matches(u.pin, p_pin)
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_get_kiosk_business(p_business_id uuid)
RETURNS TABLE (
  business_id uuid,
  business_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, COALESCE(b.name, 'Tavari Business')::text
  FROM public.businesses b
  WHERE b.id = p_business_id
  LIMIT 1;
$$;

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

CREATE OR REPLACE FUNCTION public.task_manager_mark_training_complete(
  p_business_id uuid,
  p_resource_id uuid,
  p_employee_id uuid,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified uuid;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  INSERT INTO public.task_manager_employee_training_completions (business_id, resource_id, employee_id)
  VALUES (p_business_id, p_resource_id, p_employee_id)
  ON CONFLICT (resource_id, employee_id) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_complete_task(
  p_business_id uuid,
  p_task_id uuid,
  p_employee_id uuid,
  p_pin text,
  p_notes text DEFAULT NULL,
  p_completed_checklist jsonb DEFAULT '[]'::jsonb,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified uuid;
  v_task public.task_manager_tasks%ROWTYPE;
  v_completion_id uuid;
  v_missing_required integer := 0;
  v_manager_review_rate numeric := 0;
  v_employee_hire_date date;
  v_prior_flags integer := 0;
  v_should_manager_review boolean := false;
  v_review_status text := 'not_required';
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  SELECT * INTO v_task
  FROM public.task_manager_tasks
  WHERE id = p_task_id
    AND business_id = p_business_id
    AND status IN ('to_do', 'in_progress')
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Task is no longer available');
  END IF;

  IF v_task.assigned_to IS NOT NULL AND v_task.assigned_to <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'This task is assigned to another employee');
  END IF;

  SELECT count(*)::integer INTO v_missing_required
  FROM public.task_manager_training_resources tr
  LEFT JOIN public.task_manager_employee_training_completions etc
    ON etc.resource_id = tr.id AND etc.employee_id = p_employee_id
  WHERE tr.template_id = v_task.template_id
    AND tr.is_required = true
    AND etc.id IS NULL;

  IF v_missing_required > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Required training must be completed first', 'training_required', true);
  END IF;

  IF v_task.requires_notes AND length(trim(COALESCE(p_notes, ''))) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Completion notes are required');
  END IF;

  IF v_task.requires_photo AND COALESCE(p_evidence->>'photo_data_url', p_evidence->>'photo_url', '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Photo evidence is required');
  END IF;

  SELECT COALESCE(t.manager_review_rate, 0), u.hire_date
    INTO v_manager_review_rate, v_employee_hire_date
  FROM public.task_manager_tasks task
  LEFT JOIN public.task_manager_templates t ON t.id = task.template_id
  LEFT JOIN public.users u ON u.id = p_employee_id
  WHERE task.id = p_task_id;

  SELECT count(*)::integer INTO v_prior_flags
  FROM public.task_manager_reviews r
  JOIN public.task_manager_tasks task ON task.id = r.task_id
  WHERE task.completed_by = p_employee_id
    AND r.status = 'flagged'
    AND r.created_at > now() - interval '90 days';

  v_manager_review_rate := LEAST(
    1,
    COALESCE(v_manager_review_rate, 0)
    + CASE WHEN v_employee_hire_date IS NOT NULL AND v_employee_hire_date > current_date - 90 THEN 0.15 ELSE 0 END
    + LEAST(0.35, v_prior_flags * 0.05)
  );
  v_should_manager_review := random() < v_manager_review_rate;

  IF v_task.peer_review_required THEN
    v_review_status := 'pending_peer';
  ELSIF v_should_manager_review THEN
    v_review_status := 'pending_manager';
  END IF;

  INSERT INTO public.task_manager_completions (
    business_id,
    task_id,
    employee_id,
    notes,
    evidence,
    completed_checklist
  )
  VALUES (
    p_business_id,
    p_task_id,
    p_employee_id,
    p_notes,
    COALESCE(p_evidence, '{}'::jsonb),
    COALESCE(p_completed_checklist, '[]'::jsonb)
  )
  RETURNING id INTO v_completion_id;

  UPDATE public.task_manager_tasks
  SET
    status = 'done',
    claimed_by = COALESCE(claimed_by, p_employee_id),
    completed_by = p_employee_id,
    completed_at = now(),
    manager_review_required = v_should_manager_review,
    review_status = v_review_status,
    completion_summary = jsonb_build_object(
      'completion_id', v_completion_id,
      'notes', p_notes,
      'evidence', COALESCE(p_evidence, '{}'::jsonb)
    )
  WHERE id = p_task_id;

  IF v_task.peer_review_required THEN
    INSERT INTO public.task_manager_reviews (business_id, task_id, completion_id, review_type)
    VALUES (p_business_id, p_task_id, v_completion_id, 'peer');
  END IF;

  IF v_should_manager_review THEN
    INSERT INTO public.task_manager_reviews (business_id, task_id, completion_id, review_type)
    VALUES (p_business_id, p_task_id, v_completion_id, 'manager');
  END IF;

  INSERT INTO public.task_manager_activity (business_id, task_id, actor_id, action, details)
  VALUES (
    p_business_id,
    p_task_id,
    p_employee_id,
    'task_completed',
    jsonb_build_object('completion_id', v_completion_id, 'review_status', v_review_status)
  );

  RETURN jsonb_build_object(
    'success', true,
    'completion_id', v_completion_id,
    'review_status', v_review_status
  );
END;
$$;

INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'tasks',
  'Tavari Task Manager',
  'Prioritized staff tasks, recurring facility checks, kiosk completion, training, and review workflows',
  'FiClipboard',
  false,
  'Operations'
)
ON CONFLICT (module_key) DO UPDATE
SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  enabled_by_default = EXCLUDED.enabled_by_default,
  module_category = EXCLUDED.module_category;

GRANT EXECUTE ON FUNCTION public.task_manager_is_business_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_is_business_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_pin_matches(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_verify_pin(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_get_kiosk_business(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_generate_due_tasks(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_get_next_task(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_mark_training_complete(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_complete_task(uuid, uuid, uuid, text, text, jsonb, jsonb) TO anon, authenticated;
