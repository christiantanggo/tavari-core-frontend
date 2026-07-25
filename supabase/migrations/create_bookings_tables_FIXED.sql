-- ============================================
-- BOOKINGS MODULE - DATABASE MIGRATION
-- ============================================
-- This migration creates all tables for the Bookings module
-- Updated to match actual database schema (verified December 17, 2025)
--
-- Verified Tables:
-- - businesses: id (uuid), name (text) - NOT business_name
-- - users: id (uuid), all required columns exist
-- - pos_loyalty_accounts: id (uuid), customer_name, customer_email, customer_phone
-- - waiver_signatures: id (uuid), is_valid (boolean), expires_at, signed_at
-- - pos_sales: id (uuid), customer_id, loyalty_customer_id, customer_name, customer_phone, customer_email
-- - pos_payments: id (uuid), sale_id, payment_method, amount, processed_by
-- - mail_campaign_sends: id (uuid), campaign_id (uuid), contact_id (uuid), ses_message_id (text)
-- - business_users: business_id, user_id, role (for RLS policies)

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- BOOKING TYPES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS booking_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type_name TEXT NOT NULL,
  type_key TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  requires_waiver BOOLEAN DEFAULT false,
  requires_payment BOOLEAN DEFAULT true,
  custom_fields JSONB DEFAULT '{}'::jsonb,
  session_rules JSONB DEFAULT '{}'::jsonb,
  cancellation_rules JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT booking_types_business_type_key UNIQUE (business_id, type_key)
);

-- ============================================
-- BOOKING ACTIVITIES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS booking_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type_id UUID REFERENCES booking_types(id) ON DELETE CASCADE,
  activity_name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER DEFAULT 60,
  max_capacity INTEGER DEFAULT 10,
  location_id UUID,
  resource_requirements JSONB DEFAULT '{}'::jsonb,
  requires_waiver BOOLEAN DEFAULT false,
  pricing_rules JSONB DEFAULT '{}'::jsonb,
  addon_settings JSONB DEFAULT '{}'::jsonb,
  ticket_settings JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BOOKING SESSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS booking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES booking_activities(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  max_capacity INTEGER NOT NULL,
  current_bookings INTEGER DEFAULT 0,
  available_spots INTEGER GENERATED ALWAYS AS (max_capacity - current_bookings) STORED,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BOOKINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_id UUID REFERENCES booking_sessions(id) ON DELETE SET NULL,
  activity_id UUID NOT NULL REFERENCES booking_activities(id) ON DELETE CASCADE,
  booking_type_id UUID REFERENCES booking_types(id) ON DELETE SET NULL,
  booking_number TEXT UNIQUE,
  customer_id UUID REFERENCES pos_loyalty_accounts(id) ON DELETE SET NULL,
  customer_email TEXT,
  customer_phone TEXT,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'checked_in', 'cancelled', 'completed', 'no_show')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded')),
  source TEXT DEFAULT 'staff' CHECK (source IN ('app', 'web', 'kiosk', 'staff')),
  qr_code TEXT UNIQUE,
  requires_approval BOOLEAN DEFAULT false,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BOOKING PARTICIPANTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS booking_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  participant_id UUID,
  inventory_item_id UUID,
  ticket_type TEXT,
  first_name TEXT,
  last_name TEXT,
  date_of_birth DATE,
  phone_number TEXT,
  email TEXT,
  waiver_id UUID REFERENCES waiver_signatures(id) ON DELETE SET NULL,
  waiver_status TEXT DEFAULT 'not_required' CHECK (waiver_status IN ('valid', 'expired', 'not_required', 'missing')),
  is_minor BOOLEAN DEFAULT false,
  guardian_id UUID REFERENCES booking_participants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BOOKING ADDONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS booking_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  addon_name TEXT NOT NULL,
  addon_key TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  is_global BOOLEAN DEFAULT false,
  activity_ids UUID[],
  inventory_tracked BOOLEAN DEFAULT false,
  current_stock INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT booking_addons_business_key UNIQUE (business_id, addon_key)
);

-- ============================================
-- BOOKING ADDON ITEMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS booking_addon_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  addon_id UUID NOT NULL REFERENCES booking_addons(id) ON DELETE RESTRICT,
  quantity INTEGER DEFAULT 1,
  unit_price NUMERIC(10, 2) NOT NULL,
  total_price NUMERIC(10, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BOOKING PAYMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS booking_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('full', 'deposit', 'subscription', 'pay_at_venue', 'layaway')),
  amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0,
  deposit_amount NUMERIC(10, 2),
  remaining_balance NUMERIC(10, 2),
  payment_method TEXT,
  sale_id UUID REFERENCES pos_sales(id) ON DELETE SET NULL,
  transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  refund_amount NUMERIC(10, 2) DEFAULT 0,
  refund_reason TEXT,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BOOKING NOTIFICATIONS TABLE
-- ============================================
-- Note: message_id stores SES message ID from mail-send Edge Function response
-- mail_campaign_sends table stores campaign_id and contact_id as UUIDs,
-- but mail-send accepts string IDs and handles conversion
CREATE TABLE IF NOT EXISTS booking_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('confirmation', 'reminder', 'check_in', 'post_visit', 'cancellation')),
  delivery_method TEXT[] DEFAULT ARRAY[]::TEXT[],
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'failed')),
  message_id TEXT, -- Stores SES message ID from mail-send response
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- BOOKING SETTINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS booking_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  activity_id UUID REFERENCES booking_activities(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_global BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create partial unique indexes for booking_settings
-- Note: PostgreSQL doesn't support WHERE clauses in UNIQUE constraints,
-- so we use partial unique indexes instead
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_settings_unique_activity 
  ON booking_settings(business_id, activity_id, setting_key) 
  WHERE activity_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_settings_unique_global 
  ON booking_settings(business_id, setting_key) 
  WHERE activity_id IS NULL AND is_global = true;

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_booking_types_business_active ON booking_types(business_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_booking_activities_type ON booking_activities(type_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_booking_activities_business ON booking_activities(business_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_booking_sessions_date_time ON booking_sessions(session_date, start_time, activity_id);
CREATE INDEX IF NOT EXISTS idx_booking_sessions_available ON booking_sessions(activity_id, session_date, status) WHERE status = 'scheduled' AND available_spots > 0;
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id, booking_date DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(business_id, status, booking_date DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_qr_code ON bookings(qr_code) WHERE qr_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON bookings(booking_date, booking_time);
CREATE INDEX IF NOT EXISTS idx_booking_participants_booking ON booking_participants(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_participants_waiver ON booking_participants(waiver_id) WHERE waiver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_addons_global ON booking_addons(business_id, is_global) WHERE is_global = true AND is_active = true;
CREATE INDEX IF NOT EXISTS idx_booking_addon_items_booking ON booking_addon_items(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_payments_booking ON booking_payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_payments_status ON booking_payments(status, created_at DESC) WHERE status IN ('pending', 'completed');
CREATE INDEX IF NOT EXISTS idx_booking_notifications_scheduled ON booking_notifications(scheduled_for, status) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_booking_notifications_booking ON booking_notifications(booking_id, notification_type);
CREATE INDEX IF NOT EXISTS idx_booking_settings_business ON booking_settings(business_id, is_global);

-- ============================================
-- ENABLE RLS
-- ============================================
ALTER TABLE booking_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_addon_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_settings ENABLE ROW LEVEL SECURITY;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

