-- RLS Policies for digital_signage_party_host_photos

-- Enable RLS
ALTER TABLE digital_signage_party_host_photos ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can view party host photos for their business
CREATE POLICY "Users can view party host photos for their business"
    ON digital_signage_party_host_photos
    FOR SELECT
    USING (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 2: Users can insert party host photos for their business
CREATE POLICY "Users can insert party host photos for their business"
    ON digital_signage_party_host_photos
    FOR INSERT
    WITH CHECK (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 3: Users can update party host photos for their business
CREATE POLICY "Users can update party host photos for their business"
    ON digital_signage_party_host_photos
    FOR UPDATE
    USING (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 4: Users can delete party host photos for their business
CREATE POLICY "Users can delete party host photos for their business"
    ON digital_signage_party_host_photos
    FOR DELETE
    USING (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 5: TOSA employees can view all party host photos
CREATE POLICY "TOSA employees can view all party host photos"
    ON digital_signage_party_host_photos
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM tavari_employees 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );



