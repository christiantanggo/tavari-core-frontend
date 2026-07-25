-- Minimal booking catalog + portal customer for payment-flow E2E (Playwright).
-- Target business: Test Business (adjust BUSINESS_ID if you clone this elsewhere).
--
-- Run against linked Supabase (example):
--   npx supabase db query --linked -f scripts/seed-booking-e2e-test-business.sql
--
-- Fixed IDs (referenced by scripts/e2e-booking-payment-clickthrough.mjs):
--   booking_types        11111111-1111-4111-8111-111111111101
--   booking_activities   11111111-1111-4111-8111-111111111102
--   pos_inventory        11111111-1111-4111-8111-111111111103
--   pos_loyalty_accounts 11111111-1111-4111-8111-111111111104
--   booking_customer_participants 11111111-1111-4111-8111-111111111105

BEGIN;

DO $seed$
DECLARE
  v_business uuid := 'dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7';
  v_type uuid := '11111111-1111-4111-8111-111111111101';
  v_activity uuid := '11111111-1111-4111-8111-111111111102';
  v_inv uuid := '11111111-1111-4111-8111-111111111103';
  v_customer uuid := '11111111-1111-4111-8111-111111111104';
  v_participant uuid := '11111111-1111-4111-8111-111111111105';
BEGIN
  DELETE FROM public.booking_activity_schedules WHERE activity_id = v_activity;
  DELETE FROM public.booking_activities WHERE id = v_activity;
  DELETE FROM public.booking_customer_participants WHERE id = v_participant;
  DELETE FROM public.pos_loyalty_accounts WHERE id = v_customer;
  DELETE FROM public.pos_inventory WHERE id = v_inv;
  DELETE FROM public.booking_types WHERE id = v_type;

  INSERT INTO public.booking_types (
    id, business_id, type_name, type_key, display_name,
    requires_waiver, requires_payment, is_active
  ) VALUES (
    v_type, v_business, 'E2E Category', 'e2e_category', 'E2E Category',
    false, true, true
  );

  INSERT INTO public.pos_inventory (
    id, business_id, name, sku, price, cost, is_active,
    track_stock, stock_quantity, display_on_pos
  ) VALUES (
    v_inv, v_business, 'E2E Admission', 'E2E-TICK', 10.00, 0, true,
    false, 0, false
  );

  INSERT INTO public.pos_loyalty_accounts (
    id, business_id, customer_name, customer_email, customer_phone,
    is_active, balance, points, total_earned, total_spent
  ) VALUES (
    v_customer,
    v_business,
    'Christian Fournier',
    'christian.dj.fournier@outlook.com',
    '5551234567',
    true,
    0,
    0,
    0,
    0
  );

  INSERT INTO public.booking_customer_participants (
    id, customer_id, business_id, first_name, last_name, date_of_birth,
    is_account_owner, is_active
  ) VALUES (
    v_participant, v_customer, v_business, 'Christian', 'Fournier', '1990-06-15',
    true, true
  );

  INSERT INTO public.booking_activities (
    id, business_id, type_id, activity_name, description,
    duration_minutes, max_capacity, requires_waiver,
    ticket_settings, is_active
  ) VALUES (
    v_activity,
    v_business,
    v_type,
    'E2E Test Activity',
    'Seeded for automated booking / payment click-through tests.',
    60,
    20,
    false,
    jsonb_build_object(
      'inventory_item_ids', jsonb_build_array(v_inv::text)
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
    '10:00:00',
    10,
    true,
    10
  FROM generate_series(0, 6) AS gs;

END $seed$;

COMMIT;
