-- Create new policy that only shows published shifts to everyone except the creator
CREATE POLICY "Users can view published shifts or their own unpublished shifts"
ON scheduling_shifts
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = scheduling_shifts.business_id
      AND bu.user_id = auth.uid()
  )
  AND (
    scheduling_shifts.is_published = true 
    OR scheduling_shifts.created_by = auth.uid()
  )
);

