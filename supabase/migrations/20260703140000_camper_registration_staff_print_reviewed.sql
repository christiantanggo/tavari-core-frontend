-- Staff checkbox on Bookings > Registration forms > Form Search (printed / reviewed).

ALTER TABLE public.camper_registration_documents
  ADD COLUMN IF NOT EXISTS staff_print_reviewed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_print_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS staff_print_reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.camper_registration_documents.staff_print_reviewed IS
  'When true, staff marked this registration form as printed or reviewed on the dashboard.';

CREATE INDEX IF NOT EXISTS idx_camper_registration_staff_print_reviewed
  ON public.camper_registration_documents (business_id, staff_print_reviewed, signed_at DESC);
