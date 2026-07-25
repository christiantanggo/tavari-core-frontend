-- RLS Policies for digital_signage_party_hosts

-- Enable RLS
ALTER TABLE digital_signage_party_hosts ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can view party hosts for their business
CREATE POLICY "Users can view party hosts for their business"
    ON digital_signage_party_hosts
    FOR SELECT
    USING (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 2: Users can insert party hosts for their business
CREATE POLICY "Users can insert party hosts for their business"
    ON digital_signage_party_hosts
    FOR INSERT
    WITH CHECK (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 3: Users can update party hosts for their business
CREATE POLICY "Users can update party hosts for their business"
    ON digital_signage_party_hosts
    FOR UPDATE
    USING (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 4: Users can delete party hosts for their business
CREATE POLICY "Users can delete party hosts for their business"
    ON digital_signage_party_hosts
    FOR DELETE
    USING (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 5: TOSA employees can view all party hosts
CREATE POLICY "TOSA employees can view all party hosts"
    ON digital_signage_party_hosts
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM tavari_employees 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );



