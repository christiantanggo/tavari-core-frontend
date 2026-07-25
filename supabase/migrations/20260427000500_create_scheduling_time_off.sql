CREATE TABLE IF NOT EXISTS public.scheduling_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (
    request_type IN ('vacation', 'sick', 'personal', 'bereavement', 'jury_duty', 'other')
  ),
  start_date date NOT NULL,
  end_date date NOT NULL,
  start_time time without time zone,
  end_time time without time zone,
  total_hours numeric,
  status text DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'denied', 'cancelled')
  ),
  requested_by uuid NOT NULL REFERENCES public.users(id),
  approved_by uuid REFERENCES public.users(id),
  denied_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  denied_at timestamptz,
  denial_reason text,
  notes text,
  is_partial_day boolean DEFAULT false,
  attachment_urls text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduling_time_off_business_status
  ON public.scheduling_time_off (business_id, status, start_date DESC);

CREATE INDEX IF NOT EXISTS idx_scheduling_time_off_employee
  ON public.scheduling_time_off (employee_id, start_date DESC);

ALTER TABLE public.scheduling_time_off ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own time off" ON public.scheduling_time_off;
DROP POLICY IF EXISTS "Scheduling time off business access" ON public.scheduling_time_off;
DROP POLICY IF EXISTS "Scheduling time off select access" ON public.scheduling_time_off;
DROP POLICY IF EXISTS "Scheduling time off insert access" ON public.scheduling_time_off;
DROP POLICY IF EXISTS "Scheduling time off manager update access" ON public.scheduling_time_off;
DROP POLICY IF EXISTS "Scheduling time off manager delete access" ON public.scheduling_time_off;

CREATE POLICY "Scheduling time off select access"
  ON public.scheduling_time_off
  FOR SELECT
  TO authenticated
  USING (
    employee_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_time_off.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_time_off.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

CREATE POLICY "Scheduling time off insert access"
  ON public.scheduling_time_off
  FOR INSERT
  TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND (
      employee_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.business_users bu
        WHERE bu.business_id = scheduling_time_off.business_id
          AND bu.user_id = auth.uid()
          AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
      )
      OR EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.business_id = scheduling_time_off.business_id
          AND ur.user_id = auth.uid()
          AND ur.active = true
          AND ur.role IN ('owner', 'manager', 'admin')
      )
    )
  );

CREATE POLICY "Scheduling time off manager update access"
  ON public.scheduling_time_off
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_time_off.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_time_off.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_time_off.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_time_off.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

CREATE POLICY "Scheduling time off manager delete access"
  ON public.scheduling_time_off
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_time_off.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_time_off.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );
