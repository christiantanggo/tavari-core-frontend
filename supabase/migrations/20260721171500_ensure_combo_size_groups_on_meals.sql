-- Ensure every Combo Drink meal includes Fountain Pop Size + Slush Size
-- (Flavour alone was attached before, so POS unlocked Flavour and skipped Size).

DO $$
DECLARE
  combo_drink uuid := '8164feca-9461-4711-b34e-7c9e25b6be42';
  fountain_size uuid := 'dc8a82fe-b115-4140-ac63-30e26854dd0e';
  fountain_flavour uuid := 'fb292851-5bfe-4836-93fb-73af522f8d90';
  slush_size uuid := '7c597d4e-555b-408c-b7af-bbdfe66ed248';
  slush_flavour uuid := '07a55285-32e2-470f-ae7c-d9e238a5ac45';
  pepsi_flavour_med uuid := '6de94297-d319-4bae-bb4c-2a62eec7f8bb';
  pepsi_flavour_lg uuid := '51a2dd64-0d66-4361-bcc2-7eedbe24004a';
  r record;
  cleaned uuid[];
BEGIN
  FOR r IN
    SELECT id, modifier_group_ids
    FROM public.pos_inventory
    WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
      AND modifier_group_ids IS NOT NULL
      AND modifier_group_ids::text LIKE '%' || combo_drink::text || '%'
  LOOP
    cleaned := ARRAY(
      SELECT elem::uuid
      FROM jsonb_array_elements_text(COALESCE(r.modifier_group_ids, '[]'::jsonb)) AS elem
      WHERE elem::uuid IS DISTINCT FROM pepsi_flavour_med
        AND elem::uuid IS DISTINCT FROM pepsi_flavour_lg
    );

    IF NOT (fountain_size = ANY (cleaned)) THEN
      cleaned := cleaned || fountain_size;
    END IF;
    IF NOT (fountain_flavour = ANY (cleaned)) THEN
      cleaned := cleaned || fountain_flavour;
    END IF;
    IF NOT (slush_size = ANY (cleaned)) THEN
      cleaned := cleaned || slush_size;
    END IF;
    IF NOT (slush_flavour = ANY (cleaned)) THEN
      cleaned := cleaned || slush_flavour;
    END IF;

    UPDATE public.pos_inventory
    SET modifier_group_ids = to_jsonb(cleaned)
    WHERE id = r.id;
  END LOOP;
END $$;

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
SET
  show_when_inventory_id = 'c699876c-bc09-4bf8-bccb-e99976244918',
  name = 'Slush Size',
  is_required = true,
  min_selections = 1
WHERE id = '7c597d4e-555b-408c-b7af-bbdfe66ed248';

UPDATE public.pos_modifier_groups
SET
  show_when_inventory_id = 'c699876c-bc09-4bf8-bccb-e99976244918',
  name = 'Slushie Flavour',
  is_required = false,
  min_selections = 0
WHERE id = '07a55285-32e2-470f-ae7c-d9e238a5ac45';
