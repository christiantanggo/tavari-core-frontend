-- Payment overdue cancellation warnings + automatic cancellation deadline

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_cancel_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_cancel_warning_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_cancel_warning_sent_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_before_cancellation text;

COMMENT ON COLUMN public.bookings.payment_cancel_deadline_at IS
  'If set, booking is auto-cancelled when unpaid after this instant (UTC). Staff sets via overdue payment cancel-warning email.';
COMMENT ON COLUMN public.bookings.payment_cancel_warning_sent_at IS
  'When the last payment cancel-warning email was sent to the customer.';
COMMENT ON COLUMN public.bookings.status_before_cancellation IS
  'Booking status preserved when cancelled so staff can restore the booking.';

CREATE INDEX IF NOT EXISTS idx_bookings_payment_cancel_deadline
  ON public.bookings (payment_cancel_deadline_at)
  WHERE payment_cancel_deadline_at IS NOT NULL
    AND status <> 'cancelled';

INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES (
  'booking_payment_cancel_dispatch_cron_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trigger_booking_payment_cancel_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_url text := COALESCE(
    NULLIF(current_setting('app.settings.supabase_url', true), ''),
    'https://iagcamwcfuiopmwefohz.supabase.co'
  );
  cron_secret text;
BEGIN
  SELECT secret_value INTO cron_secret
  FROM public.system_runtime_secrets
  WHERE key_name = 'booking_payment_cancel_dispatch_cron_secret';

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE EXCEPTION 'booking_payment_cancel_dispatch_cron_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/booking-payment-cancel-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-booking-payment-cancel-dispatch-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 120000
  );
END;
$$;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'tavari-booking-payment-cancel-dispatch';

SELECT cron.schedule(
  'tavari-booking-payment-cancel-dispatch',
  '*/10 * * * *',
  $$SELECT public.trigger_booking_payment_cancel_dispatch();$$
);
