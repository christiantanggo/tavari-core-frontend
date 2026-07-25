-- Add DELETE policy for scheduling_shifts table
CREATE POLICY "Managers can delete shifts"
ON scheduling_shifts
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = scheduling_shifts.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('owner', 'manager')
  )
);

