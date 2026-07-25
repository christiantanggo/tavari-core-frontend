SELECT id, name, price, website_online_price
FROM pos_inventory
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
  AND (
    name ILIKE '%2-17%'
    OR name ILIKE '%additional%adult%'
    OR name ILIKE '%adult%'
  )
ORDER BY name;
