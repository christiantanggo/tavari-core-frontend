-- Snapshot of approved timesheet/payroll-ready hours for a business pay period.
-- Populated from the app when a manager approves; payroll reads this instead of recalculating on the fly.

CREATE TABLE IF NOT EXISTS public.scheduling_timesheet_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'superseded')),
  approved_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (business_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS public.scheduling_timesheet_approval_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL REFERENCES public.scheduling_timesheet_approvals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  total_hours numeric(14,4) NOT NULL DEFAULT 0,
  overtime_hours numeric(14,4) NOT NULL DEFAULT 0,
  premium_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (approval_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ts_approvals_business_period
  ON public.scheduling_timesheet_approvals (business_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_ts_approval_lines_approval
  ON public.scheduling_timesheet_approval_lines (approval_id);

CREATE INDEX IF NOT EXISTS idx_ts_approval_lines_user
  ON public.scheduling_timesheet_approval_lines (user_id);

ALTER TABLE public.scheduling_timesheet_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_timesheet_approval_lines ENABLE ROW LEVEL SECURITY;

-- Business members can read (scheduling + payroll)
DROP POLICY IF EXISTS "Timesheet approvals select" ON public.scheduling_timesheet_approvals;
CREATE POLICY "Timesheet approvals select"
  ON public.scheduling_timesheet_approvals
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_timesheet_approvals.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_timesheet_approvals.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

DROP POLICY IF EXISTS "Managers insert timesheet approvals" ON public.scheduling_timesheet_approvals;
CREATE POLICY "Managers insert timesheet approvals"
  ON public.scheduling_timesheet_approvals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_timesheet_approvals.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_timesheet_approvals.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

DROP POLICY IF EXISTS "Managers update timesheet approvals" ON public.scheduling_timesheet_approvals;
CREATE POLICY "Managers update timesheet approvals"
  ON public.scheduling_timesheet_approvals
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_timesheet_approvals.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_timesheet_approvals.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_timesheet_approvals.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_timesheet_approvals.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

DROP POLICY IF EXISTS "Managers delete timesheet approvals" ON public.scheduling_timesheet_approvals;
CREATE POLICY "Managers delete timesheet approvals"
  ON public.scheduling_timesheet_approvals
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_timesheet_approvals.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_timesheet_approvals.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

-- Lines: read with business access; write with manager on parent business
DROP POLICY IF EXISTS "Timesheet approval lines select" ON public.scheduling_timesheet_approval_lines;
CREATE POLICY "Timesheet approval lines select"
  ON public.scheduling_timesheet_approval_lines
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.scheduling_timesheet_approvals a
      JOIN public.business_users bu ON bu.business_id = a.business_id
      WHERE a.id = scheduling_timesheet_approval_lines.approval_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.scheduling_timesheet_approvals a
      JOIN public.user_roles ur ON ur.business_id = a.business_id
      WHERE a.id = scheduling_timesheet_approval_lines.approval_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

DROP POLICY IF EXISTS "Managers insert timesheet approval lines" ON public.scheduling_timesheet_approval_lines;
CREATE POLICY "Managers insert timesheet approval lines"
  ON public.scheduling_timesheet_approval_lines
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.scheduling_timesheet_approvals a
      JOIN public.business_users bu ON bu.business_id = a.business_id
      WHERE a.id = scheduling_timesheet_approval_lines.approval_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.scheduling_timesheet_approvals a
      JOIN public.user_roles ur ON ur.business_id = a.business_id
      WHERE a.id = scheduling_timesheet_approval_lines.approval_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

DROP POLICY IF EXISTS "Managers delete timesheet approval lines" ON public.scheduling_timesheet_approval_lines;
CREATE POLICY "Managers delete timesheet approval lines"
  ON public.scheduling_timesheet_approval_lines
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.scheduling_timesheet_approvals a
      JOIN public.business_users bu ON bu.business_id = a.business_id
      WHERE a.id = scheduling_timesheet_approval_lines.approval_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.scheduling_timesheet_approvals a
      JOIN public.user_roles ur ON ur.business_id = a.business_id
      WHERE a.id = scheduling_timesheet_approval_lines.approval_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

COMMENT ON TABLE public.scheduling_timesheet_approvals IS
  'Manager-approved snapshot of timesheet-driven hours for a date range; payroll can read this instead of recalculating.';

COMMENT ON TABLE public.scheduling_timesheet_approval_lines IS
  'Per-employee approved total hours and premium_hours JSON (names match hr_shift_premiums / payroll).';
