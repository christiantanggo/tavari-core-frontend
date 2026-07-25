-- Step 21: Create function appbuilder_backfill_branding
-- Function to backfill app_branding for existing businesses with sensible defaults

CREATE OR REPLACE FUNCTION appbuilder_backfill_branding()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO app_branding (
        business_id, 
        app_name, 
        primary_color, 
        secondary_color, 
        created_at, 
        updated_at
    )
    SELECT 
        id, 
        name, 
        '#3B82F6', -- Default primary color (blue)
        '#1E40AF',  -- Default secondary color (darker blue)
        now(), 
        now()
    FROM businesses
    WHERE id NOT IN (SELECT business_id FROM app_branding);
END;
$$;




