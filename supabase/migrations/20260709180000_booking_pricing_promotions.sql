-- Configurable booking pricing promotions (time slots, visit windows, purchase windows, promo codes).

CREATE TABLE IF NOT EXISTS public.booking_pricing_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  internal_notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  promo_code TEXT,
  channel TEXT NOT NULL DEFAULT 'both'
    CHECK (channel IN ('online', 'in_person', 'both')),
  activity_scope JSONB NOT NULL DEFAULT '{"mode":"all"}'::jsonb,
  purchase_starts_at TIMESTAMPTZ,
  purchase_ends_at TIMESTAMPTZ,
  visit_start_date DATE,
  visit_end_date DATE,
  visit_days_of_week INTEGER[],
  visit_start_time TIME,
  visit_end_time TIME,
  visit_times TEXT[],
  visit_blackout_dates DATE[],
  price_adjustments JSONB NOT NULL DEFAULT '{"mode":"override_prices","items":[]}'::jsonb,
  min_tickets INTEGER,
  max_total_redemptions INTEGER,
  max_redemptions_per_customer INTEGER,
  apply_conditional_free_rules BOOLEAN NOT NULL DEFAULT true,
  uses_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT booking_pricing_promotions_purchase_window CHECK (
    purchase_starts_at IS NULL
    OR purchase_ends_at IS NULL
    OR purchase_ends_at >= purchase_starts_at
  ),
  CONSTRAINT booking_pricing_promotions_visit_window CHECK (
    visit_start_date IS NULL
    OR visit_end_date IS NULL
    OR visit_end_date >= visit_start_date
  )
);

CREATE INDEX IF NOT EXISTS idx_booking_pricing_promotions_business_active
  ON public.booking_pricing_promotions (business_id, is_active, priority DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_booking_pricing_promotions_business_code
  ON public.booking_pricing_promotions (business_id, lower(trim(promo_code)))
  WHERE promo_code IS NOT NULL AND trim(promo_code) <> '';

CREATE TABLE IF NOT EXISTS public.booking_pricing_promotion_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES public.booking_pricing_promotions(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  pending_id UUID,
  promo_code_used TEXT,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_pricing_promotion_redemptions_promotion
  ON public.booking_pricing_promotion_redemptions (promotion_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_pricing_promotion_redemptions_customer
  ON public.booking_pricing_promotion_redemptions (promotion_id, customer_id)
  WHERE customer_id IS NOT NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pricing_promotion_id UUID REFERENCES public.booking_pricing_promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promo_code_used TEXT;

ALTER TABLE public.booking_pending_helcim
  ADD COLUMN IF NOT EXISTS pricing_promotion_id UUID REFERENCES public.booking_pricing_promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promo_code TEXT;

COMMENT ON TABLE public.booking_pricing_promotions IS
  'Configurable booking admission/package pricing overrides by visit date, time slot, purchase window, activity, and optional promo code.';
COMMENT ON COLUMN public.booking_pricing_promotions.activity_scope IS
  'JSON: { mode: all|categories|activities, category_keys: string[], activity_ids: uuid[] }';
COMMENT ON COLUMN public.booking_pricing_promotions.price_adjustments IS
  'JSON: { mode: override_prices|percent_off|fixed_off|flat_package_price, items: [{inventory_item_id, price|percent|amount}], flat_price?: number }';

ALTER TABLE public.booking_pricing_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_pricing_promotions_select_business ON public.booking_pricing_promotions;
CREATE POLICY booking_pricing_promotions_select_business
  ON public.booking_pricing_promotions FOR SELECT
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_pricing_promotions.business_id
        AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS booking_pricing_promotions_insert_managers ON public.booking_pricing_promotions;
CREATE POLICY booking_pricing_promotions_insert_managers
  ON public.booking_pricing_promotions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_pricing_promotions.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('manager', 'owner')
    )
  );

DROP POLICY IF EXISTS booking_pricing_promotions_update_managers ON public.booking_pricing_promotions;
CREATE POLICY booking_pricing_promotions_update_managers
  ON public.booking_pricing_promotions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_pricing_promotions.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('manager', 'owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_pricing_promotions.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('manager', 'owner')
    )
  );

DROP POLICY IF EXISTS booking_pricing_promotions_delete_managers ON public.booking_pricing_promotions;
CREATE POLICY booking_pricing_promotions_delete_managers
  ON public.booking_pricing_promotions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_pricing_promotions.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('manager', 'owner')
    )
  );

ALTER TABLE public.booking_pricing_promotion_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_pricing_promotion_redemptions_select_business ON public.booking_pricing_promotion_redemptions;
CREATE POLICY booking_pricing_promotion_redemptions_select_business
  ON public.booking_pricing_promotion_redemptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_pricing_promotion_redemptions.business_id
        AND bu.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.update_booking_pricing_promotions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_booking_pricing_promotions_updated_at ON public.booking_pricing_promotions;
CREATE TRIGGER trigger_update_booking_pricing_promotions_updated_at
  BEFORE UPDATE ON public.booking_pricing_promotions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_booking_pricing_promotions_updated_at();

CREATE OR REPLACE FUNCTION public.increment_booking_pricing_promotion_uses(p_promotion_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.booking_pricing_promotions
  SET uses_count = uses_count + 1
  WHERE id = p_promotion_id;
END;
$$;
