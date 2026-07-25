-- Allow anon to read waiver_participants so customer portal can load participants.
-- Run this once in Supabase SQL Editor.

DROP POLICY IF EXISTS "waiver_participants_select_anon_portal" ON waiver_participants;
CREATE POLICY "waiver_participants_select_anon_portal"
  ON waiver_participants FOR SELECT TO anon
  USING (customer_id IS NOT NULL AND business_id IS NOT NULL);
