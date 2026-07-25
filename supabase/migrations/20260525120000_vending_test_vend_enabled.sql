-- Per-device flag: allow test dispense (no payment) on the public kiosk.

ALTER TABLE public.vending_devices
  ADD COLUMN IF NOT EXISTS test_vend_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vending_devices.test_vend_enabled IS
  'When true, kiosk shows Test vend (no pay) and createOrder is allowed without Helcim payment.';
