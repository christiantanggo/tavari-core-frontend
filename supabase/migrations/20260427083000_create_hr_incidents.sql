CREATE TABLE IF NOT EXISTS public.hr_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  incident_type text NOT NULL DEFAULT 'general' CHECK (incident_type IN ('general', 'safety', 'injury', 'customer', 'conflict', 'property_damage', 'policy_violation', 'other')),
  severity text NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'closed')),
  occurred_at timestamptz,
  location text,
  reported_by_employee_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  subject_employee_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  employee_visible boolean NOT NULL DEFAULT true,
  manager_notes text,
  resolution_notes text,
  created_by uuid REFERENCES auth.users(id),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_incidents_business_status
  ON public.hr_incidents (business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hr_incidents_reported_by
  ON public.hr_incidents (reported_by_employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hr_incidents_subject
  ON public.hr_incidents (subject_employee_id, created_at DESC);

ALTER TABLE public.hr_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees and managers can view incidents" ON public.hr_incidents;
DROP POLICY IF EXISTS "Managers can manage incidents" ON public.hr_incidents;

CREATE POLICY "Employees and managers can view incidents"
  ON public.hr_incidents
  FOR SELECT
  TO authenticated
  USING (
    (
      employee_visible = true
      AND EXISTS (
        SELECT 1
        FROM public.users u
        WHERE (u.id = hr_incidents.reported_by_employee_id OR u.id = hr_incidents.subject_employee_id)
          AND lower(u.email) = lower(auth.jwt() ->> 'email')
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = hr_incidents.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = hr_incidents.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = hr_incidents.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

CREATE POLICY "Managers can manage incidents"
  ON public.hr_incidents
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = hr_incidents.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = hr_incidents.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = hr_incidents.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = hr_incidents.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = hr_incidents.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = hr_incidents.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );
