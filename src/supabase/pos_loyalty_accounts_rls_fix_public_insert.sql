-- Fix pos_loyalty_accounts RLS to allow public inserts during waiver signing
-- The issue: Public users can't create customer accounts during waiver signing
-- Solution: Allow public inserts when creating accounts as part of waiver flow

-- Check if a public insert policy already exists
DO $$
BEGIN
  -- Drop existing public insert policy if it exists
  DROP POLICY IF EXISTS "pos_loyalty_accounts_insert_public_waiver" ON pos_loyalty_accounts;
  
  -- Create new policy allowing public inserts during waiver signing
  -- This allows the waiver submission service to create customer accounts
  CREATE POLICY "pos_loyalty_accounts_insert_public_waiver" ON pos_loyalty_accounts
    FOR INSERT
    WITH CHECK (
      -- Allow public inserts - this is needed for waiver signing flow
      -- The business_id must be valid (exists in businesses table)
      business_id IN (SELECT id FROM businesses)
    );
    
  RAISE NOTICE 'Public insert policy created for pos_loyalty_accounts';
END $$;

COMMENT ON POLICY "pos_loyalty_accounts_insert_public_waiver" ON pos_loyalty_accounts IS 'Allows public users to create customer accounts during waiver signing';


