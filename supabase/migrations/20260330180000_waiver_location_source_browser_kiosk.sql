-- Allow on-site browser kiosk as a distinct signing source (shared station, not customer's personal device).

ALTER TABLE waiver_signatures
  DROP CONSTRAINT IF EXISTS waiver_signatures_location_source_check;

ALTER TABLE waiver_signatures
  ADD CONSTRAINT waiver_signatures_location_source_check
  CHECK (
    location_source IS NULL
    OR location_source IN (
      'browser',
      'browser_kiosk',
      'kiosk',
      'in_person',
      'off_site',
      'mobile_app',
      'mobile_web'
    )
  );

COMMENT ON COLUMN waiver_signatures.location_source IS
  'Signing context: browser (customer own device), browser_kiosk (on-site shared browser station), kiosk (tablet/Electron app), mobile_web, mobile_app, in_person, off_site';
