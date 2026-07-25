-- Step 29: Create function waivers_bulk_upload_paper_waivers
-- Purpose: Bulk upload paper waivers with metadata

CREATE OR REPLACE FUNCTION waivers_bulk_upload_paper_waivers(
  business_uuid UUID,
  upload_data JSONB[]
)
RETURNS TABLE (
  uploaded_waiver_id UUID,
  first_name TEXT,
  last_name TEXT,
  status TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_upload_item JSONB;
  v_upload_id UUID;
  v_customer_id UUID;
  v_waiver_id UUID;
BEGIN
  -- Loop through each upload item
  FOREACH v_upload_item IN ARRAY upload_data
  LOOP
    BEGIN
      -- Try to match customer if email/phone provided
      IF v_upload_item->>'email' IS NOT NULL OR v_upload_item->>'phone_number' IS NOT NULL THEN
        SELECT id INTO v_customer_id
        FROM pos_loyalty_accounts
        WHERE business_id = business_uuid
          AND (
            (v_upload_item->>'email' IS NOT NULL AND customer_email = v_upload_item->>'email')
            OR (v_upload_item->>'phone_number' IS NOT NULL AND customer_phone = v_upload_item->>'phone_number')
          )
        LIMIT 1;
      END IF;
      
      -- Insert upload record
      INSERT INTO waiver_uploads (
        business_id,
        customer_id,
        first_name,
        last_name,
        phone_number,
        email,
        upload_type,
        file_url,
        file_path,
        file_size,
        mime_type,
        uploaded_by,
        notes
      ) VALUES (
        business_uuid,
        v_customer_id,
        v_upload_item->>'first_name',
        v_upload_item->>'last_name',
        v_upload_item->>'phone_number',
        v_upload_item->>'email',
        COALESCE(v_upload_item->>'upload_type', 'paper_waiver'),
        v_upload_item->>'file_url',
        v_upload_item->>'file_path',
        (v_upload_item->>'file_size')::BIGINT,
        v_upload_item->>'mime_type',
        (v_upload_item->>'uploaded_by')::UUID,
        v_upload_item->>'notes'
      )
      RETURNING id INTO v_upload_id;
      
      -- Return success
      RETURN QUERY SELECT 
        v_upload_id AS uploaded_waiver_id,
        v_upload_item->>'first_name' AS first_name,
        v_upload_item->>'last_name' AS last_name,
        'success'::TEXT AS status;
        
    EXCEPTION WHEN OTHERS THEN
      -- Return error status
      RETURN QUERY SELECT 
        NULL::UUID AS uploaded_waiver_id,
        v_upload_item->>'first_name' AS first_name,
        v_upload_item->>'last_name' AS last_name,
        ('error: ' || SQLERRM)::TEXT AS status;
    END;
  END LOOP;
END;
$$;

-- Add comment
COMMENT ON FUNCTION waivers_bulk_upload_paper_waivers IS 'Bulk upload paper waivers with metadata - attempts to match customers automatically';




