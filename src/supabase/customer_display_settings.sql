-- Create customer display settings table
CREATE TABLE IF NOT EXISTS customer_display_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ad_display_duration INTEGER DEFAULT 5000, -- milliseconds
  auto_rotate BOOLEAN DEFAULT true,
  show_promo_code BOOLEAN DEFAULT true,
  default_start_date DATE DEFAULT CURRENT_DATE,
  default_end_date DATE DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  UNIQUE(business_id)
);

-- Enable RLS
ALTER TABLE customer_display_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view settings for their business" ON customer_display_settings
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM business_users 
      WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY "Users can insert settings for their business" ON customer_display_settings
  FOR INSERT WITH CHECK (
    business_id IN (
      SELECT business_id FROM business_users 
      WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY "Users can update settings for their business" ON customer_display_settings
  FOR UPDATE USING (
    business_id IN (
      SELECT business_id FROM business_users 
      WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY "Users can delete settings for their business" ON customer_display_settings
  FOR DELETE USING (
    business_id IN (
      SELECT business_id FROM business_users 
      WHERE user_id = auth.uid() AND active = true
    )
  );
