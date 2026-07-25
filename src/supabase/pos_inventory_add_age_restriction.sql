-- Add age_restriction to pos_inventory for tickets/items with age ranges (e.g. 0–23 months, 2–17 years)
-- Run in Supabase SQL Editor if pos_inventory does not already have this column.

ALTER TABLE pos_inventory
  ADD COLUMN IF NOT EXISTS age_restriction jsonb DEFAULT NULL;

COMMENT ON COLUMN pos_inventory.age_restriction IS 'Optional age range: { min_unit: "months"|"years", min_value: number, max_unit: "months"|"years", max_value: number }. Used for tickets (e.g. child 0–23 months, youth 2–17 years).';
