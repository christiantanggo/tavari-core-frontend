-- Public website FAQs for external marketing sites (OTWK).

CREATE TABLE IF NOT EXISTS public.business_website_faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  page_key TEXT NOT NULL
    CHECK (page_key IN ('faq', 'first-visit', 'home-teaser', 'admission')),
  category TEXT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_website_faqs_slug_lower CHECK (
    slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  CONSTRAINT business_website_faqs_question_nonempty CHECK (length(trim(question)) > 0),
  CONSTRAINT business_website_faqs_answer_nonempty CHECK (length(trim(answer)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_website_faqs_business_slug_key
  ON public.business_website_faqs (business_id, slug);

CREATE INDEX IF NOT EXISTS business_website_faqs_page_sort_idx
  ON public.business_website_faqs (business_id, page_key, sort_order)
  WHERE is_active = true;

COMMENT ON TABLE public.business_website_faqs IS
  'Website FAQ content for tavari-api-website-faqs (OTWK FAQ pages, home teaser, admission).';

COMMENT ON COLUMN public.business_website_faqs.page_key IS
  'Placement: faq (/faq), first-visit (/first-visit-guide), home-teaser (home JSON-LD), admission (/admission-pricing).';

COMMENT ON COLUMN public.business_website_faqs.answer IS
  'Answer text; may include {{token}} placeholders resolved by the public API.';

ALTER TABLE public.business_website_faqs ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_website_faqs_select ON public.business_website_faqs
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY business_website_faqs_write ON public.business_website_faqs
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_website_faqs TO authenticated;
