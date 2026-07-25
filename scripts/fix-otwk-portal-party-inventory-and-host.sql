-- OTWK London: portal party tiers get their own POS inventory SKUs (10/20/30 kids).
-- Legacy staff activities keep Party for Up to 12/24/36 Kids items unchanged.
-- Also backfills July 10 Classic party booking host link (Christian Fournier).

DO $$
DECLARE
  v_business uuid := 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
  v_classic_inv uuid;
  v_super_inv uuid;
  v_ultimate_inv uuid;
  v_classic_activity uuid := 'd4f2f7a0-d20e-4045-90dd-09a94765a4fa';
  v_super_activity uuid := 'b939a283-14ad-4a04-aa47-6158ab7fb14f';
  v_ultimate_activity uuid := '7815d4a7-6938-4cf8-a7ca-5bb51cc3d308';
  v_july10_booking uuid := '22aa3df1-171a-4c75-b222-23ec4c6d7ebf';
  v_owner_bcp uuid := '2d0421b3-65bf-4dfb-b0dd-cfd7b98c5119';
BEGIN
  INSERT INTO public.pos_inventory (
    business_id,
    category_id,
    name,
    sku,
    price,
    cost,
    sort_order,
    category_sort_order,
    description,
    display_on_pos,
    expose_to_website_api,
    website_show_party_package,
    is_modifier_item,
    is_bundle,
    bundle_use_auto_price,
    show_on_rewards_tab,
    website_show_admission_pricing,
    min_quantity_per_sale,
    is_active,
    track_stock,
    tax_category_ids,
    station_ids
  )
  SELECT
    business_id,
    category_id,
    'Classic Birthday Party',
    'PORTAL-CLASSIC-10',
    price,
    cost,
    sort_order,
    category_sort_order,
    'Classic Birthday Party — up to 10 kids and 10 adults · 90 minutes in the private party room · Unlimited play until close · Choose 1 of 3 included food bundles.',
    display_on_pos,
    false,
    false,
    is_modifier_item,
    is_bundle,
    bundle_use_auto_price,
    show_on_rewards_tab,
    website_show_admission_pricing,
    min_quantity_per_sale,
    is_active,
    track_stock,
    tax_category_ids,
    station_ids
  FROM public.pos_inventory
  WHERE id = 'c149c8ec-d4c1-4796-8901-635205244eae'
  RETURNING id INTO v_classic_inv;

  INSERT INTO public.pos_inventory (
    business_id,
    category_id,
    name,
    sku,
    price,
    cost,
    sort_order,
    category_sort_order,
    description,
    display_on_pos,
    expose_to_website_api,
    website_show_party_package,
    is_modifier_item,
    is_bundle,
    bundle_use_auto_price,
    show_on_rewards_tab,
    website_show_admission_pricing,
    min_quantity_per_sale,
    is_active,
    track_stock,
    tax_category_ids,
    station_ids
  )
  SELECT
    business_id,
    category_id,
    'Super Birthday Party',
    'PORTAL-SUPER-20',
    price,
    cost,
    sort_order,
    category_sort_order,
    'Super Birthday Party — up to 20 kids and 20 adults · 90 minutes in the private party room · Unlimited play until close · Choose 2 of 3 included food bundles.',
    display_on_pos,
    false,
    false,
    is_modifier_item,
    is_bundle,
    bundle_use_auto_price,
    show_on_rewards_tab,
    website_show_admission_pricing,
    min_quantity_per_sale,
    is_active,
    track_stock,
    tax_category_ids,
    station_ids
  FROM public.pos_inventory
  WHERE id = '5a3927c9-12cb-4b04-a386-a1bf2c87c4ce'
  RETURNING id INTO v_super_inv;

  INSERT INTO public.pos_inventory (
    business_id,
    category_id,
    name,
    sku,
    price,
    cost,
    sort_order,
    category_sort_order,
    description,
    display_on_pos,
    expose_to_website_api,
    website_show_party_package,
    is_modifier_item,
    is_bundle,
    bundle_use_auto_price,
    show_on_rewards_tab,
    website_show_admission_pricing,
    min_quantity_per_sale,
    is_active,
    track_stock,
    tax_category_ids,
    station_ids
  )
  SELECT
    business_id,
    category_id,
    'Ultimate Birthday Party',
    'PORTAL-ULTIMATE-30',
    price,
    cost,
    sort_order,
    category_sort_order,
    'Ultimate Birthday Party — up to 30 kids and 30 adults · 90 minutes in the private party room · Unlimited play until close · All 3 included food bundles.',
    display_on_pos,
    false,
    false,
    is_modifier_item,
    is_bundle,
    bundle_use_auto_price,
    show_on_rewards_tab,
    website_show_admission_pricing,
    min_quantity_per_sale,
    is_active,
    track_stock,
    tax_category_ids,
    station_ids
  FROM public.pos_inventory
  WHERE id = '8bc28455-29b3-4500-a2ab-74dd5fc3876c'
  RETURNING id INTO v_ultimate_inv;

  UPDATE public.booking_activities
  SET ticket_settings = jsonb_set(
    jsonb_set(
      jsonb_set(
        ticket_settings,
        '{inventory_item_ids}',
        jsonb_build_array(to_jsonb(v_classic_inv::text))
      ),
      '{assignment_rules,0,inventory_item_id}',
      to_jsonb(v_classic_inv::text)
    ),
    '{pricing_rules,0,inventory_item_id}',
    to_jsonb(v_classic_inv::text)
  ),
  updated_at = now()
  WHERE id = v_classic_activity AND business_id = v_business;

  UPDATE public.booking_activities
  SET ticket_settings = jsonb_set(
    jsonb_set(
      jsonb_set(
        ticket_settings,
        '{inventory_item_ids}',
        jsonb_build_array(to_jsonb(v_super_inv::text))
      ),
      '{assignment_rules,0,inventory_item_id}',
      to_jsonb(v_super_inv::text)
    ),
    '{pricing_rules,0,inventory_item_id}',
    to_jsonb(v_super_inv::text)
  ),
  updated_at = now()
  WHERE id = v_super_activity AND business_id = v_business;

  UPDATE public.booking_activities
  SET ticket_settings = jsonb_set(
    jsonb_set(
      jsonb_set(
        ticket_settings,
        '{inventory_item_ids}',
        jsonb_build_array(to_jsonb(v_ultimate_inv::text))
      ),
      '{assignment_rules,0,inventory_item_id}',
      to_jsonb(v_ultimate_inv::text)
    ),
    '{pricing_rules,0,inventory_item_id}',
    to_jsonb(v_ultimate_inv::text)
  ),
  updated_at = now()
  WHERE id = v_ultimate_activity AND business_id = v_business;

  UPDATE public.booking_participants
  SET
    participant_id = v_owner_bcp,
    inventory_item_id = v_classic_inv
  WHERE booking_id = v_july10_booking
    AND party_role = 'host_adult';

  RAISE NOTICE 'Portal party inventory: classic=%, super=%, ultimate=%', v_classic_inv, v_super_inv, v_ultimate_inv;
END $$;
