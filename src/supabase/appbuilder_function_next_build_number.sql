-- Step 14: Create function appbuilder_get_next_build_number
-- Function to get next sequential build number for business/platform

CREATE OR REPLACE FUNCTION appbuilder_get_next_build_number(
    business_uuid uuid,
    platform text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    next_number integer;
BEGIN
    SELECT COALESCE(MAX(build_number), 0) + 1
    INTO next_number
    FROM app_builds
    WHERE business_id = business_uuid
        AND (app_builds.platform = platform OR app_builds.platform = 'both');
    
    RETURN next_number;
END;
$$;




