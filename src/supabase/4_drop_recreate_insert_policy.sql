-- Drop old INSERT policy
DROP POLICY IF EXISTS "Managers can create shifts" ON scheduling_shifts;

-- Create new INSERT policy
CREATE POLICY "Managers can create shifts"
ON scheduling_shifts
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = scheduling_shifts.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('owner', 'manager')
  )
);

