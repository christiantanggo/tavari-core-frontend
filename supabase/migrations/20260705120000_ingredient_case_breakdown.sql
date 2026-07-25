-- Case breakdown fields for purchased ingredients (populated by supplier scrape or manual units per case)

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS case_price DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS units_per_case DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS case_size TEXT;

COMMENT ON COLUMN ingredients.case_price IS 'Shelf/case price from supplier scrape or manual entry';
COMMENT ON COLUMN ingredients.units_per_case IS 'How many recipe units are in one purchased case';
COMMENT ON COLUMN ingredients.case_size IS 'Pack/case size label from supplier (e.g. 30 count, 2 kg)';
