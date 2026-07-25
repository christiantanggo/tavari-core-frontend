-- Staff follow-up status for bookings awaiting approval (dashboard pending queue).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS approval_follow_up_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_follow_up_status IN ('pending', 'contacted')),
  ADD COLUMN IF NOT EXISTS approval_contacted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.bookings.approval_follow_up_status IS
  'Staff follow-up on approval-required pending bookings: pending or contacted.';
COMMENT ON COLUMN public.bookings.approval_contacted_at IS
  'When staff marked the booking as contacted in the approval queue.';

CREATE INDEX IF NOT EXISTS idx_bookings_approval_follow_up
  ON public.bookings (business_id, approval_follow_up_status)
  WHERE requires_approval = true AND approved_at IS NULL AND status = 'pending';
