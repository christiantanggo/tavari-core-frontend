CREATE TABLE IF NOT EXISTS public.hr_employee_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  update_type text NOT NULL DEFAULT 'update' CHECK (update_type IN ('note', 'update', 'announcement')),
  title text NOT NULL,
  body text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'important', 'critical')),
  due_date date,
  requires_acknowledgement boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES public.users(id),
  employee_note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_hr_employee_updates_business_type
  ON public.hr_employee_updates (business_id, update_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hr_employee_updates_employee
  ON public.hr_employee_updates (employee_id, acknowledged_at, due_date)
  WHERE cancelled_at IS NULL;

ALTER TABLE public.hr_employee_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees and managers can view employee updates" ON public.hr_employee_updates;
DROP POLICY IF EXISTS "Managers can manage employee updates" ON public.hr_employee_updates;

CREATE POLICY "Employees and managers can view employee updates"
  ON public.hr_employee_updates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = hr_employee_updates.employee_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = hr_employee_updates.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = hr_employee_updates.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = hr_employee_updates.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

CREATE POLICY "Managers can manage employee updates"
  ON public.hr_employee_updates
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = hr_employee_updates.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = hr_employee_updates.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = hr_employee_updates.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = hr_employee_updates.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = hr_employee_updates.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = hr_employee_updates.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );
