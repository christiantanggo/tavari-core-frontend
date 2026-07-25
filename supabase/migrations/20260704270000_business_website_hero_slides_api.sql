-- Always-on homepage hero carousel slides for external marketing sites (OTWK).

CREATE TABLE IF NOT EXISTS public.business_website_hero_slides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  image_url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  title TEXT,
  caption TEXT,
  cta_text TEXT,
  cta_href TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  show_text_overlay BOOLEAN NOT NULL DEFAULT true,
  image_focus_x REAL NOT NULL DEFAULT 50,
  image_focus_y REAL NOT NULL DEFAULT 50,
  valid_from DATE,
  valid_until DATE,
  show_on_days INTEGER[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_website_hero_slides_slug_lower CHECK (
    slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  CONSTRAINT business_website_hero_slides_valid_range CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS business_website_hero_slides_business_slug_key
  ON public.business_website_hero_slides (business_id, slug);

CREATE INDEX IF NOT EXISTS business_website_hero_slides_active_sort_idx
  ON public.business_website_hero_slides (business_id, sort_order)
  WHERE is_active = true;

COMMENT ON TABLE public.business_website_hero_slides IS
  'Scheduled homepage hero carousel slides for tavari-api-website-hero-slides (OTWK rotator).';

COMMENT ON COLUMN public.business_website_hero_slides.valid_from IS
  'Slide appears on or after this calendar date in the business timezone (inclusive). Null = no start limit.';

COMMENT ON COLUMN public.business_website_hero_slides.valid_until IS
  'Slide appears on or before this calendar date in the business timezone (inclusive). Null = no end limit.';

COMMENT ON COLUMN public.business_website_hero_slides.show_on_days IS
  'If set, slide only shows on these days of week: 0=Sun … 6=Sat. Null or empty = all days.';

ALTER TABLE public.business_website_hero_slides ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_website_hero_slides_select ON public.business_website_hero_slides
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY business_website_hero_slides_write ON public.business_website_hero_slides
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_website_hero_slides TO authenticated;
