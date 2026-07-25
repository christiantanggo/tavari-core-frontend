-- Add published status columns to scheduling_shifts
ALTER TABLE scheduling_shifts 
ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS published_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

