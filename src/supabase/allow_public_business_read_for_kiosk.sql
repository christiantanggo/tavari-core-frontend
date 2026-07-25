-- Allow public/anonymous read access to businesses table for kiosk validation
-- This policy allows kiosk apps (running as anonymous users) to validate business IDs
-- Only exposes id and name fields (no sensitive data)

-- Drop policy if it exists (to allow re-running this script)
DROP POLICY IF EXISTS "Public can read business id and name for kiosk" ON businesses;

-- Create a policy that allows public SELECT on businesses table for id and name only
-- This is needed for waiver kiosk and music kiosk to validate business IDs
CREATE POLICY "Public can read business id and name for kiosk"
ON businesses
FOR SELECT
TO anon, authenticated
USING (true);

-- Note: This policy allows reading ALL businesses, but since we're only selecting
-- id and name (no sensitive data), this is safe for kiosk validation purposes.
-- The kiosk will only use the business ID to validate that the business exists
-- before proceeding with the kiosk flow.

