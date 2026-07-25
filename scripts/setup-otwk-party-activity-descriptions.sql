-- OTWK London: public portal party names + descriptions (Classic / Super / Ultimate).
-- Legacy staff-only tiers (12/24/36) are unchanged.

UPDATE public.booking_activities SET
  activity_name = 'Classic Birthday Party',
  description = 'Classic Birthday Party — up to 10 kids and 10 adults · 90 minutes in the private party room (on your booked schedule) · Unlimited play in the facility until we close · Included party food bundle — choose 1 of 3 options when booking.',
  website_food_credit = NULL,
  website_package_inclusions = '["Classic Birthday Party — up to 10 kids and 10 adults included", "90 minutes in the private party room (on your booked schedule)", "Unlimited play in the facility until we close", "Included party food bundle — choose 1 of 3 options when booking"]'::jsonb,
  website_show_party_package = true,
  website_sort_order = 1,
  website_highlighted = false,
  updated_at = now()
WHERE id = 'd4f2f7a0-d20e-4045-90dd-09a94765a4fa'
  AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

UPDATE public.booking_activities SET
  activity_name = 'Super Birthday Party',
  description = 'Super Birthday Party — up to 20 kids and 20 adults · 90 minutes in the private party room (on your booked schedule) · Unlimited play in the facility until we close · Included party food bundle — choose 1 of 3 options when booking.',
  website_food_credit = NULL,
  website_package_inclusions = '["Super Birthday Party — up to 20 kids and 20 adults included", "90 minutes in the private party room (on your booked schedule)", "Unlimited play in the facility until we close", "Included party food bundle — choose 1 of 3 options when booking"]'::jsonb,
  website_show_party_package = true,
  website_sort_order = 2,
  website_highlighted = false,
  updated_at = now()
WHERE id = 'b939a283-14ad-4a04-aa47-6158ab7fb14f'
  AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

UPDATE public.booking_activities SET
  activity_name = 'Ultimate Birthday Party',
  description = 'Ultimate Birthday Party — up to 30 kids and 30 adults · 90 minutes in the private party room (on your booked schedule) · Unlimited play in the facility until we close · Included party food bundle — choose 1 of 3 options when booking.',
  website_food_credit = NULL,
  website_package_inclusions = '["Ultimate Birthday Party — up to 30 kids and 30 adults included", "90 minutes in the private party room (on your booked schedule)", "Unlimited play in the facility until we close", "Included party food bundle — choose 1 of 3 options when booking"]'::jsonb,
  website_show_party_package = true,
  website_sort_order = 3,
  website_highlighted = false,
  updated_at = now()
WHERE id = '7815d4a7-6938-4cf8-a7ca-5bb51cc3d308'
  AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
