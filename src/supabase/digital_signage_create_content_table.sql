-- Create digital_signage_content table
-- Purpose: Store all content items (images, videos, HTML, widgets)
-- Dependencies: None (only FK to businesses, users, and templates)

CREATE TABLE IF NOT EXISTS digital_signage_content (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    content_name text NOT NULL,
    content_type text NOT NULL CHECK (content_type IN ('image', 'video', 'html', 'widget', 'playlist')),
    file_url text,
    file_path text,
    file_size bigint,
    mime_type text,
    width integer,
    height integer,
    duration_seconds integer,
    thumbnail_url text,
    folder_path text,
    tags text[] DEFAULT '{}'::text[],
    description text,
    template_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_content_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_content_created_by_fkey 
        FOREIGN KEY (created_by) 
        REFERENCES users(id) 
        ON DELETE SET NULL,
    
    CONSTRAINT digital_signage_content_template_id_fkey 
        FOREIGN KEY (template_id) 
        REFERENCES digital_signage_templates(id) 
        ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_content_business 
    ON digital_signage_content(business_id);

CREATE INDEX IF NOT EXISTS idx_digital_signage_content_business_type 
    ON digital_signage_content(business_id, content_type, is_active) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_digital_signage_content_tags 
    ON digital_signage_content USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_digital_signage_content_folder 
    ON digital_signage_content(business_id, folder_path) 
    WHERE folder_path IS NOT NULL;

-- Enable RLS
ALTER TABLE digital_signage_content ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_content IS 'Content library for digital signage (images, videos, HTML, widgets)';



