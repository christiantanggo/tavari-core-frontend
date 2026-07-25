-- Email managers when kiosk checklist categories are still incomplete near window close.

CREATE TABLE IF NOT EXISTS public.task_manager_checklist_alert_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  minutes_before_close integer NOT NULL DEFAULT 60 CHECK (minutes_before_close >= 5 AND minutes_before_close <= 480),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_manager_checklist_alert_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.task_manager_categories(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_task_manager_checklist_alert_recipients_business
  ON public.task_manager_checklist_alert_recipients (business_id, category_id);

CREATE TABLE IF NOT EXISTS public.task_manager_checklist_alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.task_manager_categories(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  incomplete_count integer NOT NULL DEFAULT 0,
  total_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, category_id, business_date)
);

ALTER TABLE public.task_manager_checklist_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_checklist_alert_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_checklist_alert_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Checklist alert settings managers" ON public.task_manager_checklist_alert_settings;
CREATE POLICY "Checklist alert settings managers"
  ON public.task_manager_checklist_alert_settings FOR ALL TO authenticated
  USING (public.task_manager_is_business_manager(business_id))
  WITH CHECK (public.task_manager_is_business_manager(business_id));

DROP POLICY IF EXISTS "Checklist alert settings read members" ON public.task_manager_checklist_alert_settings;
CREATE POLICY "Checklist alert settings read members"
  ON public.task_manager_checklist_alert_settings FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));

DROP POLICY IF EXISTS "Checklist alert recipients managers" ON public.task_manager_checklist_alert_recipients;
CREATE POLICY "Checklist alert recipients managers"
  ON public.task_manager_checklist_alert_recipients FOR ALL TO authenticated
  USING (public.task_manager_is_business_manager(business_id))
  WITH CHECK (public.task_manager_is_business_manager(business_id));

DROP POLICY IF EXISTS "Checklist alert recipients read members" ON public.task_manager_checklist_alert_recipients;
CREATE POLICY "Checklist alert recipients read members"
  ON public.task_manager_checklist_alert_recipients FOR SELECT TO authenticated
  USING (public.task_manager_is_business_member(business_id));

DROP POLICY IF EXISTS "Checklist alert log managers read" ON public.task_manager_checklist_alert_log;
CREATE POLICY "Checklist alert log managers read"
  ON public.task_manager_checklist_alert_log FOR SELECT TO authenticated
  USING (public.task_manager_is_business_manager(business_id));

CREATE OR REPLACE FUNCTION public.task_manager_checklist_completion_status(
  p_business_id uuid,
  p_category_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_done integer := 0;
  v_incomplete_titles jsonb := '[]'::jsonb;
BEGIN
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE status = 'done')::integer
  INTO v_total, v_done
  FROM public.task_manager_tasks
  WHERE business_id = p_business_id
    AND category_id = p_category_id
    AND status <> 'cancelled';

  SELECT COALESCE(jsonb_agg(title ORDER BY checklist_sort_order ASC NULLS LAST, created_at ASC), '[]'::jsonb)
  INTO v_incomplete_titles
  FROM public.task_manager_tasks
  WHERE business_id = p_business_id
    AND category_id = p_category_id
    AND status <> 'cancelled'
    AND status <> 'done';

  RETURN jsonb_build_object(
    'total', v_total,
    'completed', v_done,
    'incomplete_count', GREATEST(v_total - v_done, 0),
    'is_complete', v_total > 0 AND v_done = v_total,
    'incomplete_titles', v_incomplete_titles
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.task_manager_checklist_completion_status(uuid, uuid) TO authenticated, service_role;

-- Off The Wall Kids London: alert Christian Fournier for opening + closing checklists.
INSERT INTO public.task_manager_checklist_alert_settings (business_id, enabled, minutes_before_close)
VALUES ('cb982fca-cf7a-4f59-b9c7-55ca0364eddc', true, 60)
ON CONFLICT (business_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    minutes_before_close = EXCLUDED.minutes_before_close,
    updated_at = now();

INSERT INTO public.task_manager_checklist_alert_recipients (business_id, category_id, employee_id)
VALUES
  ('cb982fca-cf7a-4f59-b9c7-55ca0364eddc', 'c457c56c-b0b9-4fc5-b5fd-180146f153f4', '6f71ccb4-05fc-4c4e-be69-ee5a0bff98fc'),
  ('cb982fca-cf7a-4f59-b9c7-55ca0364eddc', 'e9be3be8-c205-4927-80ab-5c9ea918e526', '6f71ccb4-05fc-4c4e-be69-ee5a0bff98fc')
ON CONFLICT (category_id, employee_id) DO NOTHING;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES (
  'task_manager_checklist_alert_cron_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trigger_task_manager_checklist_alert_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_url text := COALESCE(
    NULLIF(current_setting('app.settings.supabase_url', true), ''),
    'https://iagcamwcfuiopmwefohz.supabase.co'
  );
  cron_secret text;
BEGIN
  SELECT secret_value INTO cron_secret
  FROM public.system_runtime_secrets
  WHERE key_name = 'task_manager_checklist_alert_cron_secret';

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE EXCEPTION 'task_manager_checklist_alert_cron_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/task-manager-checklist-alert-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-task-manager-checklist-alert-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 120000
  );
END;
$$;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'tavari-task-manager-checklist-alert-dispatch';

SELECT cron.schedule(
  'tavari-task-manager-checklist-alert-dispatch',
  '*/5 * * * *',
  $$SELECT public.trigger_task_manager_checklist_alert_dispatch();$$
);

COMMENT ON TABLE public.task_manager_checklist_alert_settings IS
  'Business-wide settings for emailing managers when kiosk checklists are incomplete before the window closes.';

COMMENT ON TABLE public.task_manager_checklist_alert_recipients IS
  'Per checklist category: which employees receive incomplete checklist alert emails.';
