-- Create storage bucket for digital signage content
-- Pattern: Matches existing storage bucket patterns

-- Create bucket (if it doesn't exist)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'digital-signage-content',
    'digital-signage-content',
    false, -- Private bucket (authenticated access only)
    524288000, -- 500MB limit
    ARRAY[
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/gif',
        'image/webp',
        'image/svg+xml',
        'video/mp4',
        'video/webm',
        'video/quicktime',
        'text/html',
        'application/json'
    ]
)
ON CONFLICT (id) DO UPDATE
SET 
    file_size_limit = 524288000,
    allowed_mime_types = ARRAY[
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/gif',
        'image/webp',
        'image/svg+xml',
        'video/mp4',
        'video/webm',
        'video/quicktime',
        'text/html',
        'application/json'
    ];

-- Storage policies for digital-signage-content bucket
-- Pattern: Path-based policies for multi-tenant isolation

-- SELECT: Allow business users to view their content
CREATE POLICY "digital_signage_content_select"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'digital-signage-content'
    AND (
        -- Path format: {business_id}/{filename}
        (storage.foldername(name))[1] IN (
            SELECT id::text FROM businesses
            WHERE id IN (
                SELECT business_id FROM user_roles 
                WHERE user_id = auth.uid() AND active = true
            )
        )
        OR EXISTS (
            SELECT 1 FROM tavari_employees te 
            WHERE te.user_id = auth.uid() AND te.is_active = true
        )
    )
);

-- INSERT: Allow business users to upload to their folder
CREATE POLICY "digital_signage_content_insert"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'digital-signage-content'
    AND (
        (storage.foldername(name))[1] IN (
            SELECT id::text FROM businesses
            WHERE id IN (
                SELECT business_id FROM user_roles 
                WHERE user_id = auth.uid() AND active = true
            )
        )
        OR EXISTS (
            SELECT 1 FROM tavari_employees te 
            WHERE te.user_id = auth.uid() AND te.is_active = true
        )
    )
);

-- UPDATE: Allow business users to update their content
CREATE POLICY "digital_signage_content_update"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'digital-signage-content'
    AND (
        (storage.foldername(name))[1] IN (
            SELECT id::text FROM businesses
            WHERE id IN (
                SELECT business_id FROM user_roles 
                WHERE user_id = auth.uid() AND active = true
            )
        )
        OR EXISTS (
            SELECT 1 FROM tavari_employees te 
            WHERE te.user_id = auth.uid() AND te.is_active = true
        )
    )
)
WITH CHECK (
    bucket_id = 'digital-signage-content'
    AND (
        (storage.foldername(name))[1] IN (
            SELECT id::text FROM businesses
            WHERE id IN (
                SELECT business_id FROM user_roles 
                WHERE user_id = auth.uid() AND active = true
            )
        )
        OR EXISTS (
            SELECT 1 FROM tavari_employees te 
            WHERE te.user_id = auth.uid() AND te.is_active = true
        )
    )
);

-- DELETE: Allow business users to delete their content
CREATE POLICY "digital_signage_content_delete"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'digital-signage-content'
    AND (
        (storage.foldername(name))[1] IN (
            SELECT id::text FROM businesses
            WHERE id IN (
                SELECT business_id FROM user_roles 
                WHERE user_id = auth.uid() AND active = true
            )
        )
        OR EXISTS (
            SELECT 1 FROM tavari_employees te 
            WHERE te.user_id = auth.uid() AND te.is_active = true
        )
    )
);



