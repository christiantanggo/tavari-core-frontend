-- Step 27: Create function waivers_validate_field_response
-- Purpose: Validate field response against validation rules

CREATE OR REPLACE FUNCTION waivers_validate_field_response(
  field_uuid UUID,
  response_value TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_field_record RECORD;
  v_validation_rules JSONB;
  v_min_length INTEGER;
  v_max_length INTEGER;
  v_pattern TEXT;
  v_is_required BOOLEAN;
BEGIN
  -- Get field and validation rules
  SELECT 
    is_required,
    validation_rules
  INTO v_field_record
  FROM waiver_fields
  WHERE id = field_uuid;
  
  -- If field not found, return false
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  v_is_required := v_field_record.is_required;
  v_validation_rules := v_field_record.validation_rules;
  
  -- Check if required
  IF v_is_required = true AND (response_value IS NULL OR TRIM(response_value) = '') THEN
    RETURN false;
  END IF;
  
  -- If no validation rules, return true (if not required or has value)
  IF v_validation_rules IS NULL THEN
    RETURN true;
  END IF;
  
  -- Extract validation rules
  v_min_length := (v_validation_rules->>'min_length')::INTEGER;
  v_max_length := (v_validation_rules->>'max_length')::INTEGER;
  v_pattern := v_validation_rules->>'pattern';
  
  -- Check min length
  IF v_min_length IS NOT NULL AND LENGTH(response_value) < v_min_length THEN
    RETURN false;
  END IF;
  
  -- Check max length
  IF v_max_length IS NOT NULL AND LENGTH(response_value) > v_max_length THEN
    RETURN false;
  END IF;
  
  -- Check pattern (regex)
  IF v_pattern IS NOT NULL AND response_value !~ v_pattern THEN
    RETURN false;
  END IF;
  
  -- All validations passed
  RETURN true;
END;
$$;

-- Add comment
COMMENT ON FUNCTION waivers_validate_field_response IS 'Validate field response against validation rules (required, min/max length, pattern)';




