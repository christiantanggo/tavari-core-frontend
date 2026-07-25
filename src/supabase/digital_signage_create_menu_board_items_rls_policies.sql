-- RLS Policies for digital_signage_menu_board_items

-- Enable RLS
ALTER TABLE digital_signage_menu_board_items ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can view menu board items for their business
CREATE POLICY "Users can view menu board items for their business"
    ON digital_signage_menu_board_items
    FOR SELECT
    USING (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 2: Users can insert menu board items for their business
CREATE POLICY "Users can insert menu board items for their business"
    ON digital_signage_menu_board_items
    FOR INSERT
    WITH CHECK (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 3: Users can update menu board items for their business
CREATE POLICY "Users can update menu board items for their business"
    ON digital_signage_menu_board_items
    FOR UPDATE
    USING (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 4: Users can delete menu board items for their business
CREATE POLICY "Users can delete menu board items for their business"
    ON digital_signage_menu_board_items
    FOR DELETE
    USING (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 5: TOSA employees can view all menu board items
CREATE POLICY "TOSA employees can view all menu board items"
    ON digital_signage_menu_board_items
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM tavari_employees 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );



