-- Allow access to music_local_ads via business_users (in addition to existing user_roles policy).
-- Fixes "Failed to load local ads" when app uses business_users for access.
-- RLS: multiple permissive policies are OR'd, so user_roles OR business_users grants access.

DROP POLICY IF EXISTS "music_local_ads_business_users_access" ON public.music_local_ads;

CREATE POLICY "music_local_ads_business_users_access"
  ON public.music_local_ads
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = music_local_ads.business_id
        AND bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = music_local_ads.business_id
        AND bu.user_id = auth.uid()
    )
  );
