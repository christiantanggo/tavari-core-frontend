CREATE TABLE IF NOT EXISTS public.hr_employee_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('writeup', 'disciplinary_action', 'termination', 'important_notice')),
  title text NOT NULL,
  body text,
  source_table text,
  source_id uuid,
  severity text NOT NULL DEFAULT 'normal' CHECK (severity IN ('normal', 'important', 'critical')),
  due_date date,
  requires_acknowledgement boolean NOT NULL DEFAULT true,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES public.users(id),
  employee_note text,
  manager_note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_hr_employee_ack_business_type
  ON public.hr_employee_acknowledgements (business_id, item_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hr_employee_ack_employee_pending
  ON public.hr_employee_acknowledgements (employee_id, acknowledged_at, due_date)
  WHERE cancelled_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_employee_ack_source_unique
  ON public.hr_employee_acknowledgements (business_id, employee_id, source_table, source_id)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;

ALTER TABLE public.hr_employee_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees and managers can view forced acknowledgements" ON public.hr_employee_acknowledgements;
DROP POLICY IF EXISTS "Managers can manage forced acknowledgements" ON public.hr_employee_acknowledgements;

CREATE POLICY "Employees and managers can view forced acknowledgements"
  ON public.hr_employee_acknowledgements
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = hr_employee_acknowledgements.employee_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = hr_employee_acknowledgements.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = hr_employee_acknowledgements.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = hr_employee_acknowledgements.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

CREATE POLICY "Managers can manage forced acknowledgements"
  ON public.hr_employee_acknowledgements
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = hr_employee_acknowledgements.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = hr_employee_acknowledgements.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = hr_employee_acknowledgements.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = hr_employee_acknowledgements.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = hr_employee_acknowledgements.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = hr_employee_acknowledgements.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );
