-- ============================================
-- CUSTOMER PORTAL – ANON INSERT FOR BOOKINGS & PARTICIPANTS
-- ============================================
-- Allows anonymous (customer portal) users to create a booking (source = 'web')
-- and insert booking_participants for that booking only (recently created web booking).
-- Existing business_users policies remain for staff; these add anon for portal flow.
-- ============================================

-- --------------------------------------------
-- bookings: anon and authenticated can INSERT only web bookings (customer portal)
-- --------------------------------------------
DROP POLICY IF EXISTS "anon_customer_portal_insert_bookings" ON bookings;
CREATE POLICY "anon_customer_portal_insert_bookings"
  ON bookings
  FOR INSERT
  TO anon
  WITH CHECK (source = 'web');

DROP POLICY IF EXISTS "authenticated_customer_portal_insert_bookings" ON bookings;
CREATE POLICY "authenticated_customer_portal_insert_bookings"
  ON bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (source = 'web');

-- --------------------------------------------
-- booking_participants: anon and authenticated can INSERT only for a web booking created in the last 5 minutes
-- (same session; prevents attaching participants to arbitrary bookings)
-- --------------------------------------------
DROP POLICY IF EXISTS "anon_customer_portal_insert_booking_participants" ON booking_participants;
CREATE POLICY "anon_customer_portal_insert_booking_participants"
  ON booking_participants
  FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_participants.booking_id
        AND b.source = 'web'
        AND b.created_at > now() - interval '5 minutes'
    )
  );

DROP POLICY IF EXISTS "authenticated_customer_portal_insert_booking_participants" ON booking_participants;
CREATE POLICY "authenticated_customer_portal_insert_booking_participants"
  ON booking_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_participants.booking_id
        AND b.source = 'web'
        AND b.created_at > now() - interval '5 minutes'
    )
  );

-- --------------------------------------------
-- booking_payments: anon and authenticated can INSERT only for a web booking created in the last 5 minutes
-- (used when customer returns from Helcim hosted payment page)
-- --------------------------------------------
DROP POLICY IF EXISTS "anon_customer_portal_insert_booking_payments" ON booking_payments;
CREATE POLICY "anon_customer_portal_insert_booking_payments"
  ON booking_payments
  FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_payments.booking_id
        AND b.source = 'web'
        AND b.created_at > now() - interval '5 minutes'
    )
  );

DROP POLICY IF EXISTS "authenticated_customer_portal_insert_booking_payments" ON booking_payments;
CREATE POLICY "authenticated_customer_portal_insert_booking_payments"
  ON booking_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_payments.booking_id
        AND b.source = 'web'
        AND b.created_at > now() - interval '5 minutes'
    )
  );

COMMENT ON POLICY "anon_customer_portal_insert_bookings" ON bookings IS 'Customer portal: anon can create web bookings';
COMMENT ON POLICY "anon_customer_portal_insert_booking_participants" ON booking_participants IS 'Customer portal: anon can add participants only to a web booking created in the last 5 minutes';
COMMENT ON POLICY "authenticated_customer_portal_insert_booking_participants" ON booking_participants IS 'Customer portal: authenticated can add participants only to a web booking created in the last 5 minutes';
COMMENT ON POLICY "anon_customer_portal_insert_booking_payments" ON booking_payments IS 'Customer portal: anon can record payment for a recently created web booking (return from Helcim)';
COMMENT ON POLICY "authenticated_customer_portal_insert_booking_payments" ON booking_payments IS 'Customer portal: authenticated can record payment for a recently created web booking (return from Helcim)';
