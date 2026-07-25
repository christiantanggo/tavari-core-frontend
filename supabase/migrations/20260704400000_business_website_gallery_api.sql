-- Public facility gallery images for external marketing sites (OTWK).

CREATE TABLE IF NOT EXISTS public.business_website_gallery_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  image_url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  caption TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  storage_path TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_website_gallery_images_slug_lower CHECK (
    slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS business_website_gallery_images_business_slug_key
  ON public.business_website_gallery_images (business_id, slug);

CREATE INDEX IF NOT EXISTS business_website_gallery_images_active_sort_idx
  ON public.business_website_gallery_images (business_id, sort_order)
  WHERE is_active = true;

COMMENT ON TABLE public.business_website_gallery_images IS
  'Facility gallery images for tavari-api-website-gallery (OTWK / in-venue reuse).';

COMMENT ON COLUMN public.business_website_gallery_images.tags IS
  'Optional labels for filtering or digital signage (e.g. playground, party-room).';

ALTER TABLE public.business_website_gallery_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_website_gallery_images_select ON public.business_website_gallery_images
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY business_website_gallery_images_write ON public.business_website_gallery_images
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_website_gallery_images TO authenticated;
