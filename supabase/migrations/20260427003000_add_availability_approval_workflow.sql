ALTER TABLE public.scheduling_availability
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS denied_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS denied_at timestamptz,
  ADD COLUMN IF NOT EXISTS denial_reason text,
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.users(id);

UPDATE public.scheduling_availability
SET status = COALESCE(status, 'approved')
WHERE status IS NULL;

UPDATE public.scheduling_availability
SET status = 'approved'
WHERE status NOT IN ('pending', 'approved', 'denied', 'cancelled');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduling_availability_status_check'
      AND conrelid = 'public.scheduling_availability'::regclass
  ) THEN
    ALTER TABLE public.scheduling_availability
      ADD CONSTRAINT scheduling_availability_status_check
      CHECK (status IN ('pending', 'approved', 'denied', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scheduling_availability_business_status
  ON public.scheduling_availability (business_id, status);

DROP POLICY IF EXISTS "Users can manage own availability" ON public.scheduling_availability;
DROP POLICY IF EXISTS "Users can view own availability" ON public.scheduling_availability;
DROP POLICY IF EXISTS "Scheduling availability select access" ON public.scheduling_availability;
DROP POLICY IF EXISTS "Scheduling availability insert access" ON public.scheduling_availability;
DROP POLICY IF EXISTS "Scheduling availability manager update access" ON public.scheduling_availability;
DROP POLICY IF EXISTS "Scheduling availability manager delete access" ON public.scheduling_availability;

CREATE POLICY "Scheduling availability select access"
  ON public.scheduling_availability
  FOR SELECT
  TO authenticated
  USING (
    employee_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_availability.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_availability.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

CREATE POLICY "Scheduling availability insert access"
  ON public.scheduling_availability
  FOR INSERT
  TO authenticated
  WITH CHECK (
    employee_id = auth.uid()
    OR requested_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_availability.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_availability.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

CREATE POLICY "Scheduling availability manager update access"
  ON public.scheduling_availability
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_availability.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_availability.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_availability.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_availability.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

CREATE POLICY "Scheduling availability manager delete access"
  ON public.scheduling_availability
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_availability.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_availability.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );
