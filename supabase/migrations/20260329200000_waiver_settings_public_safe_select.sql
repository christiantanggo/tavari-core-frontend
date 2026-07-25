-- Allow anonymous/authenticated clients (kiosk, public waiver flow) to read
-- non-sensitive global waiver defaults needed to display expiry. Business-only
-- settings remain protected by existing policies for other keys.
DROP POLICY IF EXISTS waiver_settings_public_kiosk_read ON waiver_settings;

CREATE POLICY waiver_settings_public_kiosk_read ON waiver_settings
  FOR SELECT
  TO anon, authenticated
  USING (
    is_global = true
    AND template_id IS NULL
    AND setting_key IN (
      'default_expiry_days',
      'minor_age_threshold',
      'expiry_warning_days'
    )
  );

COMMENT ON POLICY waiver_settings_public_kiosk_read ON waiver_settings IS
  'Public read of safe global defaults for kiosk / unsigned waiver flows (expiry display).';
