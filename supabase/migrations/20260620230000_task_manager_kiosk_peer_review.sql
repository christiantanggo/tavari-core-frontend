-- Kiosk peer review pool with configurable per-staff sampling weights.

CREATE TABLE IF NOT EXISTS public.task_manager_peer_review_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  reviews_per_login integer NOT NULL DEFAULT 5 CHECK (reviews_per_login >= 0 AND reviews_per_login <= 20),
  new_hire_sample_rate numeric(5,4) NOT NULL DEFAULT 0.25 CHECK (new_hire_sample_rate >= 0 AND new_hire_sample_rate <= 1),
  experienced_sample_rate numeric(5,4) NOT NULL DEFAULT 0.05 CHECK (experienced_sample_rate >= 0 AND experienced_sample_rate <= 1),
  new_hire_days integer NOT NULL DEFAULT 90 CHECK (new_hire_days >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_manager_employee_peer_review_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sample_rate numeric(5,4) NOT NULL CHECK (sample_rate >= 0 AND sample_rate <= 1),
  expires_at timestamptz,
  reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.task_manager_peer_review_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.task_manager_tasks(id) ON DELETE CASCADE,
  completion_id uuid NOT NULL REFERENCES public.task_manager_completions(id) ON DELETE CASCADE,
  completer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_title text NOT NULL,
  times_peer_reviewed integer NOT NULL DEFAULT 0,
  last_peer_reviewed_at timestamptz,
  added_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'removed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_manager_peer_review_pool_completion
  ON public.task_manager_peer_review_pool (completion_id);

CREATE INDEX IF NOT EXISTS idx_task_manager_peer_review_pool_pending
  ON public.task_manager_peer_review_pool (business_id, status, last_peer_reviewed_at NULLS FIRST, added_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.task_manager_peer_review_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  pool_id uuid REFERENCES public.task_manager_peer_review_pool(id) ON DELETE SET NULL,
  completion_id uuid NOT NULL REFERENCES public.task_manager_completions(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.task_manager_tasks(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  completer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('approved', 'not_completed', 'redo_required')),
  notes text,
  verification_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_manager_peer_review_submissions_business
  ON public.task_manager_peer_review_submissions (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.task_manager_kiosk_peer_review_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  reviews_completed integer NOT NULL DEFAULT 0,
  session_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, employee_id, session_date)
);

ALTER TABLE public.task_manager_peer_review_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_employee_peer_review_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_peer_review_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_peer_review_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_kiosk_peer_review_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Peer review settings managers" ON public.task_manager_peer_review_settings;
CREATE POLICY "Peer review settings managers"
  ON public.task_manager_peer_review_settings FOR ALL TO authenticated
  USING (public.task_manager_is_business_manager(business_id))
  WITH CHECK (public.task_manager_is_business_manager(business_id));

DROP POLICY IF EXISTS "Peer review settings read members" ON public.task_manager_peer_review_settings;
CREATE POLICY "Peer review settings read members"
  ON public.task_manager_peer_review_settings FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));

DROP POLICY IF EXISTS "Peer review weights managers" ON public.task_manager_employee_peer_review_weights;
CREATE POLICY "Peer review weights managers"
  ON public.task_manager_employee_peer_review_weights FOR ALL TO authenticated
  USING (public.task_manager_is_business_manager(business_id))
  WITH CHECK (public.task_manager_is_business_manager(business_id));

DROP POLICY IF EXISTS "Peer review pool read members" ON public.task_manager_peer_review_pool;
CREATE POLICY "Peer review pool read members"
  ON public.task_manager_peer_review_pool FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));

DROP POLICY IF EXISTS "Peer review submissions read members" ON public.task_manager_peer_review_submissions;
CREATE POLICY "Peer review submissions read members"
  ON public.task_manager_peer_review_submissions FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));

-- Peer-review tasks always require completion photos.
UPDATE public.task_manager_tasks
SET requires_photo = true
WHERE peer_review_required IS TRUE
  AND requires_photo IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.task_manager_peer_review_sample_rate(
  p_business_id uuid,
  p_employee_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.task_manager_peer_review_settings%ROWTYPE;
  v_override public.task_manager_employee_peer_review_weights%ROWTYPE;
  v_hire_date date;
  v_days_employed integer;
  v_new_rate numeric;
  v_exp_rate numeric;
  v_progress numeric;
BEGIN
  SELECT * INTO v_settings
  FROM public.task_manager_peer_review_settings
  WHERE business_id = p_business_id;

  IF v_settings.business_id IS NULL THEN
    v_new_rate := 0.25;
    v_exp_rate := 0.05;
  ELSE
    v_new_rate := v_settings.new_hire_sample_rate;
    v_exp_rate := v_settings.experienced_sample_rate;
  END IF;

  SELECT * INTO v_override
  FROM public.task_manager_employee_peer_review_weights
  WHERE business_id = p_business_id
    AND employee_id = p_employee_id
    AND (expires_at IS NULL OR expires_at > now());

  IF v_override.id IS NOT NULL THEN
    RETURN v_override.sample_rate;
  END IF;

  SELECT hire_date INTO v_hire_date
  FROM public.users
  WHERE id = p_employee_id;

  IF v_hire_date IS NULL THEN
    RETURN v_exp_rate;
  END IF;

  v_days_employed := GREATEST(0, current_date - v_hire_date);
  IF COALESCE(v_settings.new_hire_days, 90) <= 0 OR v_days_employed >= COALESCE(v_settings.new_hire_days, 90) THEN
    RETURN v_exp_rate;
  END IF;

  v_progress := v_days_employed::numeric / NULLIF(COALESCE(v_settings.new_hire_days, 90), 0)::numeric;
  RETURN v_new_rate + ((v_exp_rate - v_new_rate) * v_progress);
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_maybe_add_peer_review_pool(
  p_business_id uuid,
  p_task_id uuid,
  p_completion_id uuid,
  p_completer_id uuid,
  p_task_title text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric;
BEGIN
  v_rate := public.task_manager_peer_review_sample_rate(p_business_id, p_completer_id);
  IF random() >= v_rate THEN
    RETURN;
  END IF;

  INSERT INTO public.task_manager_peer_review_pool (
    business_id, task_id, completion_id, completer_id, task_title
  )
  VALUES (
    p_business_id, p_task_id, p_completion_id, p_completer_id, p_task_title
  )
  ON CONFLICT (completion_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_kiosk_peer_review_session_date(
  p_business_id uuid
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
BEGIN
  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
  FROM public.businesses
  WHERE id = p_business_id;
  RETURN (now() AT TIME ZONE v_tz)::date;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_get_kiosk_peer_review_batch(
  p_business_id uuid,
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
  v_session_date date;
  v_settings public.task_manager_peer_review_settings%ROWTYPE;
  v_limit integer := 5;
  v_session public.task_manager_kiosk_peer_review_sessions%ROWTYPE;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  v_session_date := public.task_manager_kiosk_peer_review_session_date(p_business_id);

  SELECT * INTO v_session
  FROM public.task_manager_kiosk_peer_review_sessions
  WHERE business_id = p_business_id
    AND employee_id = p_employee_id
    AND session_date = v_session_date
    AND session_completed_at IS NOT NULL;

  IF v_session.id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_completed_today', true, 'items', '[]'::jsonb);
  END IF;

  SELECT * INTO v_settings FROM public.task_manager_peer_review_settings WHERE business_id = p_business_id;
  v_limit := COALESCE(v_settings.reviews_per_login, 5);

  SELECT COALESCE(jsonb_agg(row_to_json(sel)::jsonb ORDER BY sel.sort_rank), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      p.id AS pool_id,
      p.completion_id,
      p.task_id,
      p.task_title,
      p.completer_id,
      COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.first_name || ' ' || COALESCE(u.last_name, '')), ''), 'Staff') AS completer_name,
      c.notes AS completion_notes,
      c.evidence AS completion_evidence,
      c.completed_checklist,
      c.completed_at,
      public.task_manager_peer_review_sample_rate(p_business_id, p.completer_id) AS completer_sample_rate,
      (
        EXTRACT(EPOCH FROM (now() - COALESCE(p.last_peer_reviewed_at, p.added_at))) / 86400.0
      ) AS days_since_review,
      (
        (EXTRACT(EPOCH FROM (now() - COALESCE(p.last_peer_reviewed_at, p.added_at))) / 86400.0) * 10
        + (public.task_manager_peer_review_sample_rate(p_business_id, p.completer_id) * 100)
        - (p.times_peer_reviewed * 5)
      ) AS sort_rank
    FROM public.task_manager_peer_review_pool p
    JOIN public.task_manager_completions c ON c.id = p.completion_id
    JOIN public.users u ON u.id = p.completer_id
    WHERE p.business_id = p_business_id
      AND p.status = 'pending'
      AND p.completer_id <> p_employee_id
      AND NOT EXISTS (
        SELECT 1 FROM public.task_manager_peer_review_submissions s
        WHERE s.completion_id = p.completion_id
          AND s.reviewer_id = p_employee_id
      )
    ORDER BY sort_rank DESC, p.added_at ASC
    LIMIT v_limit
  ) sel;

  RETURN jsonb_build_object(
    'success', true,
    'already_completed_today', false,
    'session_date', v_session_date,
    'items', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_submit_kiosk_peer_review(
  p_business_id uuid,
  p_employee_id uuid,
  p_pin text,
  p_pool_id uuid,
  p_outcome text,
  p_notes text DEFAULT NULL,
  p_verification_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified uuid;
  v_pool public.task_manager_peer_review_pool%ROWTYPE;
  v_task public.task_manager_tasks%ROWTYPE;
  v_session_date date;
  v_reviews_done integer;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  IF p_outcome NOT IN ('approved', 'not_completed', 'redo_required') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid review outcome');
  END IF;

  IF COALESCE(p_verification_evidence->>'photo_data_url', p_verification_evidence->>'photo_url', '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Verification photo is required');
  END IF;

  SELECT * INTO v_pool
  FROM public.task_manager_peer_review_pool
  WHERE id = p_pool_id
    AND business_id = p_business_id
    AND status = 'pending'
  FOR UPDATE;

  IF v_pool.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Review item is no longer available');
  END IF;

  IF v_pool.completer_id = p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot review your own work');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.task_manager_peer_review_submissions
    WHERE completion_id = v_pool.completion_id AND reviewer_id = p_employee_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already reviewed this completion');
  END IF;

  INSERT INTO public.task_manager_peer_review_submissions (
    business_id, pool_id, completion_id, task_id, reviewer_id, completer_id,
    outcome, notes, verification_evidence
  )
  VALUES (
    p_business_id, v_pool.id, v_pool.completion_id, v_pool.task_id, p_employee_id, v_pool.completer_id,
    p_outcome, NULLIF(trim(COALESCE(p_notes, '')), ''), COALESCE(p_verification_evidence, '{}'::jsonb)
  );

  UPDATE public.task_manager_peer_review_pool
  SET
    status = 'reviewed',
    times_peer_reviewed = times_peer_reviewed + 1,
    last_peer_reviewed_at = now()
  WHERE id = v_pool.id;

  IF p_outcome IN ('not_completed', 'redo_required') THEN
    SELECT * INTO v_task FROM public.task_manager_tasks WHERE id = v_pool.task_id FOR UPDATE;
    IF v_task.id IS NOT NULL AND v_task.status = 'done' THEN
      UPDATE public.task_manager_tasks
      SET
        status = 'to_do',
        claimed_by = NULL,
        completed_by = NULL,
        completed_at = NULL,
        review_status = CASE WHEN p_outcome = 'not_completed' THEN 'flagged' ELSE 'not_required' END,
        manager_review_required = false,
        completion_summary = jsonb_build_object(
          'peer_review_outcome', p_outcome,
          'peer_review_notes', NULLIF(trim(COALESCE(p_notes, '')), ''),
          'reopened_at', now()
        ),
        available_at = now()
      WHERE id = v_pool.task_id;
    END IF;
  END IF;

  v_session_date := public.task_manager_kiosk_peer_review_session_date(p_business_id);

  INSERT INTO public.task_manager_kiosk_peer_review_sessions (
    business_id, employee_id, session_date, reviews_completed
  )
  VALUES (p_business_id, p_employee_id, v_session_date, 1)
  ON CONFLICT (business_id, employee_id, session_date)
  DO UPDATE SET reviews_completed = public.task_manager_kiosk_peer_review_sessions.reviews_completed + 1;

  SELECT reviews_completed INTO v_reviews_done
  FROM public.task_manager_kiosk_peer_review_sessions
  WHERE business_id = p_business_id
    AND employee_id = p_employee_id
    AND session_date = v_session_date;

  RETURN jsonb_build_object('success', true, 'reviews_completed_today', v_reviews_done);
END;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_complete_kiosk_peer_review_session(
  p_business_id uuid,
  p_employee_id uuid,
  p_pin text,
  p_reviews_completed integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified uuid;
  v_session_date date;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN');
  END IF;

  v_session_date := public.task_manager_kiosk_peer_review_session_date(p_business_id);

  INSERT INTO public.task_manager_kiosk_peer_review_sessions (
    business_id, employee_id, session_date, reviews_completed, session_completed_at
  )
  VALUES (
    p_business_id, p_employee_id, v_session_date,
    GREATEST(0, COALESCE(p_reviews_completed, 0)), now()
  )
  ON CONFLICT (business_id, employee_id, session_date)
  DO UPDATE SET
    reviews_completed = GREATEST(
      public.task_manager_kiosk_peer_review_sessions.reviews_completed,
      COALESCE(p_reviews_completed, 0)
    ),
    session_completed_at = COALESCE(
      public.task_manager_kiosk_peer_review_sessions.session_completed_at,
      now()
    );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_peer_review_sample_rate(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_get_kiosk_peer_review_batch(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_submit_kiosk_peer_review(uuid, uuid, text, uuid, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_manager_complete_kiosk_peer_review_session(uuid, uuid, text, integer) TO anon, authenticated;

-- Replace complete_task: sample into peer pool instead of dashboard pending peer reviews.
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
  v_group_id uuid;
  v_open_in_group integer := 0;
  v_reset_cadence text;
  v_next_due timestamptz;
  v_occurrences integer;
  v_needs_photo boolean;
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
  WHERE (tr.task_id = v_task.id OR (v_task.template_id IS NOT NULL AND tr.template_id = v_task.template_id AND tr.task_id IS NULL))
    AND tr.is_required = true
    AND etc.id IS NULL;

  IF v_missing_required > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Required training must be completed first', 'training_required', true);
  END IF;

  IF v_task.requires_notes AND length(trim(COALESCE(p_notes, ''))) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Completion notes are required');
  END IF;

  v_needs_photo := v_task.requires_photo OR v_task.peer_review_required;
  IF v_needs_photo AND COALESCE(p_evidence->>'photo_data_url', p_evidence->>'photo_url', '') = '' THEN
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

  IF v_should_manager_review THEN
    v_review_status := 'pending_manager';
  END IF;

  INSERT INTO public.task_manager_completions (
    business_id, task_id, employee_id, notes, evidence, completed_checklist
  )
  VALUES (
    p_business_id, p_task_id, p_employee_id, p_notes,
    COALESCE(p_evidence, '{}'::jsonb), COALESCE(p_completed_checklist, '[]'::jsonb)
  )
  RETURNING id INTO v_completion_id;

  IF v_task.peer_review_required THEN
    PERFORM public.task_manager_maybe_add_peer_review_pool(
      p_business_id, p_task_id, v_completion_id, p_employee_id, v_task.title
    );
  END IF;

  v_occurrences := COALESCE(v_task.occurrences_completed, 0) + 1;

  IF (v_task.due_schedule_mode = 'daily_required'
      OR (v_task.due_schedule_mode = 'frequency' AND v_task.schedule_type IS NOT NULL)) THEN
    IF v_task.due_schedule_mode = 'frequency'
       AND v_task.ends_on IS NOT NULL
       AND current_date > v_task.ends_on THEN
      UPDATE public.task_manager_tasks
      SET status = 'done', claimed_by = COALESCE(claimed_by, p_employee_id), completed_by = p_employee_id,
          completed_at = now(), manager_review_required = v_should_manager_review, review_status = v_review_status,
          occurrences_completed = v_occurrences,
          completion_summary = jsonb_build_object('completion_id', v_completion_id, 'notes', p_notes, 'evidence', COALESCE(p_evidence, '{}'::jsonb))
      WHERE id = p_task_id;
    ELSIF v_task.due_schedule_mode = 'frequency'
          AND v_task.max_occurrences IS NOT NULL
          AND v_occurrences >= v_task.max_occurrences THEN
      UPDATE public.task_manager_tasks
      SET status = 'done', claimed_by = COALESCE(claimed_by, p_employee_id), completed_by = p_employee_id,
          completed_at = now(), manager_review_required = v_should_manager_review, review_status = v_review_status,
          occurrences_completed = v_occurrences,
          completion_summary = jsonb_build_object('completion_id', v_completion_id, 'notes', p_notes, 'evidence', COALESCE(p_evidence, '{}'::jsonb))
      WHERE id = p_task_id;
    ELSIF v_task.due_schedule_mode = 'frequency' AND v_task.schedule_type = 'once' THEN
      UPDATE public.task_manager_tasks
      SET status = 'done', claimed_by = COALESCE(claimed_by, p_employee_id), completed_by = p_employee_id,
          completed_at = now(), manager_review_required = v_should_manager_review, review_status = v_review_status,
          occurrences_completed = v_occurrences,
          completion_summary = jsonb_build_object('completion_id', v_completion_id, 'notes', p_notes, 'evidence', COALESCE(p_evidence, '{}'::jsonb))
      WHERE id = p_task_id;
    ELSE
      v_next_due := COALESCE(v_task.due_at, now());
      IF v_task.due_schedule_mode = 'daily_required'
         OR v_task.schedule_type = 'daily' THEN
        v_next_due := v_next_due + interval '1 day';
      ELSIF v_task.schedule_type = 'weekly' THEN
        v_next_due := v_next_due + interval '7 days';
      ELSIF v_task.schedule_type = 'biweekly' THEN
        v_next_due := v_next_due + interval '14 days';
      ELSIF v_task.schedule_type IN ('monthly', 'monthly_weekday') THEN
        v_next_due := v_next_due + interval '1 month';
      END IF;

      UPDATE public.task_manager_tasks
      SET
        status = 'to_do',
        claimed_by = NULL,
        completed_by = NULL,
        completed_at = NULL,
        available_at = v_next_due,
        due_at = v_next_due,
        occurrences_completed = v_occurrences,
        manager_review_required = false,
        review_status = 'not_required',
        completion_summary = '{}'::jsonb
      WHERE id = p_task_id;
    END IF;
  ELSE
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
  END IF;

  PERFORM public.task_manager_clear_task_handoff(p_task_id);

  IF v_task.round_robin_group_id IS NOT NULL THEN
    v_group_id := v_task.round_robin_group_id;
    SELECT reset_cadence INTO v_reset_cadence
    FROM public.task_manager_round_robin_groups
    WHERE id = v_group_id;

    IF COALESCE(v_reset_cadence, 'on_complete') = 'on_complete' THEN
      SELECT count(*)::integer INTO v_open_in_group
      FROM public.task_manager_tasks
      WHERE round_robin_group_id = v_group_id
        AND business_id = p_business_id
        AND status IN ('to_do', 'in_progress');

      IF v_open_in_group = 0 THEN
        UPDATE public.task_manager_tasks
        SET
          status = 'to_do',
          claimed_by = NULL,
          completed_by = NULL,
          completed_at = NULL,
          review_status = 'not_required',
          manager_review_required = false,
          completion_summary = '{}'::jsonb,
          available_at = now()
        WHERE round_robin_group_id = v_group_id
          AND business_id = p_business_id
          AND status <> 'cancelled';
      END IF;
    END IF;
  END IF;

  IF v_should_manager_review THEN
    INSERT INTO public.task_manager_reviews (business_id, task_id, completion_id, review_type)
    VALUES (p_business_id, p_task_id, v_completion_id, 'manager');
  END IF;

  INSERT INTO public.task_manager_activity (business_id, task_id, actor_id, action, details)
  VALUES (
    p_business_id, p_task_id, p_employee_id, 'task_completed',
    jsonb_build_object('completion_id', v_completion_id, 'review_status', v_review_status)
  );

  RETURN jsonb_build_object(
    'success', true,
    'completion_id', v_completion_id,
    'review_status', v_review_status
  );
END;
$$;

-- Cancel stale pending peer rows from the old dashboard flow.
UPDATE public.task_manager_reviews
SET status = 'skipped', completed_at = now()
WHERE review_type = 'peer' AND status = 'pending';

CREATE OR REPLACE FUNCTION public.task_manager_get_kiosk_checklist_buttons(
  p_business_id uuid
)
RETURNS TABLE (
  category_id uuid,
  name text,
  button_label text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    COALESCE(NULLIF(trim(c.kiosk_button_label), ''), c.name) AS button_label
  FROM public.task_manager_categories c
  WHERE c.business_id = p_business_id
    AND c.is_active = true
    AND c.kiosk_checklist_button = true
  ORDER BY c.sort_order ASC, c.name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_get_kiosk_checklist_buttons(uuid) TO anon, authenticated;
