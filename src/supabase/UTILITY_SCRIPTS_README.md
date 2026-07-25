# Supabase Utility Scripts

This directory contains utility SQL scripts for database maintenance and operations.

## User Deletion Scripts

### `delete_daniel_jamieson_all_data.sql`
**Purpose**: Comprehensive deletion script to remove all data related to a specific user (Daniel Jamieson) from the database.

**What it does**:
- Finds all users matching "Daniel Jamieson" by name or email
- Deletes from ALL tables with foreign key references to the `users` table
- Handles self-referential foreign keys (e.g., `users.manager_id`)
- Cleans up auth-related tables
- Sets `businesses.created_by` to NULL instead of deleting businesses

**Tables cleaned** (based on actual foreign key constraints):
- Bookings
- Contract-related: `contract_amendments`, `contract_compliance`, `contract_files`, `contract_notifications`, `contract_templates`
- Digital Signage: All digital signage tables
- Employee: `employee_audit_trail`, `employee_certificates`, `employee_documents`, `employee_sin_numbers`
- HR: `hr_contracts`, `hr_contract_notifications`, `hr_contract_versions`, `hr_policy_assignments`, `hr_terminations`
- Payroll: `hrpayroll_entries`, `hrpayroll_ytd_data`, `hrpayroll_employee_premiums`, `hrpayroll_lieu_time_transactions`, `hrpayroll_runs`, `hrpayroll_wage_history`
- Scheduling: All scheduling tables (`scheduling_shifts`, `scheduling_time_clocks`, `scheduling_availability`, etc.)
- POS: `pos_loyalty_accounts`, `pos_transactions`, etc.
- Music: `music_v2_*` tables
- Waivers: `waiver_audit_log`, `waiver_templates`, `waiver_uploads`
- And many more...

**Usage**:
1. Open Supabase SQL Editor
2. Copy and paste the entire script
3. Review the user matching criteria (currently searches for "Daniel Jamieson")
4. Execute the script
5. Check the NOTICE messages for deletion progress

**Important Notes**:
- This script uses exception handling - if a table doesn't exist, it will skip it and continue
- The script preserves businesses but sets `created_by` to NULL
- Auth users are deleted from `auth.users` table
- All deletions are logged via `RAISE NOTICE` statements

**To adapt for other users**:
Modify the WHERE clause in the user search section (around line 18-27) to match different criteria.

---

## Inspection Scripts

### `inspect_all_user_references.sql`
**Purpose**: Comprehensive database inspection to find all tables and columns that reference users.

**What it shows**:
1. All foreign keys referencing `users` table
2. All foreign keys referencing `auth.users` table
3. All columns with user-related names (user_id, employee_id, created_by, etc.)
4. All tables in public schema
5. Specific table structures (e.g., `contract_compliance`)
6. All foreign keys from specific tables

**Usage**: Run individual queries to inspect database structure before creating deletion scripts.

### `inspect_tables_for_deletion.sql`
**Purpose**: Quick inspection to find user-related records and table structures.

**What it shows**:
- Column structure of specific tables (e.g., `pos_loyalty_accounts`)
- Count of records matching a user
- All tables with user-related columns

---

## Best Practices

1. **Always inspect first**: Run inspection scripts before deletion to understand the database structure
2. **Test on non-production**: Test deletion scripts on a development/staging database first
3. **Backup first**: Create a database backup before running deletion scripts
4. **Review foreign keys**: Use `inspect_all_user_references.sql` to see all foreign key relationships
5. **Check for cascading deletes**: Some tables may have `ON DELETE CASCADE` which will automatically delete related records

---

## Account Recovery Scripts

### `check_owner_account.sql`
**Purpose**: Check if an owner/admin account exists in both `users` and `auth.users` tables.

**Usage**: Replace `YOUR_OWNER_EMAIL_HERE` with the actual owner email and run in Supabase SQL Editor.

### `restore_owner_account.sql`
**Purpose**: Comprehensive diagnostic and recovery script for owner accounts.

**What it does**:
- Checks if owner exists in `users` table
- Checks if owner exists in `auth.users` table
- Verifies ID matching between tables
- Checks `business_users` relationships
- Checks `user_roles` assignments
- Provides recovery options

**Usage**: 
1. Replace `OWNER_EMAIL_HERE` with the actual owner email
2. Run in Supabase SQL Editor
3. Review the diagnostic output
4. Follow the recovery options provided

**Recovery Options**:
1. **Via Supabase Dashboard**: Authentication > Users > Find user > Reset Password
2. **Via Edge Function**: Call `create-employee-auth` with method "password"
3. **Manual SQL**: If account exists in `users` but not `auth.users`, recreate via Dashboard

---

## Related Files

- `pos_loyalty_accounts_rls_fix_public_insert.sql` - RLS policy fixes
- `waivers_storage_policies_fix_public_insert.sql` - Storage policy fixes
- `waivers_rls_participants_fix_public_insert.sql` - Waiver RLS fixes
- `waivers_rls_participants_policies.sql` - Waiver participant policies

