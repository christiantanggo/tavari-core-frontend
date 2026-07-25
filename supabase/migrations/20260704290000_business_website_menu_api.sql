-- Concession menu structure for external marketing sites (OTWK).

CREATE TABLE IF NOT EXISTS public.business_website_menu (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  menu_source TEXT NOT NULL DEFAULT 'api'
    CHECK (menu_source IN ('manual', 'api')),
  menu_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  menu_pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.business_website_menu IS
  'Website concession menu for tavari-api-website-menu (OTWK sections + Tavari SKU links).';

COMMENT ON COLUMN public.business_website_menu.menu_source IS
  'manual = use stored prices; api = resolve names/prices/images from linked Tavari inventory.';

COMMENT ON COLUMN public.business_website_menu.menu_sections IS
  'Array of sections with manual or tavari-linked items (same shape as OTWK site_settings.menu_sections).';

COMMENT ON COLUMN public.business_website_menu.menu_pdf_url IS
  'Optional downloadable PDF menu URL for legacy/print links.';

ALTER TABLE public.business_website_menu ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_website_menu_select ON public.business_website_menu
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY business_website_menu_write ON public.business_website_menu
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_website_menu TO authenticated;
