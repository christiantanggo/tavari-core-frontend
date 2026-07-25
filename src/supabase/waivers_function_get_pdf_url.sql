-- Step 28: Create function waivers_get_waiver_pdf_url
-- Purpose: Generate or retrieve PDF URL for waiver
-- Note: This function returns the storage path - actual signed URL generation would be done in the application layer

CREATE OR REPLACE FUNCTION waivers_get_waiver_pdf_url(waiver_uuid UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_business_id UUID;
  v_pdf_path TEXT;
  v_file_exists BOOLEAN;
BEGIN
  -- Get business_id from waiver
  SELECT business_id
  INTO v_business_id
  FROM waiver_signatures
  WHERE id = waiver_uuid;
  
  -- If waiver not found, return NULL
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  
  -- Generate PDF path (format: waivers/{business_id}/{waiver_id}.pdf)
  v_pdf_path := 'waivers/' || v_business_id::TEXT || '/' || waiver_uuid::TEXT || '.pdf';
  
  -- Note: Actual file existence check and signed URL generation would be done in application layer
  -- This function just returns the expected storage path
  
  -- In Supabase, you would use storage.from('waivers').createSignedUrl() in the application
  -- This function is a placeholder that returns the path
  
  RETURN v_pdf_path;
END;
$$;

-- Add comment
COMMENT ON FUNCTION waivers_get_waiver_pdf_url IS 'Get PDF storage path for waiver (signed URL generation done in application layer)';




