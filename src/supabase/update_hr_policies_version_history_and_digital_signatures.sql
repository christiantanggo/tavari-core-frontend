-- Update hr_policies table to support version history/archiving
-- Add parent_policy_id to link versions of the same policy

ALTER TABLE hr_policies 
ADD COLUMN IF NOT EXISTS parent_policy_id UUID REFERENCES hr_policies(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_current_version BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS policy_number TEXT; -- Format: [type_number].[sequence] e.g., "1.01", "4.03"

-- Create index for version tracking
CREATE INDEX IF NOT EXISTS idx_hr_policies_parent_policy_id ON hr_policies(parent_policy_id);
CREATE INDEX IF NOT EXISTS idx_hr_policies_is_current_version ON hr_policies(is_current_version);
CREATE INDEX IF NOT EXISTS idx_hr_policies_policy_number ON hr_policies(policy_number);
CREATE INDEX IF NOT EXISTS idx_hr_policies_type_number ON hr_policies(business_id, policy_type);

-- Update hr_policy_assignments to support digital signatures
ALTER TABLE hr_policy_assignments
ADD COLUMN IF NOT EXISTS digital_signature_image TEXT, -- Base64 or URL to signature image
ADD COLUMN IF NOT EXISTS digital_signature_acknowledged BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS digital_signature_acknowledged_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS signed_by_name TEXT, -- Name of person who signed
ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ, -- When signature was applied
ADD COLUMN IF NOT EXISTS signature_method TEXT CHECK (signature_method IN ('digital', 'physical', NULL)), -- How signature was obtained
ADD COLUMN IF NOT EXISTS ip_address TEXT, -- IP address when signed (for audit)
ADD COLUMN IF NOT EXISTS user_agent TEXT; -- User agent when signed (for audit)

-- Create index for digital signatures
CREATE INDEX IF NOT EXISTS idx_hr_policy_assignments_digital_signature ON hr_policy_assignments(digital_signature_image) WHERE digital_signature_image IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_policy_assignments_signed_at ON hr_policy_assignments(signed_at);

-- Note: Version creation is handled in the application layer (PolicyCreationModal.jsx)
-- The function below is kept for potential future use but the app handles archiving directly

-- Function to get all versions of a policy
CREATE OR REPLACE FUNCTION get_policy_versions(policy_uuid UUID)
RETURNS TABLE (
  id UUID,
  policy_name TEXT,
  policy_version TEXT,
  effective_date DATE,
  status TEXT,
  created_at TIMESTAMPTZ,
  is_current_version BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_parent_id UUID;
BEGIN
  -- Find the root policy (oldest version)
  SELECT COALESCE(parent_policy_id, policy_uuid)
  INTO v_parent_id
  FROM hr_policies
  WHERE id = policy_uuid;
  
  -- If policy has a parent, use parent; otherwise use the policy itself
  IF v_parent_id IS NULL THEN
    v_parent_id := policy_uuid;
  END IF;
  
  -- Return all versions (parent and all children)
  RETURN QUERY
  SELECT 
    p.id,
    p.policy_name,
    p.policy_version,
    p.effective_date,
    p.status,
    p.created_at,
    p.is_current_version
  FROM hr_policies p
  WHERE p.id = v_parent_id 
     OR p.parent_policy_id = v_parent_id
     OR (p.parent_policy_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM hr_policies p2 
       WHERE p2.id = p.parent_policy_id 
       AND (p2.id = v_parent_id OR p2.parent_policy_id = v_parent_id)
     ))
  ORDER BY p.created_at ASC;
END;
$$;

-- Add comments
COMMENT ON FUNCTION create_policy_version IS 'Creates a new version of a policy and archives the old version';
COMMENT ON FUNCTION get_policy_versions IS 'Returns all versions of a policy (parent and all children)';

-- Update RLS to allow viewing archived policies
-- (Existing policies should already allow this, but ensure archived ones are visible)

-- Add comment to columns
COMMENT ON COLUMN hr_policies.parent_policy_id IS 'Links to the original policy when this is a new version';
COMMENT ON COLUMN hr_policies.is_current_version IS 'True if this is the current active version of the policy';
COMMENT ON COLUMN hr_policies.archived_at IS 'When this version was archived (superseded by a new version)';
COMMENT ON COLUMN hr_policy_assignments.digital_signature_image IS 'Base64 encoded image or URL to the digital signature';
COMMENT ON COLUMN hr_policy_assignments.digital_signature_acknowledged IS 'Whether the employee acknowledged the digital signature agreement';
COMMENT ON COLUMN hr_policy_assignments.signed_by_name IS 'Name of the person who signed the policy';
COMMENT ON COLUMN hr_policy_assignments.signature_method IS 'Method used to sign: digital or physical';

