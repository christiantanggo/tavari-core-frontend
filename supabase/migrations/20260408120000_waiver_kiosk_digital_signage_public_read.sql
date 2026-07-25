-- Allow unauthenticated waiver kiosks (anon key) to read active waiver-kiosk ad rows
-- and fetch the corresponding storage objects (for signed URL / image delivery).

-- ---------------------------------------------------------------------------
-- digital_signage_content: public read only for waiver kiosk creative
-- ---------------------------------------------------------------------------
CREATE POLICY "digital_signage_content_public_waiver_kiosk_select"
  ON public.digital_signage_content
  FOR SELECT
  TO anon
  USING (
    is_active = true
    AND (
      folder_path = 'waiver-kiosk-ads'
      OR 'waiver-kiosk-ad' = ANY (COALESCE(tags, '{}'::text[]))
    )
  );

-- ---------------------------------------------------------------------------
-- digital_signage_ads: public read only when linked to waiver kiosk content
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "digital_signage_ads_public_waiver_kiosk_select" ON public.digital_signage_ads;
CREATE POLICY "digital_signage_ads_public_waiver_kiosk_select"
  ON public.digital_signage_ads
  FOR SELECT
  TO anon
  USING (
    is_active = true
    AND status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.digital_signage_content c
      WHERE c.id = digital_signage_ads.content_id
        AND c.is_active = true
        AND (
          c.folder_path = 'waiver-kiosk-ads'
          OR 'waiver-kiosk-ad' = ANY (COALESCE(c.tags, '{}'::text[]))
        )
    )
  );

-- NOTE: Do not CREATE POLICY on storage.objects here (42501: must be owner).
-- Kiosk images use the Edge Function waiver-kiosk-ad-urls (service role signs URLs).
-- Optional legacy script: src/supabase/waiver_kiosk_storage_anon_select_policy.sql

COMMENT ON POLICY "digital_signage_content_public_waiver_kiosk_select" ON public.digital_signage_content IS
  'Waiver kiosk (anon) can load kiosk ad creative metadata for attract-mode images.';

COMMENT ON POLICY "digital_signage_ads_public_waiver_kiosk_select" ON public.digital_signage_ads IS
  'Waiver kiosk (anon) can load active ads tied to waiver-kiosk content.';
