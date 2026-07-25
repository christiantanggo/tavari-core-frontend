-- ============================================
-- CUSTOMER PORTAL – INSERT + SELECT FOR waiver_participants (anon + authenticated)
-- ============================================
-- 1) ANON: Allows customer portal (before Supabase session) to add participants
--    when row has customer_id and business_id (app always sends both).
-- 2) ANON SELECT: So .insert().select().single() can return the inserted row (RLS on SELECT).
-- 3) AUTHENTICATED: Signed-in users can only insert for own customer (email match).
--
-- Run this in Supabase SQL Editor if you get:
--   42501 new row violates row-level security policy for table "waiver_participants"
--
-- Prerequisite: bookings_unify_participants_table.sql (customer_id, business_id on waiver_participants).
-- ============================================

-- Anon SELECT: so insert(...).select().single() can return the row (otherwise 403 on the SELECT)
DROP POLICY IF EXISTS "waiver_participants_select_anon_portal" ON waiver_participants;
CREATE POLICY "waiver_participants_select_anon_portal"
  ON waiver_participants FOR SELECT
  TO anon
  USING (
    customer_id IS NOT NULL
    AND business_id IS NOT NULL
  );

-- Anon: portal has verified via phone+OTP but no Supabase session yet.
-- Use TO anon so this policy only runs for anon; WITH CHECK on row contents.
DROP POLICY IF EXISTS "waiver_participants_insert_anon_portal" ON waiver_participants;
CREATE POLICY "waiver_participants_insert_anon_portal"
  ON waiver_participants FOR INSERT
  TO anon
  WITH CHECK (
    customer_id IS NOT NULL
    AND business_id IS NOT NULL
  );

-- Authenticated: signed in (e.g. after Supabase OTP); can only insert for own customer (email match)
DROP POLICY IF EXISTS "waiver_participants_insert_authenticated_portal" ON waiver_participants;
CREATE POLICY "waiver_participants_insert_authenticated_portal"
  ON waiver_participants FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND customer_id IN (
      SELECT id FROM pos_loyalty_accounts
      WHERE business_id = waiver_participants.business_id
        AND customer_email = (auth.jwt()->>'email')
    )
  );

COMMENT ON POLICY "waiver_participants_select_anon_portal" ON waiver_participants IS
  'Customer portal (anon): can read rows with customer_id and business_id (e.g. after insert).';
COMMENT ON POLICY "waiver_participants_insert_anon_portal" ON waiver_participants IS
  'Customer portal (anon): add participants after phone+OTP verify; row must have customer_id and business_id.';
COMMENT ON POLICY "waiver_participants_insert_authenticated_portal" ON waiver_participants IS
  'Customer portal (authenticated): add participants only for own customer (email match).';

-- Verify: list INSERT and SELECT policies
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'waiver_participants' AND cmd IN ('INSERT','SELECT');
