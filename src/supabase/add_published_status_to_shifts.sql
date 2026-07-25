-- Add published status and published_by columns to scheduling_shifts
ALTER TABLE scheduling_shifts 
ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;

-- Update RLS policies to respect published status
-- Drop old select policy
DROP POLICY IF EXISTS "Users can view shifts in their business" ON scheduling_shifts;

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

-- Policy for insert (shift creation)
DROP POLICY IF EXISTS "Managers can create shifts" ON scheduling_shifts;

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

-- Policy for publishing
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

-- Add created_by column if it doesn't exist
ALTER TABLE scheduling_shifts
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

