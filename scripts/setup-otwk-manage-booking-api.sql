-- OTWK London: manage-booking URLs (replaces Bookeo customer area).

UPDATE public.business_website_links
SET
  manage_booking_url = 'https://www.tavarios.ca/customer-portal/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/portal/manage-booking',
  party_manage_url = 'https://www.tavarios.ca/customer-portal/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/portal/manage-booking',
  updated_at = now()
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
