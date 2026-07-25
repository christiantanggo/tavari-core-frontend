-- Canonical website link overrides for tavari-api-business-links.

CREATE TABLE IF NOT EXISTS public.business_website_links (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  website_base_url TEXT,
  booking_url TEXT,
  open_play_booking_url TEXT,
  party_booking_url TEXT,
  camp_booking_url TEXT,
  group_booking_url TEXT,
  waiver_url TEXT,
  review_url TEXT,
  google_review_url TEXT,
  customer_portal_url TEXT,
  party_guest_list_url TEXT,
  camp_registration_url TEXT,
  review_link_label TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.business_website_links IS
  'Per-business canonical URLs for external marketing websites (OTWK). Null fields fall back to Tavari module defaults.';

ALTER TABLE public.business_website_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_website_links_select ON public.business_website_links
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY business_website_links_write ON public.business_website_links
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_website_links TO authenticated;
