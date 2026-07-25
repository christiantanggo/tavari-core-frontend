-- ============================================================================
-- Helper function for installation authentication in RLS policies
-- ============================================================================
-- Purpose: Provides a secure way to validate installation_key in RLS policies
--          This function can be used by RLS policies to check if an installation
--          is authorized to access its own data
-- ============================================================================

BEGIN;

-- Function to get installation_id from installation_key
-- This can be used in RLS policies to validate access
CREATE OR REPLACE FUNCTION get_installation_id_from_key(p_installation_key UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_installation_id UUID;
BEGIN
  SELECT id INTO v_installation_id
  FROM music_installations
  WHERE installation_key = p_installation_key
    AND status = 'active';
  
  RETURN v_installation_id;
END;
$$;

COMMENT ON FUNCTION get_installation_id_from_key(UUID) IS 
  'Returns installation_id for a given installation_key. Used by RLS policies to validate installation access. Returns NULL if key is invalid or installation is inactive.';

COMMIT;




