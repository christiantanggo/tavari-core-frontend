-- Fix Recipe Builder RLS when a user belongs to multiple businesses (Postgres 21000)

DROP POLICY IF EXISTS "rb_suppliers_business_isolation" ON rb_suppliers;
CREATE POLICY "rb_suppliers_business_isolation" ON rb_suppliers
  FOR ALL
  USING (
    business_id IN (
      SELECT business_id FROM business_users WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM business_users WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "rb_supplier_prices_business_isolation" ON rb_supplier_prices;
CREATE POLICY "rb_supplier_prices_business_isolation" ON rb_supplier_prices
  FOR ALL
  USING (
    supplier_id IN (
      SELECT s.id
      FROM rb_suppliers s
      WHERE s.business_id IN (
        SELECT business_id FROM business_users WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    supplier_id IN (
      SELECT s.id
      FROM rb_suppliers s
      WHERE s.business_id IN (
        SELECT business_id FROM business_users WHERE user_id = auth.uid()
      )
    )
  );

-- One current price row per supplier + ingredient
CREATE UNIQUE INDEX IF NOT EXISTS idx_rb_supplier_prices_ingredient_supplier_current
  ON rb_supplier_prices (supplier_id, ingredient_id)
  WHERE is_current = true AND ingredient_id IS NOT NULL;
