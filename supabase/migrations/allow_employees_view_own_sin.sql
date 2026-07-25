-- Allow employees to view and manage their own encrypted SIN records
-- This enables secure employee portal access to SIN numbers

-- Drop existing policies if they exist (to allow re-running this migration)
DROP POLICY IF EXISTS "Employees can view their own SIN" ON employee_sin_numbers;
DROP POLICY IF EXISTS "Employees can create their own SIN" ON employee_sin_numbers;
DROP POLICY IF EXISTS "Employees can update their own SIN" ON employee_sin_numbers;

-- RLS Policy: Employees can view their own SIN record
CREATE POLICY "Employees can view their own SIN"
  ON employee_sin_numbers
  FOR SELECT
  TO authenticated
  USING (employee_id = auth.uid());

-- RLS Policy: Employees can create their own SIN record
CREATE POLICY "Employees can create their own SIN"
  ON employee_sin_numbers
  FOR INSERT
  TO authenticated
  WITH CHECK (employee_id = auth.uid());

-- RLS Policy: Employees can update their own SIN record
CREATE POLICY "Employees can update their own SIN"
  ON employee_sin_numbers
  FOR UPDATE
  TO authenticated
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());

-- Note: Employees CANNOT delete their own SIN records
-- Only managers/owners/admins can delete (existing policies handle that)

-- Verify the policy was created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'employee_sin_numbers'
ORDER BY policyname;

