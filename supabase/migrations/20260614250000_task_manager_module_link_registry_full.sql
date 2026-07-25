-- Expand task module link registry to all dashboard pages (sync with src/helpers/taskManagerModuleLinks.js).

CREATE TABLE IF NOT EXISTS public.task_manager_module_link_registry (
  key text PRIMARY KEY,
  module_group text NOT NULL,
  label text NOT NULL,
  button_label text NOT NULL,
  path text NOT NULL,
  permission_keys text[] NOT NULL DEFAULT '{}'::text[],
  allow_roles text[] NULL
);

TRUNCATE public.task_manager_module_link_registry;

INSERT INTO public.task_manager_module_link_registry (
  key, module_group, label, button_label, path, permission_keys, allow_roles
) VALUES
  ('core.customers', 'Core', 'Customers', 'Open Customers', '/dashboard/pos/customers', '{"pos.customers.view","pos.customers.edit"}'::text[], NULL),
  ('core.employees', 'Core', 'Employees', 'Open Employees', '/dashboard/employees', '{"hr.employees.view","hr.employees.edit","hr.employees.view_all"}'::text[], NULL),
  ('core.reports', 'Core', 'Reports Dashboard', 'Open Reports Dashboard', '/dashboard/reports', '{"reports.dashboard.view","reports.dashboard.edit"}'::text[], NULL),
  ('core.report_automation', 'Core', 'Report Automation', 'Open Report Automation', '/dashboard/reports/automation', '{"reports.automation.view","reports.automation.edit"}'::text[], NULL),
  ('core.audit_logs', 'Core', 'Audit Log Viewer', 'Open Audit Log Viewer', '/dashboard/audit-logs', '{"reports.audit.view"}'::text[], NULL),
  ('pos.register', 'POS', 'Register', 'Open Register', '/dashboard/pos/register', '{"pos.register.view","pos.register.edit"}'::text[], NULL),
  ('pos.inventory', 'POS', 'Inventory Management', 'Open Inventory Management', '/dashboard/pos/inventory', '{"pos.inventory.view","pos.inventory.edit","pos.categories.view","pos.modifiers.view"}'::text[], NULL),
  ('pos.discounts', 'POS', 'Discounts', 'Open Discounts', '/dashboard/pos/discounts', '{"pos.discounts.view","pos.discounts.edit"}'::text[], NULL),
  ('pos.receipts', 'POS', 'Receipts', 'Open Receipts', '/dashboard/pos/receipts', '{"pos.receipts.view","pos.receipts.edit"}'::text[], NULL),
  ('pos.settings', 'POS', 'Settings', 'Open Settings', '/dashboard/pos/settings', '{"pos.settings.view","pos.settings.edit"}'::text[], NULL),
  ('pos.stations', 'POS', 'Stations', 'Open Stations', '/dashboard/pos/stations', '{"pos.stations.view","pos.stations.edit"}'::text[], NULL),
  ('pos.kitchen_display', 'POS', 'Kitchen Display', 'Open Kitchen Display', '/dashboard/pos/kitchen-display', '{"pos.kitchen_display.view","pos.kitchen_display.edit"}'::text[], NULL),
  ('pos.daily_deposit', 'POS', 'Daily Deposit', 'Open Daily Deposit', '/dashboard/pos/daily-deposit', '{"pos.daily_deposit.view","pos.daily_deposit.edit","pos.daily_deposit.create"}'::text[], NULL),
  ('pos.loyalty', 'POS', 'Loyalty', 'Open Loyalty', '/dashboard/pos/loyalty', '{"pos.loyalty.view","pos.loyalty.edit"}'::text[], NULL),
  ('pos.tabs', 'POS', 'Tabs', 'Open Tabs', '/dashboard/pos/tabs', '{"pos.tabs.view"}'::text[], NULL),
  ('pos.refunds', 'POS', 'Refunds', 'Open Refunds', '/dashboard/pos/refunds', '{"pos.refunds.view"}'::text[], NULL),
  ('pos.reports', 'POS', 'Reports', 'Open Reports', '/dashboard/pos/reports', '{"pos.reports.view","pos.sales.view_all"}'::text[], NULL),
  ('pos.customer_display', 'POS', 'Customer Display Setup', 'Open Customer Display Setup', '/dashboard/pos/customer-display-setup', '{"pos.customer_display.view"}'::text[], NULL),
  ('pos.display_ads', 'POS', 'Display Ads', 'Open Display Ads', '/dashboard/pos/display-ads', '{"pos.display_ads.view"}'::text[], NULL),
  ('dining.dashboard', 'Dining', 'Dashboard', 'Open Dashboard', '/dashboard/dining/dashboard', '{"dining.dashboard.view","dining.dashboard.edit"}'::text[], NULL),
  ('dining.table_map', 'Dining', 'Table Map', 'Open Table Map', '/dashboard/dining/table-map', '{"dining.table_map.view","dining.table_map.edit"}'::text[], NULL),
  ('dining.floor_editor', 'Dining', 'Floor Editor', 'Open Floor Editor', '/dashboard/dining/floor-editor', '{"dining.floor_editor.view","dining.floor_editor.edit"}'::text[], NULL),
  ('dining.reservations', 'Dining', 'Reservations', 'Open Reservations', '/dashboard/dining/reservations', '{"dining.reservations.view","dining.reservations.edit"}'::text[], NULL),
  ('dining.table_order', 'Dining', 'Table Orders', 'Open Table Orders', '/dashboard/dining/table-order', '{"dining.table_order.view","dining.table_order.edit"}'::text[], NULL),
  ('bookings.dashboard', 'Bookings', 'Dashboard', 'Open Dashboard', '/dashboard/bookings', '{"bookings.view","bookings.view_all"}'::text[], NULL),
  ('bookings.calendar', 'Bookings', 'Calendar', 'Open Calendar', '/dashboard/bookings/calendar', '{"bookings.calendar.view","bookings.view","bookings.view_all"}'::text[], NULL),
  ('bookings.list', 'Bookings', 'Booking List', 'Open Booking List', '/dashboard/bookings/list', '{"bookings.view","bookings.view_all"}'::text[], NULL),
  ('bookings.create', 'Bookings', 'Create Booking', 'Open Create Booking', '/dashboard/bookings/create', '{"bookings.create","bookings.edit"}'::text[], NULL),
  ('bookings.check_in', 'Bookings', 'Check In', 'Open Check In', '/dashboard/bookings/check-in', '{"bookings.checkin","bookings.view"}'::text[], NULL),
  ('bookings.settings', 'Bookings', 'Settings', 'Open Settings', '/dashboard/bookings/settings', '{"bookings.settings.edit"}'::text[], NULL),
  ('waivers.dashboard', 'Waivers', 'Dashboard', 'Open Dashboard', '/dashboard/waivers', '{"waivers.view"}'::text[], NULL),
  ('waivers.search', 'Waivers', 'Search', 'Open Search', '/dashboard/waivers/search', '{"waivers.view"}'::text[], NULL),
  ('waivers.list', 'Waivers', 'Waiver List', 'Open Waiver List', '/dashboard/waivers/list', '{"waivers.view"}'::text[], NULL),
  ('waivers.templates', 'Waivers', 'Templates', 'Open Templates', '/dashboard/waivers/templates', '{"waivers.view","waivers.edit"}'::text[], NULL),
  ('waivers.upload', 'Waivers', 'Upload', 'Open Upload', '/dashboard/waivers/upload', '{"waivers.view","waivers.create"}'::text[], NULL),
  ('waivers.paper_view', 'Waivers', 'Paper Waivers', 'Open Paper Waivers', '/dashboard/waivers/paper-view', '{"waivers.view"}'::text[], NULL),
  ('waivers.settings', 'Waivers', 'Settings', 'Open Settings', '/dashboard/waivers/settings', '{"waivers.edit"}'::text[], NULL),
  ('waivers.reports', 'Waivers', 'Reports', 'Open Reports', '/dashboard/waivers/reports', '{"waivers.view"}'::text[], NULL),
  ('forms.dashboard', 'Forms', 'Forms', 'Open Forms', '/dashboard/forms', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('tasks.dashboard', 'Task Manager', 'Task Manager', 'Open Task Manager', '/dashboard/tasks', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('hr.employee_management', 'HR', 'Employee Management', 'Open Employee Management', '/dashboard/hr/employee-management', '{"hr.dashboard.view","hr.employees.view","hr.employees.view_all","hr.contracts.view","hr.documents.view","hr.writeups.view"}'::text[], NULL),
  ('hr.training', 'HR', 'Training', 'Open Training', '/dashboard/hr/training', '{"hr.onboarding.view","hr.policies.view"}'::text[], NULL),
  ('hr.communications', 'HR', 'HR Communications', 'Open HR Communications', '/dashboard/hr/communications', '{"hr.writeups.view","hr.policies.view","hr.employees.view"}'::text[], NULL),
  ('hr.payroll', 'HR', 'Payroll', 'Open Payroll', '/dashboard/hr/payroll', '{"hr.payroll.view","hr.payroll.edit"}'::text[], NULL),
  ('mail.dashboard', 'Mail', 'Dashboard', 'Open Dashboard', '/dashboard/mail/dashboard', '{"mail.dashboard.view","mail.dashboard.edit"}'::text[], NULL),
  ('mail.builder', 'Mail', 'One Time Campaigns', 'Open One Time Campaigns', '/dashboard/mail/builder', '{"mail.campaigns.view","mail.builder.view","mail.builder.edit"}'::text[], NULL),
  ('mail.automations', 'Mail', 'Automations', 'Open Automations', '/dashboard/mail/automations', '{"mail.campaigns.view","mail.campaigns.edit"}'::text[], NULL),
  ('mail.contacts', 'Mail', 'Contacts', 'Open Contacts', '/dashboard/mail/contacts', '{"mail.contacts.view","mail.contacts.edit"}'::text[], NULL),
  ('mail.billing', 'Mail', 'Usage', 'Open Usage', '/dashboard/mail/billing', '{"mail.billing.view","mail.billing.edit"}'::text[], NULL),
  ('mail.settings', 'Mail', 'Settings', 'Open Settings', '/dashboard/mail/settings', '{"mail.settings.view","mail.settings.edit"}'::text[], NULL),
  ('mail.compliance', 'Mail', 'Compliance', 'Open Compliance', '/dashboard/mail/compliance', '{"mail.compliance.view","mail.compliance.edit"}'::text[], NULL),
  ('mail.logs', 'Mail', 'Send Logs', 'Open Send Logs', '/dashboard/mail/logs', '{"mail.logs.view"}'::text[], NULL),
  ('mail.performance', 'Mail', 'Performance', 'Open Performance', '/dashboard/mail/performance', '{"mail.performance.view"}'::text[], NULL),
  ('inbox.dashboard', 'Inbox', 'Dashboard', 'Open Dashboard', '/dashboard/inbox', '{"inbox.dashboard.view","inbox.dashboard.edit"}'::text[], NULL),
  ('music.dashboard', 'Music', 'Dashboard', 'Open Dashboard', '/dashboard/music/dashboard', '{"music.dashboard.view","music.dashboard.edit"}'::text[], NULL),
  ('music.upload', 'Music', 'Upload', 'Open Upload', '/dashboard/music/upload', '{"music.upload.view","music.upload.edit"}'::text[], NULL),
  ('music.library', 'Music', 'Library', 'Open Library', '/dashboard/music/library', '{"music.library.view","music.library.edit"}'::text[], NULL),
  ('music.playlists', 'Music', 'Playlists', 'Open Playlists', '/dashboard/music/playlists', '{"music.playlists.view","music.playlists.edit"}'::text[], NULL),
  ('music.schedules', 'Music', 'Schedules', 'Open Schedules', '/dashboard/music/schedules', '{"music.schedules.view","music.schedules.edit"}'::text[], NULL),
  ('music.system_monitor', 'Music', 'System Monitor', 'Open System Monitor', '/dashboard/music/system-monitor', '{"music.system_monitor.view","music.system_monitor.edit"}'::text[], NULL),
  ('music.ads_dashboard', 'Music', 'Ad Dashboard', 'Open Ad Dashboard', '/dashboard/music/ads/dashboard', '{"music.ads.view","music.ads.edit"}'::text[], NULL),
  ('music.ads_settings', 'Music', 'Ad Settings', 'Open Ad Settings', '/dashboard/music/ads/settings', '{"music.ads.view","music.ads.edit"}'::text[], NULL),
  ('music.ads_revenue', 'Music', 'Ad Revenue', 'Open Ad Revenue', '/dashboard/music/ads/revenue', '{"music.ads.view","music.ads.view_revenue"}'::text[], NULL),
  ('music.v2_dashboard', 'Music', 'Music V2 Dashboard', 'Open Music V2 Dashboard', '/dashboard/music/v2/dashboard', '{"music.dashboard.view","music.dashboard.edit"}'::text[], NULL),
  ('music.v2_settings', 'Music', 'Music V2 Settings', 'Open Music V2 Settings', '/dashboard/music/v2/settings', '{"music.settings.view","music.settings.edit"}'::text[], NULL),
  ('accounting.overview', 'Accounting', 'Overview', 'Open Overview', '/dashboard/accounting', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('accounting.queue', 'Accounting', 'Queue', 'Open Queue', '/dashboard/accounting/queue', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('accounting.reports', 'Accounting', 'Reports', 'Open Reports', '/dashboard/accounting/reports', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('accounting.bank_transactions', 'Accounting', 'Bank Transactions', 'Open Bank Transactions', '/dashboard/accounting/bank-transactions', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('accounting.vendors', 'Accounting', 'Vendors', 'Open Vendors', '/dashboard/accounting/vendors', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('accounting.categories', 'Accounting', 'Categories', 'Open Categories', '/dashboard/accounting/categories', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('accounting.activity', 'Accounting', 'Activity', 'Open Activity', '/dashboard/accounting/activity', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('accounting.settings', 'Accounting', 'Settings', 'Open Settings', '/dashboard/accounting/settings', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('file_storage.dashboard', 'File Storage', 'Dashboard', 'Open Dashboard', '/dashboard/file-storage', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('file_storage.paper_forms', 'File Storage', 'Paper Forms', 'Open Paper Forms', '/dashboard/file-storage/paper-forms', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('scheduling.dashboard', 'Scheduling', 'Scheduling', 'Open Scheduling', '/dashboard/scheduling', '{"hr.scheduling.view","hr.scheduling.edit","settings.scheduling.view"}'::text[], NULL),
  ('digital_signage.dashboard', 'Digital Signage', 'Dashboard', 'Open Dashboard', '/dashboard/digital-signage', '{"digital_signage.dashboard.view","digital_signage.screens.view"}'::text[], NULL),
  ('digital_signage.screens', 'Digital Signage', 'Screens', 'Open Screens', '/dashboard/digital-signage/screens', '{"digital_signage.screens.view"}'::text[], NULL),
  ('digital_signage.content', 'Digital Signage', 'Content Library', 'Open Content Library', '/dashboard/digital-signage/content', '{"digital_signage.content.view"}'::text[], NULL),
  ('digital_signage.schedules', 'Digital Signage', 'Schedules', 'Open Schedules', '/dashboard/digital-signage/schedules', '{"digital_signage.schedules.view"}'::text[], NULL),
  ('digital_signage.zones', 'Digital Signage', 'Zones', 'Open Zones', '/dashboard/digital-signage/zones', '{"digital_signage.zones.view"}'::text[], NULL),
  ('digital_signage.ads', 'Digital Signage', 'Ads', 'Open Ads', '/dashboard/digital-signage/ads', '{"digital_signage.ads.view"}'::text[], NULL),
  ('digital_signage.menu_boards', 'Digital Signage', 'Menu Boards', 'Open Menu Boards', '/dashboard/digital-signage/menu-boards', '{"digital_signage.menu_boards.view"}'::text[], NULL),
  ('digital_signage.analytics', 'Digital Signage', 'Analytics', 'Open Analytics', '/dashboard/digital-signage/analytics', '{"digital_signage.analytics.view"}'::text[], NULL),
  ('social_media.dashboard', 'Social Media', 'Dashboard', 'Open Dashboard', '/dashboard/social-media', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('voice_agent.dashboard', 'Voice Agent', 'Dashboard', 'Open Dashboard', '/dashboard/voice-agent', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('custom_voice_agent.dashboard', 'Custom Voice Agent', 'Dashboard', 'Open Dashboard', '/dashboard/custom-voice-agent', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('reputation.dashboard', 'Reputation', 'Dashboard', 'Open Dashboard', '/dashboard/reputation', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('reminders.dashboard', 'Reminders', 'Dashboard', 'Open Dashboard', '/dashboard/reminders', '{"reminders.dashboard.view","reminders.dashboard.edit"}'::text[], NULL),
  ('tavari_apis.dashboard', 'Tavari APIs', 'Dashboard', 'Open Dashboard', '/dashboard/tavari-apis', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('vending.dashboard', 'Vending', 'Dashboard', 'Open Dashboard', '/dashboard/vending', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('power_bank.dashboard', 'Power Bank', 'Dashboard', 'Open Dashboard', '/dashboard/power-bank', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('liquor.inventory', 'Liquor', 'Inventory', 'Open Inventory', '/dashboard/liquor/inventory', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('recipe_builder.dashboard', 'Recipe Builder', 'Recipe Builder', 'Open Recipe Builder', '/dashboard/recipe-builder', '{""}'::text[], '{"owner","admin","manager"}'::text[]),
  ('appbuilder.dashboard', 'App Builder', 'Dashboard', 'Open Dashboard', '/dashboard/appbuilder', '{"appbuilder.branding.view","appbuilder.modules.view","appbuilder.build.view"}'::text[], NULL),
  ('appbuilder.branding', 'App Builder', 'Branding', 'Open Branding', '/dashboard/appbuilder/branding', '{"appbuilder.branding.view","appbuilder.branding.edit"}'::text[], NULL),
  ('appbuilder.modules', 'App Builder', 'Modules', 'Open Modules', '/dashboard/appbuilder/modules', '{"appbuilder.modules.view","appbuilder.modules.toggle"}'::text[], NULL),
  ('appbuilder.builds', 'App Builder', 'Builds', 'Open Builds', '/dashboard/appbuilder/builds', '{"appbuilder.build.view","appbuilder.build.create"}'::text[], NULL),
  ('appbuilder.deployments', 'App Builder', 'Deployments', 'Open Deployments', '/dashboard/appbuilder/deployments', '{"appbuilder.deploy.view","appbuilder.deploy.manage"}'::text[], NULL),
  ('appbuilder.analytics', 'App Builder', 'Analytics', 'Open Analytics', '/dashboard/appbuilder/analytics', '{"appbuilder.analytics.view","appbuilder.analytics.export"}'::text[], NULL),
  ('invoices.dashboard', 'Invoices', 'Invoices', 'Open Invoices', '/dashboard/invoices', '{"invoices.view","invoices.create"}'::text[], NULL)
ON CONFLICT (key) DO UPDATE SET
  module_group = EXCLUDED.module_group,
  label = EXCLUDED.label,
  button_label = EXCLUDED.button_label,
  path = EXCLUDED.path,
  permission_keys = EXCLUDED.permission_keys,
  allow_roles = EXCLUDED.allow_roles;

CREATE OR REPLACE FUNCTION public.task_manager_module_link_def(p_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'path', r.path,
    'button_label', r.button_label,
    'permission_keys', to_jsonb(r.permission_keys),
    'allow_roles', to_jsonb(COALESCE(r.allow_roles, ARRAY[]::text[]))
  )
  FROM public.task_manager_module_link_registry r
  WHERE r.key = p_key;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_module_link_allowed(
  p_business_id uuid,
  p_employee_id uuid,
  p_module_link_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_def jsonb;
  v_keys text[];
  v_allow_roles text[];
  v_role text;
BEGIN
  IF p_module_link_key IS NULL OR length(trim(p_module_link_key)) = 0 THEN
    RETURN false;
  END IF;

  v_def := public.task_manager_module_link_def(p_module_link_key);
  IF v_def IS NULL THEN
    RETURN false;
  END IF;

  SELECT array_agg(value::text)
  INTO v_allow_roles
  FROM jsonb_array_elements_text(v_def->'allow_roles') AS value
  WHERE length(value) > 0;

  IF v_allow_roles IS NOT NULL AND cardinality(v_allow_roles) > 0 THEN
    v_role := public.user_business_role(p_business_id, p_employee_id);
    IF v_role = 'owner' OR v_role = ANY(v_allow_roles) THEN
      RETURN true;
    END IF;
  END IF;

  SELECT array_agg(value::text)
  INTO v_keys
  FROM jsonb_array_elements_text(v_def->'permission_keys') AS value
  WHERE length(value) > 0;

  IF v_keys IS NOT NULL AND cardinality(v_keys) > 0 THEN
    RETURN public.user_has_any_business_permission(p_business_id, p_employee_id, v_keys);
  END IF;

  RETURN false;
END;
$$;

GRANT SELECT ON public.task_manager_module_link_registry TO anon, authenticated;
