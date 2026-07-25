-- ============================================
-- ADD SCHEDULE NAME TO BOOKING ACTIVITY SCHEDULES
-- ============================================
-- Migration to add schedule_name column
-- to the existing booking_activity_schedules table
-- This allows multiple named schedules per activity (e.g., "Regular Schedule", "Christmas Week")
-- RLS policies are already in place from the original table creation and will automatically
-- apply to the schedule_name column since they are based on business_id and user roles.

-- ============================================
-- ADD COLUMN
-- ============================================
-- Add schedule_name column
ALTER TABLE booking_activity_schedules
  ADD COLUMN IF NOT EXISTS schedule_name TEXT;

-- ============================================
-- INDEXES
-- ============================================
-- Index for schedule name lookups (grouping schedules by name for an activity)
-- Used when loading all schedules for an activity and grouping by schedule_name
CREATE INDEX IF NOT EXISTS idx_booking_activity_schedules_name 
  ON booking_activity_schedules(activity_id, schedule_name, is_active) 
  WHERE is_active = true;

-- Index for date range queries with schedule name
-- Used when finding active schedules for a specific date range and schedule name
CREATE INDEX IF NOT EXISTS idx_booking_activity_schedules_name_date_range 
  ON booking_activity_schedules(activity_id, schedule_name, start_date, end_date, is_active) 
  WHERE is_active = true;

-- Index for business-level schedule name queries
-- Used when querying schedules by name across all activities in a business
CREATE INDEX IF NOT EXISTS idx_booking_activity_schedules_business_name 
  ON booking_activity_schedules(business_id, schedule_name, is_active) 
  WHERE is_active = true;

-- Index for deleting schedules by name
-- Used when deleting all time slots for a specific schedule name
CREATE INDEX IF NOT EXISTS idx_booking_activity_schedules_activity_name_delete 
  ON booking_activity_schedules(activity_id, schedule_name);

-- Composite index for common query pattern: activity + schedule name + day of week
-- Used when loading a specific schedule's time slots for a specific day
CREATE INDEX IF NOT EXISTS idx_booking_activity_schedules_name_day 
  ON booking_activity_schedules(activity_id, schedule_name, day_of_week, is_active) 
  WHERE is_active = true;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
-- Note: RLS policies are already enabled and configured in the original table creation.
-- The existing policies will automatically apply to the schedule_name column:
-- 
-- 1. "Users can view activity schedules for their business" - SELECT policy
--    - Allows users to view schedules for businesses they belong to
-- 
-- 2. "Managers and owners can create activity schedules" - INSERT policy
--    - Allows managers and owners to create schedules (including schedule_name)
-- 
-- 3. "Managers and owners can update activity schedules" - UPDATE policy
--    - Allows managers and owners to update schedules (including schedule_name)
-- 
-- 4. "Managers and owners can delete activity schedules" - DELETE policy
--    - Allows managers and owners to delete schedules (including by schedule_name)
--
-- These policies are based on business_id and user roles, so they automatically
-- cover the schedule_name column without requiring any changes.

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON COLUMN booking_activity_schedules.schedule_name IS 'Name of the schedule (e.g., "Regular Schedule", "Christmas Week 2026"). Schedules with the same name share the same date range and represent one weekly schedule version. Multiple named schedules can exist per activity, allowing different schedules for different time periods.';
