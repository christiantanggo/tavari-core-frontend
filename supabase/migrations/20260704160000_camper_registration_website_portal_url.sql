-- Public website URL for camp registration portal (OTWK and other external sites)

ALTER TABLE public.camper_registration_form_templates
  ADD COLUMN IF NOT EXISTS website_portal_url TEXT;

COMMENT ON COLUMN public.camper_registration_form_templates.website_portal_url IS
  'Optional public website URL where parents open camp registration (e.g. https://www.offthewallkids.ca/camp-registration). Returned by tavari-api-camp-registration getPortalInfo as websitePortalUrl.';
