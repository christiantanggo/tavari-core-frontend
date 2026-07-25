-- Run in Supabase SQL Editor if migration has not been applied yet.

ALTER TABLE pos_inventory
  ADD COLUMN IF NOT EXISTS expose_to_website_api BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN pos_inventory.expose_to_website_api IS
  'When true, item name/description/price/image may be returned by tavari-api-business-products for external websites. Stock is not exposed; tracked items with zero quantity are unavailable.';

CREATE INDEX IF NOT EXISTS idx_pos_inventory_website_api
  ON pos_inventory (business_id, expose_to_website_api)
  WHERE expose_to_website_api = true;
