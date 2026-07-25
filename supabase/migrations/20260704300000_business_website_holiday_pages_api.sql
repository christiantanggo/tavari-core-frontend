-- Holiday landing page copy keyed to special-hour event keys (OTWK).

CREATE TABLE IF NOT EXISTS public.business_website_holiday_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  route_path TEXT NOT NULL,
  name TEXT NOT NULL,
  event_keys TEXT[] NOT NULL DEFAULT '{}',
  event_keywords TEXT[] NOT NULL DEFAULT '{}',
  seo_title TEXT NOT NULL,
  seo_description TEXT NOT NULL,
  h1 TEXT NOT NULL,
  intro TEXT NOT NULL,
  search_question TEXT NOT NULL,
  when_text TEXT NOT NULL,
  planning_tip TEXT NOT NULL,
  primary_cta_label TEXT NOT NULL,
  related_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_website_holiday_pages_slug_lower CHECK (
    slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS business_website_holiday_pages_business_slug_key
  ON public.business_website_holiday_pages (business_id, slug);

CREATE INDEX IF NOT EXISTS business_website_holiday_pages_active_sort_idx
  ON public.business_website_holiday_pages (business_id, sort_order)
  WHERE is_active = true;

COMMENT ON TABLE public.business_website_holiday_pages IS
  'Holiday guide landing pages for tavari-api-holiday-pages (OTWK SEO/copy keyed to special-hour events).';

COMMENT ON COLUMN public.business_website_holiday_pages.event_keys IS
  'Stable special-hour event keys (family-day, thanksgiving-weekend, etc.) used to link Tavari holiday_hours rows.';

ALTER TABLE public.business_website_holiday_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_website_holiday_pages_select ON public.business_website_holiday_pages
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY business_website_holiday_pages_write ON public.business_website_holiday_pages
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_website_holiday_pages TO authenticated;
