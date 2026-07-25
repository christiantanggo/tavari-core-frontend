CREATE TABLE IF NOT EXISTS public.scheduling_schedule_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  seen_by uuid,
  seen_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (business_id, employee_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_scheduling_schedule_views_business_week
  ON public.scheduling_schedule_views (business_id, week_start, seen_at DESC);

ALTER TABLE public.scheduling_schedule_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees and managers can view schedule views"
  ON public.scheduling_schedule_views;
DROP POLICY IF EXISTS "Employees can record own schedule views"
  ON public.scheduling_schedule_views;
DROP POLICY IF EXISTS "Employees can refresh own schedule views"
  ON public.scheduling_schedule_views;

CREATE POLICY "Employees and managers can view schedule views"
  ON public.scheduling_schedule_views
  FOR SELECT
  TO authenticated
  USING (
    seen_by = auth.uid()
    OR employee_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_schedule_views.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_schedule_views.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

CREATE POLICY "Employees can record own schedule views"
  ON public.scheduling_schedule_views
  FOR INSERT
  TO authenticated
  WITH CHECK (
    seen_by = auth.uid()
    OR employee_id = auth.uid()
  );

CREATE POLICY "Employees can refresh own schedule views"
  ON public.scheduling_schedule_views
  FOR UPDATE
  TO authenticated
  USING (
    seen_by = auth.uid()
    OR employee_id = auth.uid()
  )
  WITH CHECK (
    seen_by = auth.uid()
    OR employee_id = auth.uid()
  );
