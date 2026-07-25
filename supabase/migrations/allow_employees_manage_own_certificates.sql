-- Allow employees to insert and update their own certificates
-- This enables the employee portal to upload certificate files

-- Create helper function to get public.users.id from auth.users.id (bypasses RLS)
CREATE OR REPLACE FUNCTION get_public_user_id_from_auth()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user_email TEXT;
  v_public_user_id UUID;
BEGIN
  -- Get email from auth.users
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = auth.uid()
  LIMIT 1;

  IF v_user_email IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get public.users.id from email
  SELECT id INTO v_public_user_id
  FROM public.users
  WHERE email = v_user_email
  LIMIT 1;

  RETURN v_public_user_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_public_user_id_from_auth() TO authenticated;

-- Drop ALL existing policies on employee_certificates (to avoid conflicts)
-- First, get a list of all policies and drop them
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT pol.polname as policy_name
    FROM pg_policy pol
    JOIN pg_class pc ON pol.polrelid = pc.oid
    WHERE pc.relname = 'employee_certificates'
      AND pc.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON employee_certificates', r.policy_name);
  END LOOP;
END $$;

-- RLS Policy: Employees can insert their own certificates
-- Match employee_id with authenticated user's public.users.id via RPC function
CREATE POLICY "Employees can insert their own certificates"
ON employee_certificates
FOR INSERT
TO authenticated
WITH CHECK (
  -- Employee can only insert certificates for themselves
  -- Use RPC function to get public.users.id (bypasses RLS)
  employee_certificates.employee_id = get_public_user_id_from_auth()
);

-- RLS Policy: Employees can update their own certificates
CREATE POLICY "Employees can update their own certificates"
ON employee_certificates
FOR UPDATE
TO authenticated
USING (
  -- Employee can only update their own certificates
  -- Use RPC function to get public.users.id (bypasses RLS)
  employee_id = get_public_user_id_from_auth()
)
WITH CHECK (
  -- Ensure they can only update their own certificates
  employee_id = get_public_user_id_from_auth()
);

-- RLS Policy: Employees can view their own certificates
CREATE POLICY "Employees can view their own certificates"
ON employee_certificates
FOR SELECT
TO authenticated
USING (
  -- Employee can view their own certificates
  -- Use RPC function to get public.users.id (bypasses RLS)
  employee_id = get_public_user_id_from_auth()
  -- OR managers/owners/admins can view all certificates in their business
  OR EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.business_id = employee_certificates.business_id
      AND ur.user_id = auth.uid()
      AND ur.active = true
      AND ur.role IN ('manager', 'owner', 'admin')
  )
);

-- Also update storage policies to allow employees to upload their own certificate files
DROP POLICY IF EXISTS "Employees can upload their own certificate files" ON storage.objects;
DROP POLICY IF EXISTS "Employees can view their own certificate files" ON storage.objects;
DROP POLICY IF EXISTS "Employees can update their own certificate files" ON storage.objects;

-- RLS Policy: Employees can upload their own certificate files
-- Path format: {business_id}/{employee_id}/{certificate_id}.{ext}
CREATE POLICY "Employees can upload their own certificate files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'employee-certificates' AND
  -- Extract employee_id from path (second folder in path)
  -- Path: business_id/employee_id/filename.ext
  -- Split by '/' and get the second element (index 1)
  -- Use RPC function to get public.users.id (bypasses RLS)
  (string_to_array(name, '/'))[2] = get_public_user_id_from_auth()::TEXT
);

-- RLS Policy: Employees can view their own certificate files
CREATE POLICY "Employees can view their own certificate files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'employee-certificates' AND
  -- Extract employee_id from path (second folder in path)
  -- Use RPC function to get public.users.id (bypasses RLS)
  (string_to_array(name, '/'))[2] = get_public_user_id_from_auth()::TEXT
);

-- RLS Policy: Employees can update their own certificate files
CREATE POLICY "Employees can update their own certificate files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'employee-certificates' AND
  -- Extract employee_id from path (second folder in path)
  -- Use RPC function to get public.users.id (bypasses RLS)
  (string_to_array(name, '/'))[2] = get_public_user_id_from_auth()::TEXT
)
WITH CHECK (
  bucket_id = 'employee-certificates' AND
  -- Extract employee_id from path (second folder in path)
  (string_to_array(name, '/'))[2] = get_public_user_id_from_auth()::TEXT
);

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

