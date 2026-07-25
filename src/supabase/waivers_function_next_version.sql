-- Step 26: Create function waivers_get_next_version_number
-- Purpose: Get next version number for template

CREATE OR REPLACE FUNCTION waivers_get_next_version_number(template_uuid UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM waiver_versions
  WHERE template_id = template_uuid;
  
  RETURN v_next_version;
END;
$$;

-- Add comment
COMMENT ON FUNCTION waivers_get_next_version_number IS 'Get next version number for a waiver template';




