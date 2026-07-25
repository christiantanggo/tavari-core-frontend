-- Add free_with_purchase to pos_inventory for "X free with purchase of X" (e.g. 1 adult free per child ticket)
-- Run in Supabase SQL Editor if pos_inventory does not already have this column.

ALTER TABLE pos_inventory
  ADD COLUMN IF NOT EXISTS free_with_purchase jsonb DEFAULT NULL;

COMMENT ON COLUMN pos_inventory.free_with_purchase IS 'Optional promo: { quantity: number (how many free per qualifying purchase), free_item_id: uuid, trigger_item_ids: uuid[] }. E.g. 1 adult ticket free per child ticket.';
