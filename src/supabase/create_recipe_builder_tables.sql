-- Create Recipe Builder specific tables following the optimized build plan
-- These are the minimal new tables needed for Recipe Builder functionality

-- Create rb_suppliers table (supplier specific data)
CREATE TABLE IF NOT EXISTS rb_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  supplier_code VARCHAR(100),
  website_url TEXT,
  scraping_enabled BOOLEAN DEFAULT false,
  scraping_config JSONB,
  delivery_days TEXT[],
  minimum_order DECIMAL(10,2),
  delivery_fee DECIMAL(10,2),
  payment_terms TEXT,
  kickback_percentage DECIMAL(5,2) DEFAULT 0,
  preferred_supplier BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create rb_supplier_prices table (pricing data)
CREATE TABLE IF NOT EXISTS rb_supplier_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES rb_suppliers(id) ON DELETE CASCADE,
  inventory_id UUID REFERENCES inventory(id) ON DELETE CASCADE,
  price_per_unit DECIMAL(10,4) NOT NULL,
  unit_of_measure VARCHAR(50) NOT NULL,
  pack_size DECIMAL(8,2),
  pack_size_unit VARCHAR(50),
  sku VARCHAR(100),
  product_url TEXT,
  scrape_error TEXT,
  scraped_product_name TEXT,
  promo_price DECIMAL(10,4),
  promo_start_date DATE,
  promo_end_date DATE,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  scraped_at TIMESTAMP WITH TIME ZONE,
  is_current BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create rb_inventory_levels table (stock tracking)
CREATE TABLE IF NOT EXISTS rb_inventory_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID REFERENCES inventory(id) ON DELETE CASCADE,
  location_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  current_quantity DECIMAL(10,4) DEFAULT 0,
  unit_of_measure VARCHAR(50) NOT NULL,
  minimum_level DECIMAL(10,4) DEFAULT 0,
  maximum_level DECIMAL(10,4),
  reorder_point DECIMAL(10,4),
  last_counted_at TIMESTAMP WITH TIME ZONE,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create rb_order_guides table (purchasing)
CREATE TABLE IF NOT EXISTS rb_order_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  supplier_id UUID REFERENCES rb_suppliers(id) ON DELETE CASCADE,
  location_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  order_date DATE NOT NULL,
  delivery_date DATE,
  status VARCHAR(50) DEFAULT 'draft',
  total_amount DECIMAL(10,2) DEFAULT 0,
  items_count INTEGER DEFAULT 0,
  generated_by VARCHAR(50),
  forecast_data JSONB,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create rb_order_guide_items table (order line items)
CREATE TABLE IF NOT EXISTS rb_order_guide_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_guide_id UUID REFERENCES rb_order_guides(id) ON DELETE CASCADE,
  inventory_id UUID REFERENCES inventory(id) ON DELETE CASCADE,
  suggested_quantity DECIMAL(10,4) NOT NULL,
  actual_quantity DECIMAL(10,4),
  unit_of_measure VARCHAR(50) NOT NULL,
  price_per_unit DECIMAL(10,4) NOT NULL,
  total_cost DECIMAL(10,2) NOT NULL,
  reason TEXT,
  priority VARCHAR(20) DEFAULT 'normal',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create rb_shrinkage_logs table (waste tracking)
CREATE TABLE IF NOT EXISTS rb_shrinkage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID REFERENCES inventory(id) ON DELETE CASCADE,
  location_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  shrinkage_type VARCHAR(50) NOT NULL,
  quantity DECIMAL(10,4) NOT NULL,
  unit_of_measure VARCHAR(50) NOT NULL,
  cost_impact DECIMAL(10,2) NOT NULL,
  reason TEXT,
  reported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_via VARCHAR(20) DEFAULT 'manual',
  logged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create rb_margin_tiers table (margin rules)
CREATE TABLE IF NOT EXISTS rb_margin_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  requires_heating BOOLEAN DEFAULT false,
  requires_cooling BOOLEAN DEFAULT false,
  labor_intensive BOOLEAN DEFAULT false,
  target_margin_percent DECIMAL(5,2) NOT NULL,
  applies_to VARCHAR(20) DEFAULT 'recipe',
  category_id UUID REFERENCES pos_categories(id) ON DELETE SET NULL,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_rb_supplier_prices_current ON rb_supplier_prices(inventory_id, supplier_id) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_rb_inventory_levels_location ON rb_inventory_levels(location_id, inventory_id);
CREATE INDEX IF NOT EXISTS idx_rb_order_guides_supplier ON rb_order_guides(supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_rb_shrinkage_logs_inventory ON rb_shrinkage_logs(inventory_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_rb_margin_tiers_category ON rb_margin_tiers(category_id, business_id);

-- Enable RLS on all tables
ALTER TABLE rb_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rb_supplier_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE rb_inventory_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE rb_order_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE rb_order_guide_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rb_shrinkage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rb_margin_tiers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for business isolation
CREATE POLICY "rb_suppliers_business_isolation" ON rb_suppliers
  FOR ALL USING (business_id = (SELECT business_id FROM business_users WHERE user_id = auth.uid()));

CREATE POLICY "rb_supplier_prices_business_isolation" ON rb_supplier_prices
  FOR ALL USING (supplier_id IN (SELECT id FROM rb_suppliers WHERE business_id = (SELECT business_id FROM business_users WHERE user_id = auth.uid())));

CREATE POLICY "rb_inventory_levels_business_isolation" ON rb_inventory_levels
  FOR ALL USING (location_id = (SELECT business_id FROM business_users WHERE user_id = auth.uid()));

CREATE POLICY "rb_order_guides_business_isolation" ON rb_order_guides
  FOR ALL USING (location_id = (SELECT business_id FROM business_users WHERE user_id = auth.uid()));

CREATE POLICY "rb_order_guide_items_business_isolation" ON rb_order_guide_items
  FOR ALL USING (order_guide_id IN (SELECT id FROM rb_order_guides WHERE location_id = (SELECT business_id FROM business_users WHERE user_id = auth.uid())));

CREATE POLICY "rb_shrinkage_logs_business_isolation" ON rb_shrinkage_logs
  FOR ALL USING (location_id = (SELECT business_id FROM business_users WHERE user_id = auth.uid()));

CREATE POLICY "rb_margin_tiers_business_isolation" ON rb_margin_tiers
  FOR ALL USING (business_id = (SELECT business_id FROM business_users WHERE user_id = auth.uid()));

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_rb_suppliers_updated_at BEFORE UPDATE ON rb_suppliers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rb_order_guides_updated_at BEFORE UPDATE ON rb_order_guides
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rb_margin_tiers_updated_at BEFORE UPDATE ON rb_margin_tiers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

