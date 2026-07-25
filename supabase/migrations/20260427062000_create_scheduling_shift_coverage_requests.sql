CREATE TABLE IF NOT EXISTS public.scheduling_shift_coverage_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES public.scheduling_shifts(id) ON DELETE CASCADE,
  requester_employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_type text NOT NULL DEFAULT 'coverage' CHECK (request_type IN ('coverage', 'swap')),
  offered_shift_id uuid REFERENCES public.scheduling_shifts(id) ON DELETE SET NULL,
  target_employee_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  reason text,
  manager_notes text,
  requested_by uuid REFERENCES auth.users(id),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_coverage_requests_business_status
  ON public.scheduling_shift_coverage_requests (business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shift_coverage_requests_requester
  ON public.scheduling_shift_coverage_requests (requester_employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shift_coverage_requests_shift
  ON public.scheduling_shift_coverage_requests (shift_id);

ALTER TABLE public.scheduling_shift_coverage_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Shift coverage request select access" ON public.scheduling_shift_coverage_requests;
DROP POLICY IF EXISTS "Shift coverage request manager update access" ON public.scheduling_shift_coverage_requests;

CREATE POLICY "Shift coverage request select access"
  ON public.scheduling_shift_coverage_requests
  FOR SELECT
  TO authenticated
  USING (
    requested_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_shift_coverage_requests.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = scheduling_shift_coverage_requests.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_shift_coverage_requests.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

CREATE POLICY "Shift coverage request manager update access"
  ON public.scheduling_shift_coverage_requests
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_shift_coverage_requests.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = scheduling_shift_coverage_requests.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_shift_coverage_requests.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_shift_coverage_requests.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = scheduling_shift_coverage_requests.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_shift_coverage_requests.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );
