# Employee Certificate File Storage Setup

This document explains how to set up the Supabase Storage bucket for employee certificate files.

## Database Migration

Run the migration file `add_certificate_file_storage.sql` to:
- Add `certificate_file_url` column to `employee_certificates` table
- Create necessary indexes

## Supabase Storage Bucket Setup

### Step 1: Create the Storage Bucket

1. Go to your Supabase Dashboard
2. Navigate to **Storage** section
3. Click **New bucket**
4. Configure the bucket:
   - **Name**: `employee-certificates`
   - **Public**: `false` (Private bucket - requires authentication)
   - **File size limit**: `10485760` (10MB)
   - **Allowed MIME types**: 
     - `application/pdf`
     - `image/jpeg`
     - `image/png`
     - `image/jpg`

### Step 2: Set Up RLS Policies

The migration file includes RLS policies, but you can also set them up manually in the Supabase Dashboard:

1. Go to **Storage** → **Policies** for the `employee-certificates` bucket
2. Add the following policies:

#### Upload Policy (INSERT)
```sql
CREATE POLICY "Managers can upload certificate files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'employee-certificates' AND
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.active = true
    AND ur.role IN ('manager', 'owner', 'admin')
  )
);
```

#### View Policy (SELECT)
```sql
CREATE POLICY "Managers can view certificate files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'employee-certificates' AND
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.active = true
    AND ur.role IN ('manager', 'owner', 'admin')
  )
);
```

#### Delete Policy (DELETE)
```sql
CREATE POLICY "Managers can delete certificate files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'employee-certificates' AND
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.active = true
    AND ur.role IN ('manager', 'owner', 'admin')
  )
);
```

## Security Features

1. **Manager PIN Required**: All file uploads and views require manager PIN verification
2. **Private Bucket**: Files are stored in a private bucket, not publicly accessible
3. **Signed URLs**: Files are accessed via time-limited signed URLs (1 hour expiry)
4. **Role-Based Access**: Only managers, owners, and admins can access files
5. **File Validation**: 
   - Only PDF and image files allowed
   - Maximum file size: 10MB
6. **Audit Logging**: All file operations are logged for security

## File Structure

Files are stored with the following path structure:
```
{business_id}/{employee_id}/{certificate_id}.{extension}
```

Example:
```
69f610dc-1201-4447-9fea-bec62970b917/0a82ba78-15fd-4f8b-9d7f-03bf2fd46c61/abc123-def456.pdf
```

## Usage

1. **Upload Certificate File**:
   - When adding a new certificate, select a file and enter manager PIN
   - When updating an existing certificate, click "Upload File" and enter manager PIN

2. **View Certificate File**:
   - Click "View File" on any certificate with an uploaded file
   - Enter manager PIN to view/download

3. **File Replacement**:
   - Uploading a new file for an existing certificate will replace the old file

## Troubleshooting

- **"Bucket not found"**: Ensure the bucket `employee-certificates` exists in Supabase Storage
- **"Permission denied"**: Check that RLS policies are correctly set up
- **"File too large"**: Ensure file is under 10MB
- **"Invalid file type"**: Only PDF, JPG, JPEG, and PNG files are allowed


















