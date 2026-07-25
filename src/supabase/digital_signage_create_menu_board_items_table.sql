-- Create digital_signage_menu_board_items table
-- This table links POS products to menu boards with custom display settings

CREATE TABLE IF NOT EXISTS digital_signage_menu_board_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    menu_board_id UUID NOT NULL REFERENCES digital_signage_menu_boards(id) ON DELETE CASCADE,
    pos_product_id UUID NOT NULL, -- References pos_products(id) but no FK to avoid circular dependency
    
    -- Custom display settings (overrides product defaults)
    display_name TEXT, -- Custom name for menu board (if different from product name)
    display_price NUMERIC, -- Custom price (if different from product price, null = use product price)
    custom_image_url TEXT, -- Custom image for this menu board (if different from product image)
    description TEXT, -- Custom description for menu board
    
    -- Layout settings
    display_order INTEGER DEFAULT 0,
    is_featured BOOLEAN DEFAULT false,
    highlight_color TEXT, -- Special highlight color for this item
    
    -- Display control
    is_visible BOOLEAN DEFAULT true,
    
    -- Metadata
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure one product per menu board
    UNIQUE(menu_board_id, pos_product_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_menu_board_items_business_id ON digital_signage_menu_board_items(business_id);
CREATE INDEX IF NOT EXISTS idx_menu_board_items_menu_board_id ON digital_signage_menu_board_items(menu_board_id);
CREATE INDEX IF NOT EXISTS idx_menu_board_items_pos_product_id ON digital_signage_menu_board_items(pos_product_id);
CREATE INDEX IF NOT EXISTS idx_menu_board_items_display_order ON digital_signage_menu_board_items(menu_board_id, display_order);

-- Add updated_at trigger
DROP TRIGGER IF EXISTS update_menu_board_items_updated_at ON digital_signage_menu_board_items;
CREATE TRIGGER update_menu_board_items_updated_at
    BEFORE UPDATE ON digital_signage_menu_board_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

