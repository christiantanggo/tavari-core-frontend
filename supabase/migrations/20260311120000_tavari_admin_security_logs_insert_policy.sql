-- Allow authenticated app users to INSERT into tavari_admin_security_logs for their business.
-- Fixes 403 when SecurityAudit tries to log events (RLS was blocking inserts).

-- Ensure RLS is enabled (idempotent)
ALTER TABLE IF EXISTS public.tavari_admin_security_logs ENABLE ROW LEVEL SECURITY;

-- Drop any existing policy that might be too restrictive (by name from security advisor migration)
DROP POLICY IF EXISTS "Authenticated business access" ON public.tavari_admin_security_logs;
DROP POLICY IF EXISTS "Authenticated access" ON public.tavari_admin_security_logs;
DROP POLICY IF EXISTS "Allow insert for own business" ON public.tavari_admin_security_logs;
DROP POLICY IF EXISTS "Allow select own business logs" ON public.tavari_admin_security_logs;

-- Allow INSERT: user must be in business_users for the row's business_id
CREATE POLICY "Allow insert for own business"
  ON public.tavari_admin_security_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    business_id IS NULL
    OR EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = tavari_admin_security_logs.business_id
        AND bu.user_id = auth.uid()
    )
  );

-- Allow SELECT: same - only rows for businesses the user belongs to (or NULL business_id)
CREATE POLICY "Allow select own business logs"
  ON public.tavari_admin_security_logs
  FOR SELECT
  TO authenticated
  USING (
    business_id IS NULL
    OR EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = tavari_admin_security_logs.business_id
        AND bu.user_id = auth.uid()
    )
  );
