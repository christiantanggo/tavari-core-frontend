-- Recipe Manager: direct product URLs for supplier price refresh
ALTER TABLE rb_supplier_prices
  ADD COLUMN IF NOT EXISTS product_url TEXT,
  ADD COLUMN IF NOT EXISTS scrape_error TEXT,
  ADD COLUMN IF NOT EXISTS scraped_product_name TEXT;

COMMENT ON COLUMN rb_supplier_prices.product_url IS 'Direct supplier product page URL used for automated price refresh';
COMMENT ON COLUMN rb_supplier_prices.scrape_error IS 'Last price refresh error message, if any';
COMMENT ON COLUMN rb_supplier_prices.scraped_product_name IS 'Product title parsed from the supplier page on last refresh';

CREATE INDEX IF NOT EXISTS idx_rb_supplier_prices_product_url
  ON rb_supplier_prices (supplier_id)
  WHERE product_url IS NOT NULL AND is_current = true;
