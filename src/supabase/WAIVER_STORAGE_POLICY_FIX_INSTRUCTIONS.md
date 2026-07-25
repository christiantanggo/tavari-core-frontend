# Waiver Storage Policy Fix Instructions

## Problem
Public users can't upload signature images during waiver signing because the storage RLS policy doesn't allow public uploads to the `signatures` folder.

## Solution Options

### Option 1: Use Supabase Dashboard (Recommended - No Permissions Needed)

1. Go to **Supabase Dashboard** → **Storage** → **Policies**
2. Find the bucket `waivers`
3. Click **"New Policy"** or edit the existing INSERT policy
4. Add a new policy with these settings:
   - **Policy Name**: `Public can upload waiver signatures`
   - **Allowed Operation**: `INSERT`
   - **Target Roles**: `public`
   - **Policy Definition**:
   ```sql
   (bucket_id = 'waivers' AND ((storage.foldername(name))[2] = 'signatures' OR (storage.foldername(name))[1] = 'public'))
   ```

### Option 2: Use Service Role Key (If you have it)

If you have the service role key, you can run the SQL file:
```sql
-- Run waivers_storage_policies_fix_public_insert.sql using service role key
```

### Option 3: Contact Database Administrator

If you don't have owner permissions, contact your database administrator to run:
```sql
CREATE POLICY "Public can upload waiver signatures"
ON storage.objects FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'waivers'
  AND (
    (storage.foldername(name))[2] = 'signatures'
    OR (storage.foldername(name))[1] = 'public'
  )
);
```

## Verification

After applying the fix, test by:
1. Starting a new waiver signing flow
2. Completing the signature step
3. Check browser console - should NOT see "new row violates row-level security policy" errors
4. Verify signature image appears in the waiver detail screen


