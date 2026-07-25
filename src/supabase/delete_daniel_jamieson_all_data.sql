-- ============================================
-- DELETE ALL DATA FOR DANIEL JAMIESON
-- ============================================
-- This script deletes all records related to Daniel Jamieson
-- Based on actual foreign key constraints in the database
-- Run this in Supabase SQL Editor
--
-- DOCUMENTATION: See UTILITY_SCRIPTS_README.md in this directory
-- for detailed information about this script and how to adapt it
-- for other users.
-- ============================================

DO $$
DECLARE
    user_ids UUID[];
    user_id_val UUID;
    auth_user_id UUID;
    user_email_val TEXT;
BEGIN
    -- Find all user IDs matching Daniel Jamieson (by name or email)
    SELECT ARRAY_AGG(id) INTO user_ids
    FROM users
    WHERE 
        (LOWER(first_name || ' ' || last_name) LIKE '%daniel%jamieson%' OR
         LOWER(first_name || ' ' || last_name) LIKE '%jamieson%daniel%' OR
         LOWER(full_name) LIKE '%daniel%jamieson%' OR
         LOWER(full_name) LIKE '%jamieson%daniel%' OR
         LOWER(email) LIKE '%daniel%jamieson%' OR
         LOWER(email) LIKE '%jamieson%')
        AND (LOWER(first_name) LIKE '%daniel%' OR LOWER(last_name) LIKE '%jamieson%');
    
    IF user_ids IS NULL OR array_length(user_ids, 1) = 0 THEN
        RAISE NOTICE 'No users found matching Daniel Jamieson';
        RETURN;
    END IF;
    
    RAISE NOTICE 'Found % user(s) matching Daniel Jamieson', array_length(user_ids, 1);
    
    -- Process each user ID
    FOREACH user_id_val IN ARRAY user_ids
    LOOP
        RAISE NOTICE 'Processing user ID: %', user_id_val;
        
        -- Get email before deletion
        SELECT email INTO user_email_val FROM users WHERE id = user_id_val;
        
        -- Find auth user ID
        SELECT id INTO auth_user_id
        FROM auth.users
        WHERE email = COALESCE(user_email_val, '')
        LIMIT 1;
        
        -- ============================================
        -- DELETE FROM ALL TABLES WITH FOREIGN KEYS
        -- Order matters: delete from child tables first
        -- ============================================
        
        -- Bookings
        BEGIN
            DELETE FROM bookings WHERE approved_by = user_id_val OR created_by = user_id_val;
            RAISE NOTICE 'Deleted from bookings';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'bookings: %', SQLERRM;
        END;
        
        -- Contract-related tables
        BEGIN
            DELETE FROM contract_amendments WHERE approved_by = user_id_val OR created_by = user_id_val OR employee_id = user_id_val;
            RAISE NOTICE 'Deleted from contract_amendments';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'contract_amendments: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM contract_compliance WHERE created_by = user_id_val OR employee_id = user_id_val OR resolved_by = user_id_val;
            RAISE NOTICE 'Deleted from contract_compliance';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'contract_compliance: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM contract_files WHERE employee_id = user_id_val OR uploaded_by = user_id_val;
            RAISE NOTICE 'Deleted from contract_files';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'contract_files: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM contract_notifications WHERE acknowledged_by = user_id_val OR user_id = user_id_val;
            RAISE NOTICE 'Deleted from contract_notifications';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'contract_notifications: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM contract_templates WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from contract_templates';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'contract_templates: %', SQLERRM;
        END;
        
        -- Customer display & digital signage
        BEGIN
            DELETE FROM customer_display_ads WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from customer_display_ads';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'customer_display_ads: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM digital_signage_ad_campaigns WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from digital_signage_ad_campaigns';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'digital_signage_ad_campaigns: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM digital_signage_ads WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from digital_signage_ads';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'digital_signage_ads: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM digital_signage_content WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from digital_signage_content';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'digital_signage_content: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM digital_signage_content_versions WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from digital_signage_content_versions';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'digital_signage_content_versions: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM digital_signage_schedule_conflicts WHERE resolved_by = user_id_val;
            RAISE NOTICE 'Deleted from digital_signage_schedule_conflicts';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'digital_signage_schedule_conflicts: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM digital_signage_schedules WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from digital_signage_schedules';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'digital_signage_schedules: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM digital_signage_screen_groups WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from digital_signage_screen_groups';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'digital_signage_screen_groups: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM digital_signage_screens WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from digital_signage_screens';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'digital_signage_screens: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM digital_signage_templates WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from digital_signage_templates';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'digital_signage_templates: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM digital_signage_zones WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from digital_signage_zones';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'digital_signage_zones: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM digital_signatures WHERE invalidated_by = user_id_val OR user_id = user_id_val;
            RAISE NOTICE 'Deleted from digital_signatures';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'digital_signatures: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM dining_tables WHERE assigned_server_id = user_id_val;
            RAISE NOTICE 'Deleted from dining_tables';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'dining_tables: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM email_receiving_config WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from email_receiving_config';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'email_receiving_config: %', SQLERRM;
        END;
        
        -- Employee-related tables
        BEGIN
            DELETE FROM employee_audit_trail WHERE changed_by = user_id_val OR user_id = user_id_val;
            RAISE NOTICE 'Deleted from employee_audit_trail';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'employee_audit_trail: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM employee_certificates WHERE employee_id = user_id_val;
            RAISE NOTICE 'Deleted from employee_certificates';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'employee_certificates: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM employee_documents WHERE employee_id = user_id_val OR verified_by = user_id_val;
            RAISE NOTICE 'Deleted from employee_documents';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'employee_documents: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM employee_sin_numbers WHERE created_by = user_id_val OR employee_id = user_id_val OR updated_by = user_id_val;
            RAISE NOTICE 'Deleted from employee_sin_numbers';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'employee_sin_numbers: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM hierarchy_layers WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from hierarchy_layers';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hierarchy_layers: %', SQLERRM;
        END;
        
        -- HR Contract tables
        BEGIN
            DELETE FROM hr_contract_notifications WHERE employee_id = user_id_val;
            RAISE NOTICE 'Deleted from hr_contract_notifications';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hr_contract_notifications: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM hr_contract_versions WHERE amended_by = user_id_val OR manager_approved_by = user_id_val;
            RAISE NOTICE 'Deleted from hr_contract_versions';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hr_contract_versions: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM hr_contracts WHERE created_by = user_id_val OR employee_id = user_id_val OR manager_id = user_id_val OR uploaded_by = user_id_val;
            RAISE NOTICE 'Deleted from hr_contracts (by user_id)';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hr_contracts (by user_id): %', SQLERRM;
        END;
        
        IF user_email_val IS NOT NULL THEN
            BEGIN
                DELETE FROM hr_contracts WHERE employee_email = user_email_val;
                RAISE NOTICE 'Deleted from hr_contracts (by email)';
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'hr_contracts (by email): %', SQLERRM;
            END;
        END IF;
        
        BEGIN
            DELETE FROM hr_policy_assignments WHERE employee_id = user_id_val;
            RAISE NOTICE 'Deleted from hr_policy_assignments';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hr_policy_assignments: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM hr_termination_templates WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from hr_termination_templates';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hr_termination_templates: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM hr_terminations WHERE created_by = user_id_val OR employee_id = user_id_val;
            RAISE NOTICE 'Deleted from hr_terminations';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hr_terminations: %', SQLERRM;
        END;
        
        -- Payroll tables
        BEGIN
            DELETE FROM hrpayroll_employee_premiums WHERE user_id = user_id_val;
            RAISE NOTICE 'Deleted from hrpayroll_employee_premiums';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hrpayroll_employee_premiums: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM hrpayroll_entries WHERE created_by = user_id_val OR user_id = user_id_val;
            RAISE NOTICE 'Deleted from hrpayroll_entries';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hrpayroll_entries: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM hrpayroll_lieu_time_transactions WHERE created_by = user_id_val OR user_id = user_id_val;
            RAISE NOTICE 'Deleted from hrpayroll_lieu_time_transactions';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hrpayroll_lieu_time_transactions: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM hrpayroll_runs WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from hrpayroll_runs';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hrpayroll_runs: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM hrpayroll_wage_history WHERE created_by = user_id_val OR user_id = user_id_val;
            RAISE NOTICE 'Deleted from hrpayroll_wage_history';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hrpayroll_wage_history: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM hrpayroll_ytd_data WHERE user_id = user_id_val;
            RAISE NOTICE 'Deleted from hrpayroll_ytd_data';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'hrpayroll_ytd_data: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM ingredients WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from ingredients';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'ingredients: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM mailboxes WHERE assigned_to_employee_id = user_id_val OR assigned_to_user_id = user_id_val OR created_by = user_id_val;
            RAISE NOTICE 'Deleted from mailboxes';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'mailboxes: %', SQLERRM;
        END;
        
        -- Music v2 tables
        BEGIN
            DELETE FROM music_v2_ad_campaigns WHERE advertiser_id = user_id_val OR approved_by = user_id_val;
            RAISE NOTICE 'Deleted from music_v2_ad_campaigns';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'music_v2_ad_campaigns: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM music_v2_global_tracks WHERE approved_by = user_id_val OR uploaded_by = user_id_val;
            RAISE NOTICE 'Deleted from music_v2_global_tracks';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'music_v2_global_tracks: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM music_v2_issue_reports WHERE action_taken_by = user_id_val OR reported_by = user_id_val;
            RAISE NOTICE 'Deleted from music_v2_issue_reports';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'music_v2_issue_reports: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM music_v2_location_blacklist WHERE blocked_by = user_id_val;
            RAISE NOTICE 'Deleted from music_v2_location_blacklist';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'music_v2_location_blacklist: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM position_premium_rules WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from position_premium_rules';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'position_premium_rules: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM positions WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from positions';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'positions: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM rb_margin_tiers WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from rb_margin_tiers';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'rb_margin_tiers: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM rb_order_guides WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from rb_order_guides';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'rb_order_guides: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM rb_shrinkage_logs WHERE reported_by = user_id_val;
            RAISE NOTICE 'Deleted from rb_shrinkage_logs';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'rb_shrinkage_logs: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM rb_suppliers WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from rb_suppliers';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'rb_suppliers: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM role_templates WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from role_templates';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'role_templates: %', SQLERRM;
        END;
        
        -- Scheduling tables
        BEGIN
            DELETE FROM scheduling_availability WHERE employee_id = user_id_val;
            RAISE NOTICE 'Deleted from scheduling_availability';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'scheduling_availability: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM scheduling_break_tracking WHERE employee_id = user_id_val;
            RAISE NOTICE 'Deleted from scheduling_break_tracking';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'scheduling_break_tracking: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM scheduling_compliance_logs WHERE employee_id = user_id_val OR resolved_by = user_id_val;
            RAISE NOTICE 'Deleted from scheduling_compliance_logs';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'scheduling_compliance_logs: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM scheduling_events WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from scheduling_events';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'scheduling_events: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM scheduling_notifications WHERE employee_id = user_id_val;
            RAISE NOTICE 'Deleted from scheduling_notifications';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'scheduling_notifications: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM scheduling_shift_swaps WHERE created_by = user_id_val OR employee_id = user_id_val OR swap_with_employee_id = user_id_val;
            RAISE NOTICE 'Deleted from scheduling_shift_swaps';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'scheduling_shift_swaps: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM scheduling_shifts WHERE assigned_by = user_id_val OR created_by = user_id_val OR employee_id = user_id_val OR picked_up_by = user_id_val OR published_by = user_id_val OR updated_by = user_id_val;
            RAISE NOTICE 'Deleted from scheduling_shifts';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'scheduling_shifts: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM scheduling_time_clock WHERE adjusted_by = user_id_val OR employee_id = user_id_val;
            RAISE NOTICE 'Deleted from scheduling_time_clock';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'scheduling_time_clock: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM scheduling_time_clocks WHERE adjusted_by = user_id_val OR employee_id = user_id_val;
            RAISE NOTICE 'Deleted from scheduling_time_clocks';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'scheduling_time_clocks: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM scheduling_time_clocks_audit WHERE changed_by = user_id_val;
            RAISE NOTICE 'Deleted from scheduling_time_clocks_audit';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'scheduling_time_clocks_audit: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM scheduling_time_off WHERE approved_by = user_id_val OR denied_by = user_id_val OR employee_id = user_id_val OR requested_by = user_id_val;
            RAISE NOTICE 'Deleted from scheduling_time_off';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'scheduling_time_off: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM scheduling_timesheets WHERE approved_by = user_id_val OR employee_id = user_id_val OR submitted_by = user_id_val;
            RAISE NOTICE 'Deleted from scheduling_timesheets';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'scheduling_timesheets: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM user_recent_activity WHERE user_id = user_id_val;
            RAISE NOTICE 'Deleted from user_recent_activity';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'user_recent_activity: %', SQLERRM;
        END;
        
        -- User roles and business users (must be before users deletion)
        DELETE FROM user_roles WHERE user_id = user_id_val;
        IF auth_user_id IS NOT NULL THEN
            DELETE FROM user_roles WHERE user_id = auth_user_id;
        END IF;
        RAISE NOTICE 'Deleted from user_roles';
        
        DELETE FROM business_users WHERE user_id = user_id_val;
        IF auth_user_id IS NOT NULL THEN
            DELETE FROM business_users WHERE user_id = auth_user_id;
        END IF;
        RAISE NOTICE 'Deleted from business_users';
        
        -- Users table self-reference (manager_id, wage_updated_by)
        BEGIN
            UPDATE users SET manager_id = NULL WHERE manager_id = user_id_val;
            UPDATE users SET wage_updated_by = NULL WHERE wage_updated_by = user_id_val;
            RAISE NOTICE 'Updated users table self-references';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'users self-references: %', SQLERRM;
        END;
        
        -- Waiver tables
        BEGIN
            DELETE FROM waiver_audit_log WHERE performed_by = user_id_val;
            RAISE NOTICE 'Deleted from waiver_audit_log';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'waiver_audit_log: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM waiver_templates WHERE created_by = user_id_val;
            RAISE NOTICE 'Deleted from waiver_templates';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'waiver_templates: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM waiver_uploads WHERE uploaded_by = user_id_val;
            RAISE NOTICE 'Deleted from waiver_uploads';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'waiver_uploads: %', SQLERRM;
        END;
        
        -- Audit logs
        BEGIN
            DELETE FROM audit_logs WHERE user_id = user_id_val;
            IF auth_user_id IS NOT NULL THEN
                DELETE FROM audit_logs WHERE user_id = auth_user_id;
            END IF;
            RAISE NOTICE 'Deleted from audit_logs';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'audit_logs: %', SQLERRM;
        END;
        
        -- Businesses (set created_by to NULL instead of deleting)
        BEGIN
            UPDATE businesses SET created_by = NULL WHERE created_by = user_id_val;
            RAISE NOTICE 'Updated businesses.created_by to NULL';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'businesses: %', SQLERRM;
        END;
        
        -- Auth-related tables (if they exist)
        BEGIN
            DELETE FROM identities WHERE user_id = user_id_val OR (auth_user_id IS NOT NULL AND user_id = auth_user_id);
            RAISE NOTICE 'Deleted from identities';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'identities: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM mfa_factors WHERE user_id = user_id_val OR (auth_user_id IS NOT NULL AND user_id = auth_user_id);
            RAISE NOTICE 'Deleted from mfa_factors';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'mfa_factors: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM one_time_tokens WHERE user_id = user_id_val OR (auth_user_id IS NOT NULL AND user_id = auth_user_id);
            RAISE NOTICE 'Deleted from one_time_tokens';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'one_time_tokens: %', SQLERRM;
        END;
        
        BEGIN
            DELETE FROM sessions WHERE user_id = user_id_val OR (auth_user_id IS NOT NULL AND user_id = auth_user_id);
            RAISE NOTICE 'Deleted from sessions';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'sessions: %', SQLERRM;
        END;
        
        -- Finally, delete from users table
        DELETE FROM users WHERE id = user_id_val;
        RAISE NOTICE 'Deleted from users table';
        
        -- Delete from auth.users (if exists)
        IF auth_user_id IS NOT NULL THEN
            BEGIN
                DELETE FROM auth.users WHERE id = auth_user_id;
                RAISE NOTICE 'Deleted auth user: %', auth_user_id;
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Could not delete auth user: %', SQLERRM;
            END;
        END IF;
        
        RAISE NOTICE 'Completed deletion for user ID: %', user_id_val;
    END LOOP;
    
    RAISE NOTICE 'Deletion complete for all matching users';
END $$;
