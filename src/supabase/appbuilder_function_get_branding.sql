-- Step 11: Create function appbuilder_get_branding_config
-- Function to get all branding configuration for a business in a single query

CREATE OR REPLACE FUNCTION appbuilder_get_branding_config(business_uuid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    branding_data jsonb;
BEGIN
    SELECT jsonb_build_object(
        'id', id,
        'business_id', business_id,
        'app_name', app_name,
        'primary_color', primary_color,
        'secondary_color', secondary_color,
        'accent_color', accent_color,
        'logo_url', logo_url,
        'favicon_url', favicon_url,
        'store_badges', store_badges,
        'pwa_settings', pwa_settings,
        'legal_imprint', legal_imprint,
        'support_email', support_email,
        'privacy_url', privacy_url,
        'footer_text', footer_text,
        'created_at', created_at,
        'updated_at', updated_at
    )
    INTO branding_data
    FROM app_branding
    WHERE business_id = business_uuid;
    
    RETURN COALESCE(branding_data, '{}'::jsonb);
END;
$$;




