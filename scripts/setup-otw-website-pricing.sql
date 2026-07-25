-- Expose OTWK website pricing SKUs (parties + grip socks). Admission tiers configured separately.

UPDATE pos_inventory SET
  expose_to_website_api = true,
  name = 'Party for Up to 12 Kids',
  description = '90 minutes in the private party room (on your booked schedule) · Unlimited play in the facility until we close · 12 free adults · $50 food credit applied at end of party.',
  sort_order = 1
WHERE id = 'c149c8ec-d4c1-4796-8901-635205244eae'
  AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

UPDATE pos_inventory SET
  expose_to_website_api = true,
  name = 'Party for Up to 24 Kids',
  description = '90 minutes in the private party room (on your booked schedule) · Unlimited play in the facility until we close · 24 free adults · $100 food credit applied at end of party.',
  sort_order = 2
WHERE id = '5a3927c9-12cb-4b04-a386-a1bf2c87c4ce'
  AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

UPDATE pos_inventory SET
  expose_to_website_api = true,
  name = 'Party for Up to 36 Kids',
  description = '90 minutes in the private party room (on your booked schedule) · Unlimited play in the facility until we close · 36 free adults · $150 food credit applied at end of party.',
  sort_order = 3
WHERE id = '8bc28455-29b3-4500-a2ab-74dd5fc3876c'
  AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

UPDATE pos_inventory SET
  expose_to_website_api = true,
  name = 'Private Facility Rental',
  description = '2-hour party · Up to 150 people (75 kids & 75 adults) · $150 food credit · No other guests in the facility.',
  sort_order = 4
WHERE id = 'e72ebc1c-679f-4ac2-ad21-6254b9d3bef8'
  AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

UPDATE pos_inventory SET
  expose_to_website_api = true,
  name = 'OTWK Grip Socks',
  description = 'Branded grip socks — always in stock at the admission counter.',
  sort_order = 10
WHERE id = '082e07ec-1401-43c8-8217-b9afde287c07'
  AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
