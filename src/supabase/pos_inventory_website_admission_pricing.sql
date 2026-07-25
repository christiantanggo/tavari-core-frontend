-- Run in Supabase SQL Editor if migration has not been applied yet.

ALTER TABLE pos_inventory
  ADD COLUMN IF NOT EXISTS website_online_price NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS website_show_admission_pricing BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN pos_inventory.website_online_price IS
  'Optional lower online booking price for website API. At-gate price uses pos_inventory.price.';

COMMENT ON COLUMN pos_inventory.website_show_admission_pricing IS
  'When true with expose_to_website_api, item is listed via tavari-api-business-products?context=admission.';

CREATE INDEX IF NOT EXISTS idx_pos_inventory_admission_pricing
  ON pos_inventory (business_id, website_show_admission_pricing)
  WHERE expose_to_website_api = true AND website_show_admission_pricing = true;
