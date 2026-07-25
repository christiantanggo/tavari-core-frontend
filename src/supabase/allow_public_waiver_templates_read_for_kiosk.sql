-- Allow public/anonymous read access to waiver_templates table for kiosk
-- This policy allows kiosk apps (running as anonymous users) to read active waiver templates
-- Needed for waiver kiosk to load templates for signing

-- Drop policy if it exists (to allow re-running this script)
DROP POLICY IF EXISTS "Public can read active waiver templates for kiosk" ON waiver_templates;

-- Create a policy that allows public SELECT on waiver_templates for active templates only
-- This is needed for waiver kiosk to load templates
CREATE POLICY "Public can read active waiver templates for kiosk"
ON waiver_templates
FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- Note: This policy allows anonymous users to read active waiver templates.
-- Since templates are meant to be publicly accessible for signing, this is safe.
-- The kiosk will only use this to load the template content for customers to sign.




