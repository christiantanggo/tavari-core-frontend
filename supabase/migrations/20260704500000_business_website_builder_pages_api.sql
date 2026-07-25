-- CMS builder page layouts for external marketing sites (OTWK). Read-only JSON by slug.

CREATE TABLE IF NOT EXISTS public.business_website_builder_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  content JSONB NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_website_builder_pages_slug_lower CHECK (
    slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS business_website_builder_pages_business_slug_key
  ON public.business_website_builder_pages (business_id, slug);

CREATE INDEX IF NOT EXISTS business_website_builder_pages_active_updated_idx
  ON public.business_website_builder_pages (business_id, updated_at DESC)
  WHERE is_active = true;

COMMENT ON TABLE public.business_website_builder_pages IS
  'Read-only CMS builder JSON for tavari-api-website-builder-pages (OTWK renderer).';

COMMENT ON COLUMN public.business_website_builder_pages.content IS
  'BuilderPageContent JSON: metaTitle, metaDescription, sections[].';

ALTER TABLE public.business_website_builder_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_website_builder_pages_select ON public.business_website_builder_pages
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY business_website_builder_pages_write ON public.business_website_builder_pages
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_website_builder_pages TO authenticated;
