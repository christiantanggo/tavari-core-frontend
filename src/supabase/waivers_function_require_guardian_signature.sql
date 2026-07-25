-- Step 16: Create function waivers_require_guardian_signature
-- Purpose: Check if guardian signature is required (based on age threshold)

CREATE OR REPLACE FUNCTION waivers_require_guardian_signature(
  waiver_uuid UUID,
  participant_dob DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_template_id UUID;
  v_minor_age_threshold INTEGER;
  v_participant_age INTEGER;
  v_requires_guardian BOOLEAN;
BEGIN
  -- Get template_id from waiver
  SELECT template_id
  INTO v_template_id
  FROM waiver_signatures
  WHERE id = waiver_uuid;
  
  -- If waiver not found, return false
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- Get minor_age_threshold from template
  SELECT minor_age_threshold, requires_guardian_signature
  INTO v_minor_age_threshold, v_requires_guardian
  FROM waiver_templates
  WHERE id = v_template_id;
  
  -- If template not found or doesn't require guardian signature, return false
  IF NOT FOUND OR v_requires_guardian = false THEN
    RETURN false;
  END IF;
  
  -- If participant_dob is NULL, cannot determine age - return true (require guardian to be safe)
  IF participant_dob IS NULL THEN
    RETURN true;
  END IF;
  
  -- Calculate participant age
  v_participant_age := EXTRACT(YEAR FROM AGE(participant_dob));
  
  -- Return true if participant age < minor_age_threshold
  RETURN v_participant_age < v_minor_age_threshold;
END;
$$;

-- Add comment
COMMENT ON FUNCTION waivers_require_guardian_signature IS 'Check if guardian signature is required based on participant age and template minor_age_threshold';




