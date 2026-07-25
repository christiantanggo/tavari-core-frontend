-- Track who created/changed bookings and client IP at creation.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS created_ip TEXT,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_ip TEXT;

COMMENT ON COLUMN public.bookings.created_ip IS 'Client IP when the booking was first created (portal or staff session).';
COMMENT ON COLUMN public.bookings.updated_by IS 'Staff user who last modified the booking record.';
COMMENT ON COLUMN public.bookings.updated_ip IS 'Client IP when the booking was last modified by staff.';

ALTER TABLE public.booking_pending_helcim
  ADD COLUMN IF NOT EXISTS client_ip TEXT;

COMMENT ON COLUMN public.booking_pending_helcim.client_ip IS 'Customer IP at checkout init; copied to bookings.created_ip on payment finalize.';
