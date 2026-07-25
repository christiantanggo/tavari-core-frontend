-- Step 15: Create function waivers_create_family_waiver
-- Purpose: Create waiver with multiple adults and minors (family waiver)
-- Creates waiver_signatures record + multiple waiver_participants

CREATE OR REPLACE FUNCTION waivers_create_family_waiver(waiver_data JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_waiver_id UUID;
  v_template_id UUID;
  v_business_id UUID;
  v_customer_id UUID;
  v_primary_adult JSONB;
  v_additional_adults JSONB;
  v_minors JSONB;
  v_participant JSONB;
  v_participant_id UUID;
BEGIN
  -- Extract main waiver data
  v_template_id := (waiver_data->>'template_id')::UUID;
  v_business_id := (waiver_data->>'business_id')::UUID;
  v_customer_id := (waiver_data->>'customer_id')::UUID;
  v_primary_adult := waiver_data->'primary_adult';
  v_additional_adults := waiver_data->'additional_adults';
  v_minors := waiver_data->'minors';
  
  -- Create waiver_signatures record
  INSERT INTO waiver_signatures (
    business_id,
    template_id,
    signature_token,
    first_name,
    last_name,
    date_of_birth,
    phone_number,
    email,
    address,
    postal_code,
    is_minor,
    customer_id,
    signature_image_url,
    signature_data,
    signed_at
  ) VALUES (
    v_business_id,
    v_template_id,
    waivers_create_signature_token(v_business_id),
    v_primary_adult->>'first_name',
    v_primary_adult->>'last_name',
    (v_primary_adult->>'date_of_birth')::DATE,
    v_primary_adult->>'phone_number',
    v_primary_adult->>'email',
    v_primary_adult->>'address',
    v_primary_adult->>'postal_code',
    false,
    v_customer_id,
    v_primary_adult->>'signature_image_url',
    v_primary_adult->'signature_data',
    NOW()
  )
  RETURNING id INTO v_waiver_id;
  
  -- Add primary adult as participant
  INSERT INTO waiver_participants (
    waiver_id,
    participant_type,
    first_name,
    last_name,
    date_of_birth,
    phone_number,
    email,
    signature_image_url,
    signature_data,
    signed_at,
    is_required
  ) VALUES (
    v_waiver_id,
    'primary',
    v_primary_adult->>'first_name',
    v_primary_adult->>'last_name',
    (v_primary_adult->>'date_of_birth')::DATE,
    v_primary_adult->>'phone_number',
    v_primary_adult->>'email',
    v_primary_adult->>'signature_image_url',
    v_primary_adult->'signature_data',
    NOW(),
    true
  );
  
  -- Add additional adults as participants
  IF v_additional_adults IS NOT NULL AND jsonb_array_length(v_additional_adults) > 0 THEN
    FOR v_participant IN SELECT * FROM jsonb_array_elements(v_additional_adults)
    LOOP
      INSERT INTO waiver_participants (
        waiver_id,
        participant_type,
        first_name,
        last_name,
        date_of_birth,
        phone_number,
        email,
        signature_image_url,
        signature_data,
        signed_at,
        is_required
      ) VALUES (
        v_waiver_id,
        'additional_adult',
        v_participant->>'first_name',
        v_participant->>'last_name',
        (v_participant->>'date_of_birth')::DATE,
        v_participant->>'phone_number',
        v_participant->>'email',
        v_participant->>'signature_image_url',
        v_participant->'signature_data',
        CASE WHEN v_participant->>'signed_at' IS NOT NULL 
          THEN (v_participant->>'signed_at')::TIMESTAMPTZ 
          ELSE NOW() 
        END,
        true
      );
    END LOOP;
  END IF;
  
  -- Add minors as participants
  IF v_minors IS NOT NULL AND jsonb_array_length(v_minors) > 0 THEN
    FOR v_participant IN SELECT * FROM jsonb_array_elements(v_minors)
    LOOP
      INSERT INTO waiver_participants (
        waiver_id,
        participant_type,
        first_name,
        last_name,
        date_of_birth,
        phone_number,
        email,
        relationship_to_minor,
        is_required
      ) VALUES (
        v_waiver_id,
        'minor',
        v_participant->>'first_name',
        v_participant->>'last_name',
        (v_participant->>'date_of_birth')::DATE,
        v_participant->>'phone_number',
        v_participant->>'email',
        v_participant->>'relationship_to_minor',
        true
      );
    END LOOP;
  END IF;
  
  RETURN v_waiver_id;
END;
$$;

-- Add comment
COMMENT ON FUNCTION waivers_create_family_waiver IS 'Create waiver with multiple adults and minors (family waiver) - creates waiver_signatures + waiver_participants';




