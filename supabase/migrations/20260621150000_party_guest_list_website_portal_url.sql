-- Public website URL for party guest list (OTWK and other external sites)

ALTER TABLE public.party_guest_list_settings
  ADD COLUMN IF NOT EXISTS website_portal_url TEXT;

COMMENT ON COLUMN public.party_guest_list_settings.website_portal_url IS
  'Optional public website URL where party parents manage guest lists. Returned by tavari-api-party-guest-list getPortalInfo as websitePortalUrl.';
