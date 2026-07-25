-- Auto-assigned shift premiums from certificate uploads require manager approval before payroll use.

ALTER TABLE public.hrpayroll_employee_premiums
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS assignment_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (assignment_source IN ('manual', 'certificate_upload')),
  ADD COLUMN IF NOT EXISTS employee_certificate_id UUID
    REFERENCES public.employee_certificates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

COMMENT ON COLUMN public.hrpayroll_employee_premiums.approval_status IS
  'pending = awaiting manager approval; approved/rejected gate payroll via is_active.';
COMMENT ON COLUMN public.hrpayroll_employee_premiums.assignment_source IS
  'certificate_upload rows are created when an employee uploads a matching certificate.';

CREATE INDEX IF NOT EXISTS idx_hrpayroll_employee_premiums_pending
  ON public.hrpayroll_employee_premiums (business_id, approval_status)
  WHERE approval_status = 'pending';

CREATE TABLE IF NOT EXISTS public.shift_premium_approval_action_tokens (
  token TEXT PRIMARY KEY,
  premium_assignment_id UUID NOT NULL
    REFERENCES public.hrpayroll_employee_premiums(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  manager_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  manager_email TEXT,
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_premium_approval_tokens_assignment
  ON public.shift_premium_approval_action_tokens (premium_assignment_id);

ALTER TABLE public.shift_premium_approval_action_tokens ENABLE ROW LEVEL SECURITY;
