-- Audience targeting for digital signage ads (in-venue screens vs website reuse).

ALTER TABLE public.digital_signage_ads
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'venue'
    CHECK (audience IN ('venue', 'web', 'both'));

COMMENT ON COLUMN public.digital_signage_ads.audience IS
  'Where this creative may appear: venue (screens/kiosk), web (OTWK marketing), or both.';

CREATE INDEX IF NOT EXISTS idx_digital_signage_ads_business_audience_active
  ON public.digital_signage_ads (business_id, audience, is_active, start_date, end_date)
  WHERE is_active = true;
