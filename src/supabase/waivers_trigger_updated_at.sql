-- Step 19: Create trigger waivers_updated_at
-- Purpose: Auto-update updated_at timestamp on waiver_templates and waiver_signatures changes

-- Ensure update_updated_at_column function exists (if not, create it)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for waiver_templates
CREATE TRIGGER trigger_waiver_templates_updated_at
    BEFORE UPDATE ON waiver_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for waiver_signatures
CREATE TRIGGER trigger_waiver_signatures_updated_at
    BEFORE UPDATE ON waiver_signatures
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for waiver_settings
CREATE TRIGGER trigger_waiver_settings_updated_at
    BEFORE UPDATE ON waiver_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comment
COMMENT ON TRIGGER trigger_waiver_templates_updated_at ON waiver_templates IS 'Auto-update updated_at timestamp on waiver_templates updates';
COMMENT ON TRIGGER trigger_waiver_signatures_updated_at ON waiver_signatures IS 'Auto-update updated_at timestamp on waiver_signatures updates';
COMMENT ON TRIGGER trigger_waiver_settings_updated_at ON waiver_settings IS 'Auto-update updated_at timestamp on waiver_settings updates';




