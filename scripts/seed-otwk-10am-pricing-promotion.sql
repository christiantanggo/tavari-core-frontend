INSERT INTO booking_pricing_promotions (
  business_id,
  name,
  description,
  is_active,
  priority,
  channel,
  activity_scope,
  visit_times,
  price_adjustments,
  apply_conditional_free_rules
)
SELECT
  'cb982fca-cf7a-4f59-b9c7-55ca0364eddc',
  '$10 at 10am',
  'Online admission is $10 for the 10:00 AM time slot.',
  true,
  100,
  'online',
  '{"mode":"all","category_keys":[],"activity_ids":[]}'::jsonb,
  ARRAY['10:00:00']::text[],
  '{"mode":"override_prices","items":[{"inventory_item_id":"89cbb714-1f73-4e5f-b0ea-894242fc71f4","price":10},{"inventory_item_id":"58eefcbc-784c-4f27-ac57-4d178689f4c0","price":10}]}'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM booking_pricing_promotions
  WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
    AND name = '$10 at 10am'
);

SELECT id, name, is_active
FROM booking_pricing_promotions
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
ORDER BY created_at DESC
LIMIT 5;
