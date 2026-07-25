-- booking_acquire_slot_holds existed in two overloads (6-arg and 7-arg with default p_spaces_requested).
-- PostgREST could not resolve the 6-arg call when p_customer_id is null ("function is not unique").

DROP FUNCTION IF EXISTS public.booking_acquire_slot_hold(
  UUID,
  UUID,
  DATE,
  TIME WITHOUT TIME ZONE,
  TEXT,
  UUID
);
