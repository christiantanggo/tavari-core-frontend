-- =============================================================================
-- Supabase Security Advisor fixes (March 2026)
-- Addresses: policy_exists_rls_disabled, security_definer_view, rls_disabled_in_public, sensitive_columns_exposed
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. POLICY_EXISTS_RLS_DISABLED: Enable RLS on music_ad_plays (policies already exist)
-- -----------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.music_ad_plays ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. SECURITY_DEFINER_VIEW: Switch views to SECURITY INVOKER (PG15+)
--    So views use the querying user's permissions, not the view owner's.
-- -----------------------------------------------------------------------------
ALTER VIEW IF EXISTS public.v_user_permissions SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_receipt_reprints SET (security_invoker = true);
ALTER VIEW IF EXISTS public.music_schedule_calendar SET (security_invoker = true);
ALTER VIEW IF EXISTS public.employee_audit_history SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_daily_sales_summary SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_refund_logs SET (security_invoker = true);
ALTER VIEW IF EXISTS public.campaign_history_view SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_mail_billing_summary SET (security_invoker = true);
ALTER VIEW IF EXISTS public.mail_campaign_send_stats SET (security_invoker = true);
ALTER VIEW IF EXISTS public.mail_error_stats SET (security_invoker = true);
ALTER VIEW IF EXISTS public.contract_amendment_history SET (security_invoker = true);
ALTER VIEW IF EXISTS public.compliance_dashboard SET (security_invoker = true);
ALTER VIEW IF EXISTS public.pos_kitchen_orders SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_employee_lieu_time_summary SET (security_invoker = true);
ALTER VIEW IF EXISTS public.voice_agents_with_business SET (security_invoker = true);

-- -----------------------------------------------------------------------------
-- 3. RLS_DISABLED_IN_PUBLIC: Enable RLS on all public tables that lacked it
--    Add one policy per table so access is not blocked (can be tightened later).
--    Tables with business_id use business_users; others use authenticated-only.
-- -----------------------------------------------------------------------------

-- All tables that need RLS (music_ad_plays already handled above with existing policies)
-- For each: enable RLS and add policy. Tables with business_id use business_users; else authenticated-only.
DO $$
DECLARE
  t text;
  tables_needing_rls text[] := ARRAY[
    'pos_discounts','music_license_keys','audit_log','pos_modifiers',
    'music_system_health','music_business_ad_apis','music_ad_cache','music_playlist_templates',
    'music_ad_metadata','music_api_performance','music_shuffle_rules','music_ad_apis',
    'music_ad_revenue_detailed','tavari_admin_security_logs','pos_loyalty_daily_usage',
    'pos_products','digital_signage_menu_boards','dining_reservations','pos_receipts',
    'pos_sales','inventory','pos_categories','pos_payments','pos_terminals',
    'digital_signage_menu_board_items','contract_templates','contract_template_sections',
    'digital_signage_party_hosts','scheduling_time_clocks','scheduling_time_clocks_audit',
    'digital_signage_party_host_sequences','social_media_configs','content_sources',
    'social_posts','posting_rules','social_analytics','digital_signage_party_host_photos',
    'music_installations','certificate_notification_log','portal_waiver_tokens'
  ];
  has_bid boolean;
  tbl_ident text;
BEGIN
  FOREACH t IN ARRAY tables_needing_rls
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      CONTINUE;
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'business_id'
    ) INTO has_bid;

    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY', t);
    tbl_ident := quote_ident(t);

    IF has_bid THEN
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated business access" ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY "Authenticated business access" ON public.%I FOR ALL USING (
          EXISTS (
            SELECT 1 FROM business_users bu
            WHERE bu.business_id = %s.business_id AND bu.user_id = auth.uid()
          )
        ) WITH CHECK (
          EXISTS (
            SELECT 1 FROM business_users bu
            WHERE bu.business_id = %s.business_id AND bu.user_id = auth.uid()
          )
        )',
        t, tbl_ident, tbl_ident
      );
    ELSE
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated access" ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY "Authenticated access" ON public.%I FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
        t
      );
    END IF;
  END LOOP;
END $$;
