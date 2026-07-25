-- Website-facing promotions for external marketing sites (OTWK hero, popups, floating CTAs, landing pages).

CREATE TABLE IF NOT EXISTS public.business_website_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  audience TEXT NOT NULL DEFAULT 'web'
    CHECK (audience IN ('web', 'app', 'both')),
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  countdown_prefix TEXT NOT NULL DEFAULT 'Sale Ends In',
  page_meta_title TEXT,
  page_meta_description TEXT,
  page_content JSONB NOT NULL DEFAULT '{"sections":[],"metaTitle":"","metaDescription":""}'::jsonb,
  hero_enabled BOOLEAN NOT NULL DEFAULT false,
  hero_image_url TEXT,
  hero_image_alt TEXT NOT NULL DEFAULT '',
  popup_enabled BOOLEAN NOT NULL DEFAULT false,
  popup_title TEXT NOT NULL DEFAULT '',
  popup_body TEXT NOT NULL DEFAULT '',
  popup_cta_label TEXT,
  popup_cta_href TEXT,
  home_button_enabled BOOLEAN NOT NULL DEFAULT false,
  home_section_id TEXT,
  home_button_label TEXT,
  home_button_href TEXT,
  floating_enabled BOOLEAN NOT NULL DEFAULT false,
  floating_label TEXT,
  floating_href TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_website_promotions_slug_lower CHECK (
    slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  CONSTRAINT business_website_promotions_ends_after_starts CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_website_promotions_business_slug_key
  ON public.business_website_promotions (business_id, slug);

CREATE INDEX IF NOT EXISTS business_website_promotions_window_idx
  ON public.business_website_promotions (business_id, starts_at, ends_at)
  WHERE is_active = true;

COMMENT ON TABLE public.business_website_promotions IS
  'Timed website campaigns for tavari-api-website-promotions (OTWK hero, popup, floating buttons, landing pages).';

ALTER TABLE public.business_website_promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_website_promotions_select ON public.business_website_promotions
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY business_website_promotions_write ON public.business_website_promotions
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_website_promotions TO authenticated;
