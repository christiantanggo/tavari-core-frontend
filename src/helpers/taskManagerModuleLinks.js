/**
 * Registry of in-app Tavari dashboard pages staff can open from Task Manager / kiosk tasks.
 * Keep in sync with task_manager_module_link_registry (Supabase) via scripts/generate-module-link-registry-sql.cjs
 */

/** @typedef {{ key: string, moduleGroup: string, label: string, buttonLabel: string, path: string, permissionKeys: string[], allowRoles?: string[] | null }} TaskManagerModuleLink */

/**
 * @param {string} key
 * @param {string} moduleGroup
 * @param {string} label
 * @param {string} path
 * @param {string[]} [permissionKeys]
 * @param {string[] | null} [allowRoles]
 * @returns {TaskManagerModuleLink}
 */
const link = (key, moduleGroup, label, path, permissionKeys = [], allowRoles = null) => ({
  key,
  moduleGroup,
  label,
  buttonLabel: `Open ${label}`,
  path,
  permissionKeys,
  allowRoles
});

/** @type {TaskManagerModuleLink[]} */
export const TASK_MANAGER_MODULE_LINKS = [
  // Core
  link('core.customers', 'Core', 'Customers', '/dashboard/pos/customers', ['pos.customers.view', 'pos.customers.edit']),
  link('core.employees', 'Core', 'Employees', '/dashboard/employees', ['hr.employees.view', 'hr.employees.edit', 'hr.employees.view_all']),
  link('core.reports', 'Core', 'Reports Dashboard', '/dashboard/reports', ['reports.dashboard.view', 'reports.dashboard.edit']),
  link('core.report_automation', 'Core', 'Report Automation', '/dashboard/reports/automation', ['reports.automation.view', 'reports.automation.edit']),
  link('core.audit_logs', 'Core', 'Audit Log Viewer', '/dashboard/audit-logs', ['reports.audit.view']),

  // POS
  link('pos.register', 'POS', 'Register', '/dashboard/pos/register', ['pos.register.view', 'pos.register.edit']),
  link('pos.inventory', 'POS', 'Inventory Management', '/dashboard/pos/inventory', ['pos.inventory.view', 'pos.inventory.edit', 'pos.categories.view', 'pos.modifiers.view']),
  link('pos.discounts', 'POS', 'Discounts', '/dashboard/pos/discounts', ['pos.discounts.view', 'pos.discounts.edit']),
  link('pos.receipts', 'POS', 'Receipts', '/dashboard/pos/receipts', ['pos.receipts.view', 'pos.receipts.edit']),
  link('pos.settings', 'POS', 'Settings', '/dashboard/pos/settings', ['pos.settings.view', 'pos.settings.edit']),
  link('pos.stations', 'POS', 'Stations', '/dashboard/pos/stations', ['pos.stations.view', 'pos.stations.edit']),
  link('pos.kitchen_display', 'POS', 'Kitchen Display', '/dashboard/pos/kitchen-display', ['pos.kitchen_display.view', 'pos.kitchen_display.edit']),
  link('pos.daily_deposit', 'POS', 'Daily Deposit', '/dashboard/pos/daily-deposit', ['pos.daily_deposit.view', 'pos.daily_deposit.edit', 'pos.daily_deposit.create']),
  link('pos.loyalty', 'POS', 'Loyalty', '/dashboard/pos/loyalty', ['pos.loyalty.view', 'pos.loyalty.edit']),
  link('pos.tabs', 'POS', 'Tabs', '/dashboard/pos/tabs', ['pos.tabs.view']),
  link('pos.refunds', 'POS', 'Refunds', '/dashboard/pos/refunds', ['pos.refunds.view']),
  link('pos.reports', 'POS', 'Reports', '/dashboard/pos/reports', ['pos.reports.view', 'pos.sales.view_all']),
  link('pos.customer_display', 'POS', 'Customer Display Setup', '/dashboard/pos/customer-display-setup', ['pos.customer_display.view']),
  link('pos.display_ads', 'POS', 'Display Ads', '/dashboard/pos/display-ads', ['pos.display_ads.view']),

  // Dining
  link('dining.dashboard', 'Dining', 'Dashboard', '/dashboard/dining/dashboard', ['dining.dashboard.view', 'dining.dashboard.edit']),
  link('dining.table_map', 'Dining', 'Table Map', '/dashboard/dining/table-map', ['dining.table_map.view', 'dining.table_map.edit']),
  link('dining.floor_editor', 'Dining', 'Floor Editor', '/dashboard/dining/floor-editor', ['dining.floor_editor.view', 'dining.floor_editor.edit']),
  link('dining.reservations', 'Dining', 'Reservations', '/dashboard/dining/reservations', ['dining.reservations.view', 'dining.reservations.edit']),
  link('dining.table_order', 'Dining', 'Table Orders', '/dashboard/dining/table-order', ['dining.table_order.view', 'dining.table_order.edit']),

  // Bookings
  link('bookings.dashboard', 'Bookings', 'Dashboard', '/dashboard/bookings', ['bookings.view', 'bookings.view_all']),
  link('bookings.calendar', 'Bookings', 'Calendar', '/dashboard/bookings?tab=schedule', ['bookings.calendar.view', 'bookings.view', 'bookings.view_all']),
  link('bookings.list', 'Bookings', 'Booking List', '/dashboard/bookings?tab=list', ['bookings.view', 'bookings.view_all']),
  link('bookings.create', 'Bookings', 'Create Booking', '/dashboard/bookings/create', ['bookings.create', 'bookings.edit']),
  link('bookings.check_in', 'Bookings', 'Check In', '/dashboard/bookings/check-in', ['bookings.checkin', 'bookings.view']),
  link('bookings.settings', 'Bookings', 'Settings', '/dashboard/bookings?tab=settings', ['bookings.settings.edit']),

  // Waivers
  link('waivers.dashboard', 'Waivers', 'Dashboard', '/dashboard/waivers', ['waivers.view']),
  link('waivers.search', 'Waivers', 'Search', '/dashboard/waivers/search', ['waivers.view']),
  link('waivers.list', 'Waivers', 'Waiver List', '/dashboard/waivers/list', ['waivers.view']),
  link('waivers.templates', 'Waivers', 'Templates', '/dashboard/waivers/templates', ['waivers.view', 'waivers.edit']),
  link('waivers.upload', 'Waivers', 'Upload', '/dashboard/waivers/upload', ['waivers.view', 'waivers.create']),
  link('waivers.paper_view', 'Waivers', 'Paper Waivers', '/dashboard/waivers/paper-view', ['waivers.view']),
  link('waivers.settings', 'Waivers', 'Settings', '/dashboard/waivers/settings', ['waivers.edit']),
  link('waivers.reports', 'Waivers', 'Reports', '/dashboard/waivers/reports', ['waivers.view']),

  // Forms & Tasks
  link('forms.dashboard', 'Forms', 'Forms', '/dashboard/forms', [], ['owner', 'admin', 'manager']),
  link('tasks.dashboard', 'Task Manager', 'Task Manager', '/dashboard/tasks', [], ['owner', 'admin', 'manager']),

  // HR
  link('hr.employee_management', 'HR', 'Employee Management', '/dashboard/hr/employee-management', ['hr.dashboard.view', 'hr.employees.view', 'hr.employees.view_all', 'hr.contracts.view', 'hr.documents.view', 'hr.writeups.view']),
  link('hr.training', 'HR', 'Training', '/dashboard/hr/training', ['hr.onboarding.view', 'hr.policies.view']),
  link('hr.communications', 'HR', 'HR Communications', '/dashboard/hr/communications', ['hr.writeups.view', 'hr.policies.view', 'hr.employees.view']),
  link('hr.payroll', 'HR', 'Payroll', '/dashboard/hr/payroll', ['hr.payroll.view', 'hr.payroll.edit']),

  // Mail
  link('mail.dashboard', 'Mail', 'Dashboard', '/dashboard/mail/dashboard', ['mail.dashboard.view', 'mail.dashboard.edit']),
  link('mail.builder', 'Mail', 'One Time Campaigns', '/dashboard/mail/builder', ['mail.campaigns.view', 'mail.builder.view', 'mail.builder.edit']),
  link('mail.automations', 'Mail', 'Automations', '/dashboard/mail/automations', ['mail.campaigns.view', 'mail.campaigns.edit']),
  link('mail.contacts', 'Mail', 'Contacts', '/dashboard/mail/contacts', ['mail.contacts.view', 'mail.contacts.edit']),
  link('mail.billing', 'Mail', 'Usage', '/dashboard/mail/billing', ['mail.billing.view', 'mail.billing.edit']),
  link('mail.settings', 'Mail', 'Settings', '/dashboard/mail/settings', ['mail.settings.view', 'mail.settings.edit']),
  link('mail.compliance', 'Mail', 'Compliance', '/dashboard/mail/compliance', ['mail.compliance.view', 'mail.compliance.edit']),
  link('mail.logs', 'Mail', 'Send Logs', '/dashboard/mail/logs', ['mail.logs.view']),
  link('mail.performance', 'Mail', 'Performance', '/dashboard/mail/performance', ['mail.performance.view']),

  // Inbox
  link('inbox.dashboard', 'Inbox', 'Dashboard', '/dashboard/inbox', ['inbox.dashboard.view', 'inbox.dashboard.edit']),

  // Music
  link('music.dashboard', 'Music', 'Dashboard', '/dashboard/music/dashboard', ['music.dashboard.view', 'music.dashboard.edit']),
  link('music.upload', 'Music', 'Upload', '/dashboard/music/upload', ['music.upload.view', 'music.upload.edit']),
  link('music.library', 'Music', 'Library', '/dashboard/music/library', ['music.library.view', 'music.library.edit']),
  link('music.playlists', 'Music', 'Playlists', '/dashboard/music/playlists', ['music.playlists.view', 'music.playlists.edit']),
  link('music.schedules', 'Music', 'Schedules', '/dashboard/music/schedules', ['music.schedules.view', 'music.schedules.edit']),
  link('music.system_monitor', 'Music', 'System Monitor', '/dashboard/music/system-monitor', ['music.system_monitor.view', 'music.system_monitor.edit']),
  link('music.ads_dashboard', 'Music', 'Ad Dashboard', '/dashboard/music/ads/dashboard', ['music.ads.view', 'music.ads.edit']),
  link('music.ads_settings', 'Music', 'Ad Settings', '/dashboard/music/ads/settings', ['music.ads.view', 'music.ads.edit']),
  link('music.ads_revenue', 'Music', 'Ad Revenue', '/dashboard/music/ads/revenue', ['music.ads.view', 'music.ads.view_revenue']),
  link('music.v2_dashboard', 'Music', 'Music V2 Dashboard', '/dashboard/music/v2/dashboard', ['music.dashboard.view', 'music.dashboard.edit']),
  link('music.v2_settings', 'Music', 'Music V2 Settings', '/dashboard/music/v2/settings', ['music.settings.view', 'music.settings.edit']),

  // Accounting
  link('accounting.overview', 'Accounting', 'Overview', '/dashboard/accounting', [], ['owner', 'admin', 'manager']),
  link('accounting.queue', 'Accounting', 'Queue', '/dashboard/accounting/queue', [], ['owner', 'admin', 'manager']),
  link('accounting.reports', 'Accounting', 'Reports', '/dashboard/accounting/reports', [], ['owner', 'admin', 'manager']),
  link('accounting.bank_transactions', 'Accounting', 'Bank Transactions', '/dashboard/accounting/bank-transactions', [], ['owner', 'admin', 'manager']),
  link('accounting.vendors', 'Accounting', 'Vendors', '/dashboard/accounting/vendors', [], ['owner', 'admin', 'manager']),
  link('accounting.categories', 'Accounting', 'Categories', '/dashboard/accounting/categories', [], ['owner', 'admin', 'manager']),
  link('accounting.activity', 'Accounting', 'Activity', '/dashboard/accounting/activity', [], ['owner', 'admin', 'manager']),
  link('accounting.settings', 'Accounting', 'Settings', '/dashboard/accounting/settings', [], ['owner', 'admin', 'manager']),

  // File Storage
  link('file_storage.dashboard', 'File Storage', 'Dashboard', '/dashboard/file-storage', [], ['owner', 'admin', 'manager']),
  link('file_storage.paper_forms', 'File Storage', 'Paper Forms', '/dashboard/file-storage/paper-forms', [], ['owner', 'admin', 'manager']),

  // Scheduling
  link('scheduling.dashboard', 'Scheduling', 'Scheduling', '/dashboard/scheduling', ['hr.scheduling.view', 'hr.scheduling.edit', 'settings.scheduling.view']),

  // Digital Signage
  link('digital_signage.dashboard', 'Digital Signage', 'Dashboard', '/dashboard/digital-signage', ['digital_signage.dashboard.view', 'digital_signage.screens.view']),
  link('digital_signage.screens', 'Digital Signage', 'Screens', '/dashboard/digital-signage/screens', ['digital_signage.screens.view']),
  link('digital_signage.content', 'Digital Signage', 'Content Library', '/dashboard/digital-signage/content', ['digital_signage.content.view']),
  link('digital_signage.schedules', 'Digital Signage', 'Schedules', '/dashboard/digital-signage/schedules', ['digital_signage.schedules.view']),
  link('digital_signage.zones', 'Digital Signage', 'Zones', '/dashboard/digital-signage/zones', ['digital_signage.zones.view']),
  link('digital_signage.ads', 'Digital Signage', 'Ads', '/dashboard/digital-signage/ads', ['digital_signage.ads.view']),
  link('digital_signage.menu_boards', 'Digital Signage', 'Menu Boards', '/dashboard/digital-signage/menu-boards', ['digital_signage.menu_boards.view']),
  link('digital_signage.analytics', 'Digital Signage', 'Analytics', '/dashboard/digital-signage/analytics', ['digital_signage.analytics.view']),

  // Other modules
  link('social_media.dashboard', 'Social Media', 'Dashboard', '/dashboard/social-media', [], ['owner', 'admin', 'manager']),
  link('voice_agent.dashboard', 'Voice Agent', 'Dashboard', '/dashboard/voice-agent', [], ['owner', 'admin', 'manager']),
  link('custom_voice_agent.dashboard', 'Custom Voice Agent', 'Dashboard', '/dashboard/custom-voice-agent', [], ['owner', 'admin', 'manager']),
  link('reputation.dashboard', 'Reputation', 'Dashboard', '/dashboard/reputation', [], ['owner', 'admin', 'manager']),
  link('reminders.dashboard', 'Reminders', 'Dashboard', '/dashboard/reminders', ['reminders.dashboard.view', 'reminders.dashboard.edit']),
  link('tavari_apis.dashboard', 'Tavari APIs', 'Dashboard', '/dashboard/tavari-apis', [], ['owner', 'admin', 'manager']),
  link('vending.dashboard', 'Vending', 'Dashboard', '/dashboard/vending', [], ['owner', 'admin', 'manager']),
  link('power_bank.dashboard', 'Power Bank', 'Dashboard', '/dashboard/power-bank', [], ['owner', 'admin', 'manager']),
  link('liquor.inventory', 'Liquor', 'Inventory', '/dashboard/liquor/inventory', [], ['owner', 'admin', 'manager']),
  link('recipe_builder.dashboard', 'Recipe Builder', 'Recipe Builder', '/dashboard/recipe-builder', [], ['owner', 'admin', 'manager']),
  link('appbuilder.dashboard', 'App Builder', 'Dashboard', '/dashboard/appbuilder', ['appbuilder.branding.view', 'appbuilder.modules.view', 'appbuilder.build.view']),
  link('appbuilder.branding', 'App Builder', 'Branding', '/dashboard/appbuilder/branding', ['appbuilder.branding.view', 'appbuilder.branding.edit']),
  link('appbuilder.modules', 'App Builder', 'Modules', '/dashboard/appbuilder/modules', ['appbuilder.modules.view', 'appbuilder.modules.toggle']),
  link('appbuilder.builds', 'App Builder', 'Builds', '/dashboard/appbuilder/builds', ['appbuilder.build.view', 'appbuilder.build.create']),
  link('appbuilder.deployments', 'App Builder', 'Deployments', '/dashboard/appbuilder/deployments', ['appbuilder.deploy.view', 'appbuilder.deploy.manage']),
  link('appbuilder.analytics', 'App Builder', 'Analytics', '/dashboard/appbuilder/analytics', ['appbuilder.analytics.view', 'appbuilder.analytics.export']),
  link('invoices.dashboard', 'Invoices', 'Invoices', '/dashboard/invoices', ['invoices.view', 'invoices.create'])
];

/** @param {string | null | undefined} key */
export function getTaskManagerModuleLink(key) {
  if (!key) return null;
  return TASK_MANAGER_MODULE_LINKS.find((entry) => entry.key === key) || null;
}

export function getTaskManagerModuleLinkOptions() {
  const sorted = [...TASK_MANAGER_MODULE_LINKS].sort((a, b) => {
    const group = a.moduleGroup.localeCompare(b.moduleGroup);
    if (group !== 0) return group;
    return a.label.localeCompare(b.label);
  });

  return [
    { value: '', label: 'None — no in-app page link' },
    ...sorted.map((entry) => ({
      value: entry.key,
      label: `${entry.moduleGroup} — ${entry.label}`
    }))
  ];
}

/**
 * @param {{ path: string }} linkEntry
 * @param {{ taskId: string, businessId: string, returnPath: string }} params
 */
export function buildTaskModuleLinkUrl(linkEntry, { taskId, businessId, returnPath }) {
  const params = new URLSearchParams();
  params.set('taskReturn', returnPath);
  params.set('task', taskId);
  if (businessId) params.set('business', businessId);
  return `${linkEntry.path}?${params.toString()}`;
}

/**
 * Prime POS permission context from a task kiosk PIN session before navigating to dashboard.
 * @param {{ employee_id: string, full_name?: string, first_name?: string, role?: string }} employee
 * @param {string} businessId
 */
export function primePosActiveUserFromTaskKiosk(employee, businessId) {
  if (!employee?.employee_id || !businessId) return;
  const displayName = employee.full_name || employee.first_name || 'Staff';
  const payload = {
    id: employee.employee_id,
    role: employee.role || 'employee',
    full_name: employee.full_name || null,
    first_name: employee.first_name || null,
    name: displayName,
    business_id: businessId,
    unlocked_at: Date.now(),
    source: 'task_kiosk'
  };
  localStorage.setItem('posActiveUser', JSON.stringify(payload));
  localStorage.setItem('currentBusinessId', businessId);
  localStorage.setItem('selectedBusinessId', businessId);
  window.dispatchEvent(new Event('pos-active-user-changed'));
}
