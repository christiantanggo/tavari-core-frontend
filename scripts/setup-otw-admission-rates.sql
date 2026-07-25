UPDATE pos_inventory SET
  expose_to_website_api = true,
  website_show_admission_pricing = true,
  website_online_price = CASE id
    WHEN '58eefcbc-784c-4f27-ac57-4d178689f4c0' THEN 8.40
    WHEN '89cbb714-1f73-4e5f-b0ea-894242fc71f4' THEN 12.39
    WHEN 'dbf00a0d-01fe-4d42-959f-549c4f640da2' THEN 4.42
    ELSE website_online_price
  END,
  description = CASE id
    WHEN '58eefcbc-784c-4f27-ac57-4d178689f4c0' THEN 'One adult per child is free.'
    WHEN '89cbb714-1f73-4e5f-b0ea-894242fc71f4' THEN 'One adult per child is free.'
    WHEN 'dbf00a0d-01fe-4d42-959f-549c4f640da2' THEN 'For adults beyond the free adult included with each child.'
    ELSE description
  END,
  sort_order = CASE id
    WHEN '58eefcbc-784c-4f27-ac57-4d178689f4c0' THEN 1
    WHEN '89cbb714-1f73-4e5f-b0ea-894242fc71f4' THEN 2
    WHEN 'dbf00a0d-01fe-4d42-959f-549c4f640da2' THEN 3
    ELSE sort_order
  END
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
  AND id IN (
    '58eefcbc-784c-4f27-ac57-4d178689f4c0',
    '89cbb714-1f73-4e5f-b0ea-894242fc71f4',
    'dbf00a0d-01fe-4d42-959f-549c4f640da2'
  );
