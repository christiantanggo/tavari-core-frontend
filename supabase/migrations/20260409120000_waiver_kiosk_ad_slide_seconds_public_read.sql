-- Expose waiver_kiosk_ad_slide_seconds to anon kiosks (carousel timing).

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
      'require_photography_consent',
      'waiver_station_mode',
      'waiver_station_default_template_key',
      'waiver_station_templates',
      'waiver_kiosk_ad_slide_seconds'
    )
  );

COMMENT ON POLICY waiver_settings_public_kiosk_read ON public.waiver_settings IS
  'Public read of non-sensitive waiver settings needed by kiosk and public waiver flows.';
