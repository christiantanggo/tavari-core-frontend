-- Add manage-existing-booking URL for OTWK /manage-your-party (replaces Bookeo customer area).

ALTER TABLE public.business_website_links
  ADD COLUMN IF NOT EXISTS party_manage_url TEXT;

COMMENT ON COLUMN public.business_website_links.party_manage_url IS
  'Customer portal URL for managing existing bookings (party manage CTA on marketing site). Falls back to customer_portal_url.';
