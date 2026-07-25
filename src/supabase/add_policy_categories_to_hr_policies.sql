-- Add policy_categories field to hr_policies table
-- This stores an array of category IDs that are used in the policy
-- Categories are numbered dynamically based on which ones are actually used

ALTER TABLE hr_policies 
ADD COLUMN IF NOT EXISTS policy_categories JSONB DEFAULT '[]'::jsonb;

-- Create index for category queries
CREATE INDEX IF NOT EXISTS idx_hr_policies_policy_categories ON hr_policies USING GIN (policy_categories);

-- Add comment
COMMENT ON COLUMN hr_policies.policy_categories IS 'Array of category IDs used in this policy. Categories are numbered dynamically (1, 2, 3...) based on their order in this array, allowing skipped categories without disrupting numbering.';



