-- Create UPDATE policy for publishing
CREATE POLICY "Managers can publish shifts"
ON scheduling_shifts
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = scheduling_shifts.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('owner', 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = scheduling_shifts.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('owner', 'manager')
  )
);

