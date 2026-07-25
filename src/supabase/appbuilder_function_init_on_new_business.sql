-- Step 137: Create trigger to initialize AppBuilder for new businesses
-- Auto-initialize default modules and branding when business is created

CREATE OR REPLACE FUNCTION appbuilder_init_on_new_business()
RETURNS TRIGGER AS $$
BEGIN
    -- Initialize default modules for new business
    PERFORM appbuilder_initialize_business_modules(NEW.id);
    
    -- Backfill branding with defaults
    INSERT INTO app_branding (
        business_id,
        app_name,
        primary_color,
        secondary_color,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        NEW.name,
        '#3B82F6',
        '#1E40AF',
        now(),
        now()
    )
    ON CONFLICT (business_id) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on businesses table
DROP TRIGGER IF EXISTS appbuilder_init_business_trigger ON businesses;
CREATE TRIGGER appbuilder_init_business_trigger
    AFTER INSERT ON businesses
    FOR EACH ROW
    EXECUTE FUNCTION appbuilder_init_on_new_business();




