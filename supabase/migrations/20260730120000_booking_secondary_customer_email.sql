ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS secondary_customer_email TEXT;

COMMENT ON COLUMN public.bookings.secondary_customer_email IS
  'Optional second email that receives the same booking transactional updates as the primary customer email (confirmations, payments, cancellations, etc.).';
