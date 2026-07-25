-- RLS Policies for digital_signage_party_host_sequences

-- Enable RLS
ALTER TABLE digital_signage_party_host_sequences ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can view party host sequences for their business
CREATE POLICY "Users can view party host sequences for their business"
    ON digital_signage_party_host_sequences
    FOR SELECT
    USING (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 2: Users can insert party host sequences for their business
CREATE POLICY "Users can insert party host sequences for their business"
    ON digital_signage_party_host_sequences
    FOR INSERT
    WITH CHECK (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 3: Users can update party host sequences for their business
CREATE POLICY "Users can update party host sequences for their business"
    ON digital_signage_party_host_sequences
    FOR UPDATE
    USING (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 4: Users can delete party host sequences for their business
CREATE POLICY "Users can delete party host sequences for their business"
    ON digital_signage_party_host_sequences
    FOR DELETE
    USING (
        business_id IN (
            SELECT business_id FROM user_roles 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- Policy 5: TOSA employees can view all party host sequences
CREATE POLICY "TOSA employees can view all party host sequences"
    ON digital_signage_party_host_sequences
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM tavari_employees 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );



