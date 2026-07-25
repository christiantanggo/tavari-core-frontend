-- Create digital_signage_menu_boards table
-- This table stores menu board designs and configurations

CREATE TABLE IF NOT EXISTS digital_signage_menu_boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    board_name TEXT NOT NULL,
    board_key TEXT UNIQUE NOT NULL,
    screen_id UUID REFERENCES digital_signage_screens(id) ON DELETE SET NULL,
    template_id UUID REFERENCES digital_signage_templates(id) ON DELETE SET NULL,
    
    -- Design settings
    layout_type TEXT DEFAULT 'grid', -- grid, list, carousel, featured
    theme_color TEXT DEFAULT '#3B82F6',
    background_color TEXT DEFAULT '#FFFFFF',
    background_image_url TEXT,
    font_family TEXT DEFAULT 'Arial',
    header_text TEXT,
    header_image_url TEXT,
    
    -- Display settings
    show_prices BOOLEAN DEFAULT true,
    show_descriptions BOOLEAN DEFAULT false,
    show_categories BOOLEAN DEFAULT true,
    items_per_row INTEGER DEFAULT 3,
    auto_refresh_interval_seconds INTEGER DEFAULT 60,
    
    -- Filtering
    category_ids UUID[], -- Array of pos_categories.id to filter products
    show_only_active BOOLEAN DEFAULT true,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_published BOOLEAN DEFAULT false,
    
    -- Metadata
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for business_id
CREATE INDEX IF NOT EXISTS idx_menu_boards_business_id ON digital_signage_menu_boards(business_id);
CREATE INDEX IF NOT EXISTS idx_menu_boards_screen_id ON digital_signage_menu_boards(screen_id);
CREATE INDEX IF NOT EXISTS idx_menu_boards_is_active ON digital_signage_menu_boards(is_active);

-- Add updated_at trigger
DROP TRIGGER IF EXISTS update_menu_boards_updated_at ON digital_signage_menu_boards;
CREATE TRIGGER update_menu_boards_updated_at
    BEFORE UPDATE ON digital_signage_menu_boards
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

