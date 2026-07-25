-- ============================================
-- BOOKINGS MODULE - DATABASE FUNCTIONS MIGRATION
-- ============================================
-- This migration creates database functions for the Bookings module
-- Functions: booking number generation, QR code generation, availability checking, session capacity updates

-- ============================================
-- FUNCTION: Generate Booking Number
-- ============================================
-- Generates a unique booking number for a business
-- Format: BK-{business_id_short}-{count+1}
DROP FUNCTION IF EXISTS generate_booking_number(UUID);
CREATE OR REPLACE FUNCTION generate_booking_number(business_uuid UUID)
RETURNS TEXT AS $$
DECLARE
  business_prefix TEXT;
  next_number INTEGER;
BEGIN
  business_prefix := SUBSTRING(business_uuid::TEXT, 1, 8);

  -- Serialize number generation per business to avoid duplicate booking numbers.
  PERFORM pg_advisory_xact_lock(hashtext(business_uuid::TEXT), 0);

  SELECT COALESCE(
    MAX(NULLIF(SPLIT_PART(booking_number, '-', 3), '')::INTEGER),
    0
  ) + 1
  INTO next_number
  FROM bookings
  WHERE business_id = business_uuid
    AND booking_number LIKE 'BK-' || business_prefix || '-%';

  RETURN 'BK-' || business_prefix || '-' || LPAD(next_number::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION generate_booking_number(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_booking_number(UUID) TO anon;

-- ============================================
-- FUNCTION: Generate QR Code
-- ============================================
-- Generates a unique QR code for a booking and updates the booking record
-- Format: BOOK-{business_id}-{booking_number}-{hash}
DROP FUNCTION IF EXISTS generate_booking_qr_code(UUID);
CREATE OR REPLACE FUNCTION generate_booking_qr_code(booking_uuid UUID)
RETURNS TEXT AS $$
DECLARE
  booking_data RECORD;
  qr_code TEXT;
BEGIN
  SELECT id, booking_number, business_id INTO booking_data
  FROM bookings
  WHERE id = booking_uuid;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;
  
  -- Generate QR code: BOOK-{business_id}-{booking_number}-{timestamp_hash}
  qr_code := 'BOOK-' || 
             SUBSTRING(booking_data.business_id::TEXT, 1, 8) || '-' || 
             booking_data.booking_number || '-' ||
             SUBSTRING(MD5(booking_data.id::TEXT || NOW()::TEXT), 1, 8);
  
  -- Update booking with QR code
  UPDATE bookings
  SET qr_code = qr_code
  WHERE id = booking_uuid;
  
  RETURN qr_code;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION generate_booking_qr_code(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_booking_qr_code(UUID) TO anon;

-- ============================================
-- FUNCTION: Check Availability
-- ============================================
-- Checks available spots for a specific activity, date, and time
-- Returns the number of available spots (0 if fully booked)
DROP FUNCTION IF EXISTS check_booking_availability(UUID, DATE, TIME, TIME);
CREATE OR REPLACE FUNCTION check_booking_availability(
  activity_uuid UUID,
  session_date DATE,
  start_time TIME,
  end_time TIME
)
RETURNS INTEGER AS $$
DECLARE
  activity_data RECORD;
  session_data RECORD;
  existing_bookings INTEGER;
  available_spots INTEGER;
BEGIN
  -- Get activity details
  SELECT max_capacity INTO activity_data
  FROM booking_activities
  WHERE id = activity_uuid;
  
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  
  -- Check for existing session
  SELECT id, max_capacity, current_bookings INTO session_data
  FROM booking_sessions
  WHERE activity_id = activity_uuid
    AND session_date = check_booking_availability.session_date
    AND start_time = check_booking_availability.start_time
    AND status = 'scheduled';
  
  IF FOUND THEN
    available_spots := session_data.max_capacity - session_data.current_bookings;
  ELSE
    -- No session exists, use activity default capacity
    available_spots := activity_data.max_capacity;
  END IF;
  
  RETURN GREATEST(0, available_spots);
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION check_booking_availability(UUID, DATE, TIME, TIME) TO authenticated;
GRANT EXECUTE ON FUNCTION check_booking_availability(UUID, DATE, TIME, TIME) TO anon;

-- ============================================
-- FUNCTION: Update Session Capacity
-- ============================================
-- Trigger function to automatically update session capacity when bookings change
-- Handles NULL session_id values gracefully
DROP FUNCTION IF EXISTS update_session_capacity();
CREATE OR REPLACE FUNCTION update_session_capacity()
RETURNS TRIGGER AS $$
BEGIN
  -- Update current_bookings count when booking is created/updated/deleted
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    -- Only update if session_id is not NULL
    IF NEW.session_id IS NOT NULL THEN
      UPDATE booking_sessions
      SET current_bookings = (
        SELECT COUNT(*)
        FROM bookings
        WHERE session_id = NEW.session_id
          AND status IN ('pending', 'confirmed', 'checked_in')
      )
      WHERE id = NEW.session_id;
    END IF;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    -- Only update if session_id is not NULL
    IF OLD.session_id IS NOT NULL THEN
      UPDATE booking_sessions
      SET current_bookings = (
        SELECT COUNT(*)
        FROM bookings
        WHERE session_id = OLD.session_id
          AND status IN ('pending', 'confirmed', 'checked_in')
      )
      WHERE id = OLD.session_id;
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER: Auto-update session capacity
-- ============================================
-- Automatically updates session capacity when bookings are created, updated, or deleted
DROP TRIGGER IF EXISTS trigger_update_session_capacity ON bookings;
CREATE TRIGGER trigger_update_session_capacity
  AFTER INSERT OR UPDATE OR DELETE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_session_capacity();

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';












