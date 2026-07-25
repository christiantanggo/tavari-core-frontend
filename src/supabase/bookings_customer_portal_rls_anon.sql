-- ============================================
-- CUSTOMER PORTAL – ANON READ (RLS) FOR BOOKINGS
-- ============================================
-- Allows unauthenticated (anon) users to read the data required for the
-- customer-facing booking portal at /customer-portal/:businessId/portal
-- and /customer-portal/:businessId/portal/:activitySlug
--
-- Prerequisites:
--   - businesses: already has "Public can read business id and name for kiosk"
--     (anon SELECT). The portal also uses timezone, address, email, phone, website;
--     that policy allows full row read, so no change needed for businesses.
--
-- This migration adds anon SELECT only for:
--   - app_branding (logo, etc. by business_id)
--   - booking_types (categories on main portal)
--   - booking_activities (activities list + activity detail)
--   - booking_activity_sections (additional info on activity pages)
--   - booking_activity_schedules (available dates & time slots)
--
-- No INSERT/UPDATE/DELETE. Existing authenticated policies stay in place.
-- ============================================

-- --------------------------------------------
-- app_branding
-- --------------------------------------------
DROP POLICY IF EXISTS "anon_customer_portal_read_app_branding" ON app_branding;
CREATE POLICY "anon_customer_portal_read_app_branding"
  ON app_branding
  FOR SELECT
  TO anon
  USING (true);

-- --------------------------------------------
-- booking_types
-- --------------------------------------------
DROP POLICY IF EXISTS "anon_customer_portal_read_booking_types" ON booking_types;
CREATE POLICY "anon_customer_portal_read_booking_types"
  ON booking_types
  FOR SELECT
  TO anon
  USING (true);

-- --------------------------------------------
-- booking_activities
-- --------------------------------------------
DROP POLICY IF EXISTS "anon_customer_portal_read_booking_activities" ON booking_activities;
CREATE POLICY "anon_customer_portal_read_booking_activities"
  ON booking_activities
  FOR SELECT
  TO anon
  USING (true);

-- --------------------------------------------
-- booking_activity_sections
-- --------------------------------------------
DROP POLICY IF EXISTS "anon_customer_portal_read_booking_activity_sections" ON booking_activity_sections;
CREATE POLICY "anon_customer_portal_read_booking_activity_sections"
  ON booking_activity_sections
  FOR SELECT
  TO anon
  USING (true);

-- --------------------------------------------
-- booking_activity_schedules
-- --------------------------------------------
DROP POLICY IF EXISTS "anon_customer_portal_read_booking_activity_schedules" ON booking_activity_schedules;
CREATE POLICY "anon_customer_portal_read_booking_activity_schedules"
  ON booking_activity_schedules
  FOR SELECT
  TO anon
  USING (is_active = true);

-- --------------------------------------------
-- pos_inventory (for ticket selection in customer portal)
-- --------------------------------------------
-- Allow anonymous users to read active inventory items for businesses that have
-- active booking activities. This allows customers to see available tickets when booking.
-- Note: The application will filter to only show items in ticket_settings.inventory_item_ids
DROP POLICY IF EXISTS "anon_customer_portal_read_pos_inventory" ON pos_inventory;
CREATE POLICY "anon_customer_portal_read_pos_inventory"
  ON pos_inventory
  FOR SELECT
  TO anon
  USING (
    is_active = true 
    AND EXISTS (
      SELECT 1 
      FROM booking_activities 
      WHERE booking_activities.business_id = pos_inventory.business_id
        AND booking_activities.is_active = true
    )
  );

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON POLICY "anon_customer_portal_read_app_branding" ON app_branding IS 'Customer portal: anon read for logo/branding by business';
COMMENT ON POLICY "anon_customer_portal_read_booking_types" ON booking_types IS 'Customer portal: anon read for booking categories';
COMMENT ON POLICY "anon_customer_portal_read_booking_activities" ON booking_activities IS 'Customer portal: anon read for activities list and detail';
COMMENT ON POLICY "anon_customer_portal_read_booking_activity_sections" ON booking_activity_sections IS 'Customer portal: anon read for activity additional-info sections';
COMMENT ON POLICY "anon_customer_portal_read_booking_activity_schedules" ON booking_activity_schedules IS 'Customer portal: anon read for active schedules (dates & time slots)';
COMMENT ON POLICY "anon_customer_portal_read_pos_inventory" ON pos_inventory IS 'Customer portal: anon read for active inventory items used as tickets in booking activities';
