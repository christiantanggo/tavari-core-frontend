CREATE TABLE IF NOT EXISTS public.employee_notification_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notification_key text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, employee_id, notification_key)
);

CREATE INDEX IF NOT EXISTS idx_employee_notification_reads_employee
  ON public.employee_notification_reads (employee_id, business_id, read_at DESC);

ALTER TABLE public.employee_notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees can view own notification reads" ON public.employee_notification_reads;

CREATE POLICY "Employees can view own notification reads"
  ON public.employee_notification_reads
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = employee_notification_reads.employee_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = employee_notification_reads.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
  );
