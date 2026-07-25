-- OTWK London: canonical website links via tavari-api-business-links.

INSERT INTO public.business_website_links (
  business_id,
  website_base_url,
  waiver_url,
  party_guest_list_url,
  camp_registration_url,
  review_link_label
)
VALUES (
  'cb982fca-cf7a-4f59-b9c7-55ca0364eddc',
  'https://www.offthewallkids.ca',
  'https://www.offthewallkids.ca/waiver',
  'https://www.offthewallkids.ca/party-guest-list',
  'https://www.offthewallkids.ca/camp-registration',
  'Leave Us A Review'
)
ON CONFLICT (business_id) DO UPDATE SET
  website_base_url = EXCLUDED.website_base_url,
  waiver_url = EXCLUDED.waiver_url,
  party_guest_list_url = EXCLUDED.party_guest_list_url,
  camp_registration_url = EXCLUDED.camp_registration_url,
  party_manage_url = EXCLUDED.party_manage_url,
  review_link_label = EXCLUDED.review_link_label,
  updated_at = now();

UPDATE public.business_website_links
SET party_manage_url = 'https://www.tavarios.ca/customer-portal/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/portal'
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
  AND coalesce(trim(party_manage_url), '') = '';

UPDATE public.party_guest_list_settings
SET website_portal_url = 'https://www.offthewallkids.ca/party-guest-list'
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
  AND coalesce(trim(website_portal_url), '') = '';

UPDATE public.camper_registration_form_templates
SET website_portal_url = 'https://www.offthewallkids.ca/camp-registration'
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
  AND coalesce(trim(website_portal_url), '') = '';
