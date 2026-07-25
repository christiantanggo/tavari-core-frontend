-- Age-restriction E2E: infant participant + day-camp-style 4–5 ticket only.
-- Run: npx supabase db query --linked -f scripts/seed-booking-e2e-age-restriction.sql
--
-- IDs:
--   activity   11111111-1111-4111-8111-111111111106
--   inventory  11111111-1111-4111-8111-111111111107
--   participant (infant) 11111111-1111-4111-8111-111111111108

BEGIN;

DO $seed$
DECLARE
  v_business uuid := 'dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7';
  v_type uuid := '11111111-1111-4111-8111-111111111101';
  v_activity uuid := '11111111-1111-4111-8111-111111111106';
  v_inv uuid := '11111111-1111-4111-8111-111111111107';
  v_customer uuid := '11111111-1111-4111-8111-111111111104';
  v_infant uuid := '11111111-1111-4111-8111-111111111108';
BEGIN
  DELETE FROM public.booking_activity_schedules WHERE activity_id = v_activity;
  DELETE FROM public.booking_activities WHERE id = v_activity;
  DELETE FROM public.booking_customer_participants WHERE id = v_infant;
  DELETE FROM public.pos_inventory WHERE id = v_inv;

  INSERT INTO public.pos_inventory (
    id, business_id, name, sku, price, cost, is_active,
    track_stock, stock_quantity, display_on_pos, age_restriction
  ) VALUES (
    v_inv, v_business, 'E2E Day Camp 4-5', 'E2E-CAMP45', 50.00, 0, true,
    false, 0, false,
    jsonb_build_object(
      'min_value', 4,
      'max_value', 5,
      'min_unit', 'years',
      'max_unit', 'years'
    )
  );

  INSERT INTO public.booking_customer_participants (
    id, customer_id, business_id, first_name, last_name, date_of_birth,
    is_account_owner, is_active
  ) VALUES (
    v_infant, v_customer, v_business, 'E2E', 'Infant', '2025-08-01',
    false, true
  );

  INSERT INTO public.booking_activities (
    id, business_id, type_id, activity_name, description,
    duration_minutes, max_capacity, requires_waiver,
    ticket_settings, is_active
  ) VALUES (
    v_activity,
    v_business,
    v_type,
    'E2E Age Restricted Camp',
    'Seeded for age-restriction click-through tests.',
    60,
    20,
    false,
    jsonb_build_object(
      'inventory_item_ids', jsonb_build_array(v_inv::text),
      'online_min_tickets', 1,
      'online_max_tickets', 4
    ),
    true
  );

  INSERT INTO public.booking_activity_schedules (
    activity_id, business_id, day_of_week, start_time, spaces, is_active, nominal_max_spaces
  )
  SELECT
    v_activity,
    v_business,
    gs::integer,
    '10:00 AM',
    10,
    true,
    10
  FROM generate_series(0, 6) AS gs;

END $seed$;

COMMIT;
