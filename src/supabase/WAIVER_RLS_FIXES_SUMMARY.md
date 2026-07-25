# Waiver RLS Policy Fixes

## Issues Found
1. **Storage RLS Policy**: Public users can't upload signature images during waiver signing
2. **pos_loyalty_accounts RLS Policy**: Public users can't create customer accounts during waiver signing
3. **Email Service**: Already fixed (removed business_name reference)

## Fixes Required

### 1. Storage RLS Policy Fix
**File**: `waivers_storage_policies_fix_public_insert.sql`

**Problem**: The INSERT policy only allows uploads to 'public' folder or by authenticated business members. But signature images are uploaded to `waivers/signatures/{business_id}/{waiver_id}.png`.

**Solution**: Updated INSERT policy to allow public uploads when:
- Path contains 'signatures' folder
- There's a waiver_signature with signature_token for that business

**To Apply**:
```sql
-- Run this in Supabase SQL Editor
\i src/supabase/waivers_storage_policies_fix_public_insert.sql
```

### 2. pos_loyalty_accounts RLS Policy Fix
**File**: `pos_loyalty_accounts_rls_fix_public_insert.sql`

**Problem**: Public users can't insert into pos_loyalty_accounts during waiver signing.

**Solution**: Created a new policy that allows public inserts when business_id exists in businesses table.

**To Apply**:
```sql
-- Run this in Supabase SQL Editor
\i src/supabase/pos_loyalty_accounts_rls_fix_public_insert.sql
```

## Deployment Notes
- These are database migrations that need to be run in Supabase
- The code fixes (email service) are already deployed
- After applying these SQL fixes, waiver signing should work correctly


