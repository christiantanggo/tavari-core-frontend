-- Create digital_signage_templates table
-- Purpose: Reusable templates for layouts, designs, widgets, and playlists
-- Dependencies: None (only FK to businesses and users)

CREATE TABLE IF NOT EXISTS digital_signage_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    template_name text NOT NULL,
    template_key text NOT NULL,
    template_type text NOT NULL CHECK (template_type IN ('layout', 'design', 'widget', 'playlist')),
    preview_image_url text,
    template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_system_template boolean DEFAULT false,
    is_public boolean DEFAULT false,
    category text,
    tags text[] DEFAULT '{}'::text[],
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_templates_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_templates_created_by_fkey 
        FOREIGN KEY (created_by) 
        REFERENCES users(id) 
        ON DELETE SET NULL,
    
    CONSTRAINT digital_signage_templates_business_key_unique 
        UNIQUE (business_id, template_key)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_templates_business 
    ON digital_signage_templates(business_id);

CREATE INDEX IF NOT EXISTS idx_digital_signage_templates_business_type 
    ON digital_signage_templates(business_id, template_type, is_active) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_digital_signage_templates_public 
    ON digital_signage_templates(is_public, is_active) 
    WHERE is_public = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_digital_signage_templates_tags 
    ON digital_signage_templates USING GIN(tags);

-- Enable RLS
ALTER TABLE digital_signage_templates ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_templates IS 'Reusable templates for layouts, designs, widgets, and playlists';



