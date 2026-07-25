-- ============================================
-- BOOKING ACTIVITIES – TICKET QUANTITY LIMITS
-- ============================================
-- Adds support for minimum and maximum ticket quantity limits
-- in the ticket_settings JSONB column of booking_activities table.
--
-- These settings are enforced for online bookings only.
--
-- Structure added to ticket_settings JSONB:
-- {
--   "inventory_item_ids": [...],
--   "min_tickets": <integer|null>,  -- Minimum number of tickets required per booking
--   "max_tickets": <integer|null>,  -- Maximum number of tickets allowed per booking
--   "enforce_online_only": true     -- Flag indicating these limits apply to online bookings only
-- }
-- ============================================

-- No schema changes needed - ticket_settings is already a JSONB column
-- This migration serves as documentation of the new structure

-- Add comment to ticket_settings column documenting the new fields
COMMENT ON COLUMN booking_activities.ticket_settings IS 
  'JSONB object containing ticket configuration. Structure: {
    "inventory_item_ids": array of UUIDs referencing pos_inventory items,
    "min_tickets": integer|null - minimum tickets required per booking (online only),
    "max_tickets": integer|null - maximum tickets allowed per booking (online only),
    "enforce_online_only": boolean - true if limits apply to online bookings only
  }';

-- ============================================
-- NOTES
-- ============================================
-- - min_tickets and max_tickets are optional (can be null)
-- - When set, these limits are enforced during online booking flow
-- - Limits do not apply to in-person/POS bookings
-- - If min_tickets is set, customers must select at least that many tickets
-- - If max_tickets is set, customers cannot select more than that many tickets
-- - Both limits can be set simultaneously
-- ============================================
