-- ============================================================================
-- Music V2 Module - Seed Data
-- ============================================================================
-- Initial data: Plans and Pricing Matrix
-- ============================================================================

-- ============================================================================
-- PLANS
-- ============================================================================

INSERT INTO music_v2_plans (plan_key, name, description, allows_mainstream, allows_premium_content, base_devices_included, price_per_additional_device, is_active)
VALUES
  ('standard', 'Standard', 'Royalty-free music only. Perfect for businesses wanting quality background music without licensing concerns.', false, false, 1, 0, true),
  ('plus', 'Plus', 'Mix of royalty-free and mainstream licensed music. Great balance of variety and cost.', true, false, 1, 0, true),
  ('premium', 'Premium', 'Full premium experience with royalty-free, mainstream, and exclusive upscale content. Ideal for high-end venues.', true, true, 1, 0, true)
ON CONFLICT (plan_key) DO NOTHING;

-- ============================================================================
-- PRICING MATRIX
-- ============================================================================
-- Based on the pricing table provided:
-- Standard: 29.99 (0 ads), 9.99 (1/8), 0 (1/7), 10% (1/6), 20% (1/5), 30% (1/4), 40% (1/3)
-- Plus: 39.99 (0 ads), 19.99 (1/8), 9.99 (1/7), 0 (1/6), 10% (1/5), 20% (1/4), 30% (1/3)
-- Premium: 49.99 (0 ads), 29.99 (1/8), 19.99 (1/7), 9.99 (1/6), 0 (1/5), 10% (1/4), 20% (1/3)

DO $$
DECLARE
  standard_plan_id UUID;
  plus_plan_id UUID;
  premium_plan_id UUID;
BEGIN
  -- Get plan IDs
  SELECT id INTO standard_plan_id FROM music_v2_plans WHERE plan_key = 'standard';
  SELECT id INTO plus_plan_id FROM music_v2_plans WHERE plan_key = 'plus';
  SELECT id INTO premium_plan_id FROM music_v2_plans WHERE plan_key = 'premium';

  -- Standard Plan Pricing
  INSERT INTO music_v2_pricing_matrix (plan_id, ad_frequency, pricing_mode, pricing_value)
  VALUES
    (standard_plan_id, 'zero_ads', 'fixed_cost', 29.99),
    (standard_plan_id, 'one_per_8', 'fixed_cost', 9.99),
    (standard_plan_id, 'one_per_7', 'fixed_cost', 0),
    (standard_plan_id, 'one_per_6', 'revenue_share', 10),
    (standard_plan_id, 'one_per_5', 'revenue_share', 20),
    (standard_plan_id, 'one_per_4', 'revenue_share', 30),
    (standard_plan_id, 'one_per_3', 'revenue_share', 40)
  ON CONFLICT (plan_id, ad_frequency) DO NOTHING;

  -- Plus Plan Pricing
  INSERT INTO music_v2_pricing_matrix (plan_id, ad_frequency, pricing_mode, pricing_value)
  VALUES
    (plus_plan_id, 'zero_ads', 'fixed_cost', 39.99),
    (plus_plan_id, 'one_per_8', 'fixed_cost', 19.99),
    (plus_plan_id, 'one_per_7', 'fixed_cost', 9.99),
    (plus_plan_id, 'one_per_6', 'fixed_cost', 0),
    (plus_plan_id, 'one_per_5', 'revenue_share', 10),
    (plus_plan_id, 'one_per_4', 'revenue_share', 20),
    (plus_plan_id, 'one_per_3', 'revenue_share', 30)
  ON CONFLICT (plan_id, ad_frequency) DO NOTHING;

  -- Premium Plan Pricing
  INSERT INTO music_v2_pricing_matrix (plan_id, ad_frequency, pricing_mode, pricing_value)
  VALUES
    (premium_plan_id, 'zero_ads', 'fixed_cost', 49.99),
    (premium_plan_id, 'one_per_8', 'fixed_cost', 29.99),
    (premium_plan_id, 'one_per_7', 'fixed_cost', 19.99),
    (premium_plan_id, 'one_per_6', 'fixed_cost', 9.99),
    (premium_plan_id, 'one_per_5', 'fixed_cost', 0),
    (premium_plan_id, 'one_per_4', 'revenue_share', 10),
    (premium_plan_id, 'one_per_3', 'revenue_share', 20)
  ON CONFLICT (plan_id, ad_frequency) DO NOTHING;
END $$;

-- ============================================================================
-- FEATURE FLAG (Add to businesses table if not exists)
-- ============================================================================

DO $$
BEGIN
  -- Add music_v2_enabled column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' 
    AND column_name = 'music_v2_enabled'
  ) THEN
    ALTER TABLE businesses ADD COLUMN music_v2_enabled BOOLEAN DEFAULT false;
    COMMENT ON COLUMN businesses.music_v2_enabled IS 'Feature flag to enable new Music V2 system for this business';
  END IF;
END $$;


