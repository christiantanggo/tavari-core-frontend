-- OTWK London: seed website promotions in Tavari (copy rows from OTWK `public.promos` as needed).
-- Example placeholder — replace page_content / dates / assets before enabling a live campaign.

INSERT INTO public.business_website_promotions (
  business_id,
  slug,
  label,
  starts_at,
  ends_at,
  audience,
  priority,
  is_active,
  countdown_prefix,
  hero_enabled,
  popup_enabled,
  floating_enabled,
  home_button_enabled
)
VALUES (
  'cb982fca-cf7a-4f59-b9c7-55ca0364eddc',
  'example-campaign',
  'Example campaign (disabled window)',
  '2099-01-01T05:00:00+00:00',
  '2099-01-02T04:59:59+00:00',
  'web',
  100,
  false,
  'Sale Ends In',
  false,
  false,
  false,
  false
)
ON CONFLICT (business_id, slug) DO NOTHING;
