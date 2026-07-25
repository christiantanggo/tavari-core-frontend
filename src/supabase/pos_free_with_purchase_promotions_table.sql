-- Free-with-purchase promotions (e.g. 1 adult free per child ticket).
-- Managed in Bookings > Settings > Pricing seasons and promo > Promotions.
-- References pos_inventory for free_item_id and trigger_item_ids.

CREATE TABLE IF NOT EXISTS pos_free_with_purchase_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  free_item_id UUID NOT NULL,
  trigger_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_free_item FOREIGN KEY (free_item_id) REFERENCES pos_inventory(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pos_fwp_promotions_business
  ON pos_free_with_purchase_promotions(business_id);

ALTER TABLE pos_free_with_purchase_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view FWP promotions for their business" ON pos_free_with_purchase_promotions;
DROP POLICY IF EXISTS "Managers and owners can create FWP promotions" ON pos_free_with_purchase_promotions;
DROP POLICY IF EXISTS "Managers and owners can update FWP promotions" ON pos_free_with_purchase_promotions;
DROP POLICY IF EXISTS "Managers and owners can delete FWP promotions" ON pos_free_with_purchase_promotions;

CREATE POLICY "Users can view FWP promotions for their business"
  ON pos_free_with_purchase_promotions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = pos_free_with_purchase_promotions.business_id
      AND bu.user_id = auth.uid()
    )
  );

-- Customer portal (anon or any user) can read promotions by business to auto-apply free-with-purchase
CREATE POLICY "Public can view FWP promotions for customer portal"
  ON pos_free_with_purchase_promotions FOR SELECT
  USING (true);

CREATE POLICY "Managers and owners can create FWP promotions"
  ON pos_free_with_purchase_promotions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = pos_free_with_purchase_promotions.business_id
      AND bu.user_id = auth.uid() AND bu.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers and owners can update FWP promotions"
  ON pos_free_with_purchase_promotions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = pos_free_with_purchase_promotions.business_id
      AND bu.user_id = auth.uid() AND bu.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = pos_free_with_purchase_promotions.business_id
      AND bu.user_id = auth.uid() AND bu.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Managers and owners can delete FWP promotions"
  ON pos_free_with_purchase_promotions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = pos_free_with_purchase_promotions.business_id
      AND bu.user_id = auth.uid() AND bu.role IN ('owner', 'manager')
    )
  );

COMMENT ON TABLE pos_free_with_purchase_promotions IS 'Promotions: X of free_item_id free per purchase of any trigger_item_ids. E.g. 1 adult ticket free per child ticket.';
