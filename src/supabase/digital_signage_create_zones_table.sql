-- Create digital_signage_zones table
-- Purpose: Multi-zone support for screens
-- Dependencies: FK to businesses, users, screens, templates

CREATE TABLE IF NOT EXISTS digital_signage_zones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    zone_name text NOT NULL,
    zone_key text NOT NULL,
    screen_id uuid,
    template_id uuid,
    position_x numeric(10, 2) DEFAULT 0,
    position_y numeric(10, 2) DEFAULT 0,
    width numeric(10, 2) NOT NULL,
    height numeric(10, 2) NOT NULL,
    position_unit text DEFAULT 'pixels' CHECK (position_unit IN ('pixels', 'percent')),
    z_index integer DEFAULT 0,
    background_color text,
    border_style jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_zones_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_zones_screen_id_fkey 
        FOREIGN KEY (screen_id) 
        REFERENCES digital_signage_screens(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_zones_template_id_fkey 
        FOREIGN KEY (template_id) 
        REFERENCES digital_signage_templates(id) 
        ON DELETE SET NULL,
    
    CONSTRAINT digital_signage_zones_created_by_fkey 
        FOREIGN KEY (created_by) 
        REFERENCES users(id) 
        ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_zones_business 
    ON digital_signage_zones(business_id);

CREATE INDEX IF NOT EXISTS idx_digital_signage_zones_screen 
    ON digital_signage_zones(screen_id, is_active) 
    WHERE screen_id IS NOT NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_digital_signage_zones_template 
    ON digital_signage_zones(template_id) 
    WHERE template_id IS NOT NULL;

-- Enable RLS
ALTER TABLE digital_signage_zones ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_zones IS 'Multi-zone support for screens';



