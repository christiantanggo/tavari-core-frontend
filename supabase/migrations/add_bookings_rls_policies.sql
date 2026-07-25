-- ============================================
-- BOOKINGS MODULE - RLS POLICIES MIGRATION
-- ============================================
-- This migration creates Row-Level Security policies for all booking tables
-- Uses business_users table for access control (verified December 17, 2025)

-- ============================================
-- BOOKING TYPES RLS POLICIES
-- ============================================
-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view booking types for their business" ON booking_types;
DROP POLICY IF EXISTS "Managers can create booking types" ON booking_types;
DROP POLICY IF EXISTS "Managers can update booking types" ON booking_types;
DROP POLICY IF EXISTS "Managers can delete booking types" ON booking_types;

CREATE POLICY "Users can view booking types for their business"
  ON booking_types FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_types.business_id
      AND business_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can create booking types"
  ON booking_types FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_types.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

CREATE POLICY "Managers can update booking types"
  ON booking_types FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_types.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_types.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

CREATE POLICY "Managers can delete booking types"
  ON booking_types FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_types.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

-- ============================================
-- BOOKING ACTIVITIES RLS POLICIES
-- ============================================
DROP POLICY IF EXISTS "Users can view booking activities for their business" ON booking_activities;
DROP POLICY IF EXISTS "Managers can manage booking activities" ON booking_activities;

CREATE POLICY "Users can view booking activities for their business"
  ON booking_activities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_activities.business_id
      AND business_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can manage booking activities"
  ON booking_activities FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_activities.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_activities.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

-- ============================================
-- BOOKING SESSIONS RLS POLICIES
-- ============================================
DROP POLICY IF EXISTS "Users can view booking sessions for their business" ON booking_sessions;
DROP POLICY IF EXISTS "Managers can manage booking sessions" ON booking_sessions;

CREATE POLICY "Users can view booking sessions for their business"
  ON booking_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_sessions.business_id
      AND business_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can manage booking sessions"
  ON booking_sessions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_sessions.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_sessions.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

-- ============================================
-- BOOKINGS RLS POLICIES
-- ============================================
DROP POLICY IF EXISTS "Users can view bookings for their business" ON bookings;
DROP POLICY IF EXISTS "Employees can create bookings" ON bookings;
DROP POLICY IF EXISTS "Managers can update bookings" ON bookings;
DROP POLICY IF EXISTS "Managers can delete bookings" ON bookings;

CREATE POLICY "Users can view bookings for their business"
  ON bookings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = bookings.business_id
      AND business_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Employees can create bookings"
  ON bookings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = bookings.business_id
      AND business_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can update bookings"
  ON bookings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = bookings.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin', 'employee')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = bookings.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin', 'employee')
    )
  );

CREATE POLICY "Managers can delete bookings"
  ON bookings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = bookings.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

-- ============================================
-- BOOKING PARTICIPANTS RLS POLICIES
-- ============================================
DROP POLICY IF EXISTS "Users can view participants for bookings in their business" ON booking_participants;
DROP POLICY IF EXISTS "Users can manage participants for bookings in their business" ON booking_participants;

CREATE POLICY "Users can view participants for bookings in their business"
  ON booking_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      JOIN business_users ON business_users.business_id = bookings.business_id
      WHERE bookings.id = booking_participants.booking_id
      AND business_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage participants for bookings in their business"
  ON booking_participants FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      JOIN business_users ON business_users.business_id = bookings.business_id
      WHERE bookings.id = booking_participants.booking_id
      AND business_users.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings
      JOIN business_users ON business_users.business_id = bookings.business_id
      WHERE bookings.id = booking_participants.booking_id
      AND business_users.user_id = auth.uid()
    )
  );

-- ============================================
-- BOOKING ADDONS RLS POLICIES
-- ============================================
DROP POLICY IF EXISTS "Users can view addons for their business" ON booking_addons;
DROP POLICY IF EXISTS "Managers can manage addons" ON booking_addons;

CREATE POLICY "Users can view addons for their business"
  ON booking_addons FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_addons.business_id
      AND business_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can manage addons"
  ON booking_addons FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_addons.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_addons.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

-- ============================================
-- BOOKING ADDON ITEMS RLS POLICIES
-- ============================================
DROP POLICY IF EXISTS "Users can view addon items for bookings in their business" ON booking_addon_items;
DROP POLICY IF EXISTS "Users can manage addon items for bookings in their business" ON booking_addon_items;

CREATE POLICY "Users can view addon items for bookings in their business"
  ON booking_addon_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      JOIN business_users ON business_users.business_id = bookings.business_id
      WHERE bookings.id = booking_addon_items.booking_id
      AND business_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage addon items for bookings in their business"
  ON booking_addon_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      JOIN business_users ON business_users.business_id = bookings.business_id
      WHERE bookings.id = booking_addon_items.booking_id
      AND business_users.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings
      JOIN business_users ON business_users.business_id = bookings.business_id
      WHERE bookings.id = booking_addon_items.booking_id
      AND business_users.user_id = auth.uid()
    )
  );

-- ============================================
-- BOOKING PAYMENTS RLS POLICIES
-- ============================================
DROP POLICY IF EXISTS "Users can view payments for bookings in their business" ON booking_payments;
DROP POLICY IF EXISTS "Managers can manage payments" ON booking_payments;

CREATE POLICY "Users can view payments for bookings in their business"
  ON booking_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      JOIN business_users ON business_users.business_id = bookings.business_id
      WHERE bookings.id = booking_payments.booking_id
      AND business_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can manage payments"
  ON booking_payments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      JOIN business_users ON business_users.business_id = bookings.business_id
      WHERE bookings.id = booking_payments.booking_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings
      JOIN business_users ON business_users.business_id = bookings.business_id
      WHERE bookings.id = booking_payments.booking_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

-- ============================================
-- BOOKING NOTIFICATIONS RLS POLICIES
-- ============================================
DROP POLICY IF EXISTS "Users can view notifications for bookings in their business" ON booking_notifications;
DROP POLICY IF EXISTS "System can create notifications" ON booking_notifications;
DROP POLICY IF EXISTS "Managers can update notifications" ON booking_notifications;

CREATE POLICY "Users can view notifications for bookings in their business"
  ON booking_notifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      JOIN business_users ON business_users.business_id = bookings.business_id
      WHERE bookings.id = booking_notifications.booking_id
      AND business_users.user_id = auth.uid()
    )
  );

CREATE POLICY "System can create notifications"
  ON booking_notifications FOR INSERT
  WITH CHECK (true); -- System-generated, no user check needed

CREATE POLICY "Managers can update notifications"
  ON booking_notifications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      JOIN business_users ON business_users.business_id = bookings.business_id
      WHERE bookings.id = booking_notifications.booking_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

-- ============================================
-- BOOKING SETTINGS RLS POLICIES
-- ============================================
DROP POLICY IF EXISTS "Users can view settings for their business" ON booking_settings;
DROP POLICY IF EXISTS "Managers can manage settings" ON booking_settings;

CREATE POLICY "Users can view settings for their business"
  ON booking_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_settings.business_id
      AND business_users.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can manage settings"
  ON booking_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_settings.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = booking_settings.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';












