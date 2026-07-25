-- Short typed kiosk code → /v/{code} (replaces long query-string URLs on the machine).

ALTER TABLE public.vending_devices
  ADD COLUMN IF NOT EXISTS kiosk_short_code TEXT;

-- Backfill existing devices (readable charset, no 0/O/1/I).
DO $$
DECLARE
  r RECORD;
  chars TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  new_code TEXT;
  attempts INT;
BEGIN
  FOR r IN SELECT id FROM public.vending_devices WHERE kiosk_short_code IS NULL LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      new_code := '';
      FOR i IN 1..6 LOOP
        new_code := new_code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.vending_devices WHERE kiosk_short_code = new_code);
      IF attempts > 50 THEN
        RAISE EXCEPTION 'Could not assign unique kiosk_short_code for device %', r.id;
      END IF;
    END LOOP;
    UPDATE public.vending_devices SET kiosk_short_code = new_code WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.vending_devices
  ALTER COLUMN kiosk_short_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vending_devices_kiosk_short_code
  ON public.vending_devices (kiosk_short_code);

COMMENT ON COLUMN public.vending_devices.kiosk_short_code IS
  '6-char code for short kiosk URL /v/{code}. Typed on vending machine browser.';
