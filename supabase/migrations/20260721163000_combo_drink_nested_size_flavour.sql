-- Align combo drinks with standalone POS: parent drink → Size (required) → Flavour (optional)

UPDATE public.pos_inventory
SET modifier_group_ids = '["dc8a82fe-b115-4140-ac63-30e26854dd0e","fb292851-5bfe-4836-93fb-73af522f8d90"]'::jsonb
WHERE id = '376d6b6f-9672-4b22-a08a-9f57ea2bbbac';

UPDATE public.pos_modifier_groups
SET
  show_when_inventory_id = '376d6b6f-9672-4b22-a08a-9f57ea2bbbac',
  name = 'Fountain Pop Size',
  is_required = true,
  min_selections = 1
WHERE id = 'dc8a82fe-b115-4140-ac63-30e26854dd0e';

UPDATE public.pos_modifier_groups
SET
  show_when_inventory_id = '376d6b6f-9672-4b22-a08a-9f57ea2bbbac',
  name = 'Fountain Pop Flavour',
  is_required = false,
  min_selections = 0
WHERE id = 'fb292851-5bfe-4836-93fb-73af522f8d90';

UPDATE public.pos_modifier_groups
SET name = 'Slush Size', is_required = true, min_selections = 1
WHERE id = '7c597d4e-555b-408c-b7af-bbdfe66ed248';

UPDATE public.pos_modifier_groups
SET is_required = false, min_selections = 0
WHERE id = '07a55285-32e2-470f-ae7c-d9e238a5ac45';

DELETE FROM public.pos_modifier_group_items
WHERE modifier_group_id = '8164feca-9461-4711-b34e-7c9e25b6be42'
  AND inventory_id IN (
    '283280bf-fc6c-441f-90e8-40e48e6e9da7',
    '186eabf5-55d3-47d8-996c-b8a7f950a9c6',
    '7bd452d9-a62a-4265-ab34-1df3603fe9be'
  );

INSERT INTO public.pos_modifier_group_items (
  modifier_group_id,
  inventory_id,
  is_active,
  sort_order,
  is_free,
  price_override
)
SELECT
  '8164feca-9461-4711-b34e-7c9e25b6be42',
  '376d6b6f-9672-4b22-a08a-9f57ea2bbbac',
  true,
  10,
  false,
  null
WHERE NOT EXISTS (
  SELECT 1
  FROM public.pos_modifier_group_items
  WHERE modifier_group_id = '8164feca-9461-4711-b34e-7c9e25b6be42'
    AND inventory_id = '376d6b6f-9672-4b22-a08a-9f57ea2bbbac'
);
