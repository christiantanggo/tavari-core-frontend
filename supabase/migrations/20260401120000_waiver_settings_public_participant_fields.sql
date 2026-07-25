-- Allow public waiver flows to read the non-sensitive settings needed
-- to render the participant information form correctly.

DROP POLICY IF EXISTS waiver_settings_public_kiosk_read ON public.waiver_settings;

CREATE POLICY waiver_settings_public_kiosk_read ON public.waiver_settings
  FOR SELECT
  TO anon, authenticated
  USING (
    is_global = true
    AND template_id IS NULL
    AND setting_key IN (
      'default_expiry_days',
      'minor_age_threshold',
      'expiry_warning_days',
      'participant_fields_config',
      'auto_click_marketing',
      'require_photography_consent'
    )
  );

COMMENT ON POLICY waiver_settings_public_kiosk_read ON public.waiver_settings IS
  'Public read of non-sensitive waiver settings needed by kiosk and public waiver flows.';
