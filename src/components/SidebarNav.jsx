// components/SidebarNav.jsx - Fixed items at top, then activated modules
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FiHome, FiUsers, FiUser, FiBarChart2, FiMusic, FiMail, FiInbox, FiChevronDown, FiChevronRight, FiClipboard, FiPieChart, FiShoppingBag, FiPackage, FiDollarSign, FiSmartphone, FiSettings, FiFileText, FiSearch, FiUpload, FiMonitor, FiCalendar, FiShare2, FiFolder, FiStar, FiCpu, FiZap, FiGlobe, FiGift, FiTag } from 'react-icons/fi';
import { TavariStyles } from '../utils/TavariStyles';
import { useBusiness, useBusinessContext } from '../contexts/BusinessContext';
import { usePermissions } from '../hooks/usePermissions';
import { useModulesEnabled } from '../hooks/useModuleEnabled';
import { useModuleCatalog } from '../hooks/useModuleCatalog';
import ModuleCatalogService from '../services/ModuleCatalogService';
import { isPersonalFinanceBusiness } from '../config/personalFinanceAccess';

const SIDEBAR_DEPLOYMENT_LABEL = 'July 25 2026 V62';

/** Which accordion section (if any) owns the current dashboard route â€” used to collapse others on navigation. */
function getSidebarAccordionForPath(pathname) {
  if (!pathname || !pathname.startsWith('/dashboard')) return null;
  if (pathname.startsWith('/dashboard/accounting')) return 'accounting';
  if (pathname.startsWith('/dashboard/pos')) return 'pos';
  if (pathname.startsWith('/dashboard/bookings')) return 'bookings';
  if (pathname.startsWith('/dashboard/hr')) return 'hr';
  if (pathname.startsWith('/dashboard/mail')) return 'mail';
  if (pathname.startsWith('/dashboard/reports')) return 'reports';
  if (pathname === '/dashboard/audit-logs' || pathname.startsWith('/dashboard/audit-logs/')) return 'reports';
  if (pathname.startsWith('/dashboard/vending')) return 'vending';
  if (pathname.startsWith('/dashboard/power-bank')) return 'power_bank';
  if (pathname.startsWith('/dashboard/file-storage')) return 'file_storage';
  if (pathname.startsWith('/dashboard/dividend-income')) return 'dividend_income';
  return null;
}
/** Shown first after fixed nav items, in this order, before the second divider. */
const PRIORITY_MODULE_KEYS = ['pos', 'bookings', 'waivers'];

const isPriorityModule = (moduleKey) =>
  PRIORITY_MODULE_KEYS.includes((moduleKey || '').toLowerCase());

const MODULE_DISPLAY_NAMES = {
  pos: 'Tavari POS',
  dining: 'Tavari Dining',
  inbox: 'Tavari Inbox',
  waivers: 'Tavari Waivers',
  bookings: 'Tavari Bookings',
  accounting: 'Tavari Accounting',
  invoices: 'Tavari Invoices',
  funding: 'Tavari Funding',
  gift_cards: 'Gift Cards',
  deals: 'Deals & Coupons',
  tasks: 'Tavari Task Manager',
  forms: 'Tavari Forms',
  scheduling: 'Tavari Scheduling',
  hr: 'Tavari HR',
  payroll: 'Tavari Payroll',
  mail: 'Tavari Mail',
  social_media: 'Tavari AI Social Media Agent',
  reputation: 'Tavari Reputation',
  reminders: 'Tavari Reminder',
  tavari_apis: 'Tavari APIs',
  voice_agent: 'Tavari Voice Agent',
  custom_voice_agent: 'Tavari Custom Voice Agent',
  appbuilder: 'Tavari App Builder',
  music: 'Tavari Music',
  recipe_builder: 'Tavari Recipe Manager',
  liquor: 'Tavari Liquor Management',
  vending: 'Tavari Vending',
  power_bank: 'Tavari Power Bank',
  digital_signage: 'Tavari Digital Signage',
  loyalty: 'Tavari Loyalty',
  dividend_income: 'Dividend Income',
};

function getModuleDisplayName(moduleKey, moduleName) {
  const key = (moduleKey || '').toLowerCase();
  const raw = (moduleName || MODULE_DISPLAY_NAMES[key] || key).trim();
  if (/^tavari\s/i.test(raw)) return raw;
  return `Tavari ${raw}`;
}

/** Employees: show HR nav only if at least one of these areas is permitted (matches HR hubs). */
const HR_NAV_EMPLOYEE_MGMT_PERMS = [
  'hr.dashboard.view',
  'hr.employees.view',
  'hr.employees.view_all',
  'hr.contracts.view',
  'hr.documents.view',
  'hr.writeups.view',
  'hr.settings.view',
  'hr.settings.manage',
  'hr.premiums.manage',
];
const HR_NAV_TRAINING_PERMS = ['hr.onboarding.view', 'hr.policies.view'];
const HR_NAV_COMMS_PERMS = [
  'hr.writeups.view',
  'hr.policies.view',
  'hr.employees.view',
  'hr.settings.view',
  'hr.settings.manage',
  'hr.documents.manage',
];

/** Employees: show POS accordion only if at least one POS dashboard sub-route is permitted. */
const POS_SIDEBAR_PERM_KEYS = [
  'pos.register.view',
  'pos.inventory.view',
  'pos.categories.view',
  'pos.categories.edit',
  'pos.modifiers.view',
  'pos.modifiers.create',
  'pos.modifiers.edit',
  'pos.discounts.view',
  'pos.receipts.view',
  'pos.settings.view',
  'pos.stations.view',
  'pos.kitchen_display.view',
  'pos.daily_deposit.view',
  'pos.loyalty.view',
  'pos.tabs.view',
  'pos.refunds.view',
  'pos.reports.view',
  'pos.customer_display.view',
  'pos.display_ads.view',
];

const EMPLOYEE_MODULE_PREFIXES = {
  loyalty: ['loyalty.', 'pos.loyalty.'],
};

const SidebarNav = ({ onNavigate }) => {
  // Single state to track which category is expanded (only one at a time)
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Get business context first
  const { business } = useBusiness();
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();
  const showPersonalDividendIncome = isPersonalFinanceBusiness(
    selectedBusiness || business,
    selectedBusinessId
  );

  // Get permissions - use role from permissions hook for accuracy
  const {
    hasPermission,
    hasAnyPermission,
    hasElevatedPrivileges,
    isManager,
    loading: permissionsLoading,
    userRole: effectiveRole,
    loggedInUserRole,
    userPermissions,
  } = usePermissions();

  // Sidebar module visibility must follow the logged-in account, never a POS cashier override.
  const navRole = loggedInUserRole || effectiveRole;

  // Check which modules are enabled for this business
  const { modules: enabledModules, loading: modulesLoading } = useModulesEnabled([
    'pos', 'music', 'mail', 'hr', 'recipe_builder', 'scheduling', 'loyalty', 'digital_signage',
    'dining', 'bookings', 'liquor', 'vending', 'power_bank', 'inbox', 'appbuilder', 'waivers', 'social_media', 'voice_agent', 'custom_voice_agent', 'accounting', 'file_storage',
    'reputation', 'tasks', 'forms', 'reminders', 'tavari_apis', 'invoices', 'funding', 'gift_cards', 'deals'
  ]);

  // Get activated modules for dynamic sidebar rendering
  // Use both useModuleCatalog (for marketplace data) and useModulesEnabled (for enabled check)
  // This ensures we have the most accurate module status
  const { activatedModules: rawActivatedModules, loading: catalogLoading } = useModuleCatalog();
  
  // Also get enabled modules from the old method as a fallback/verification
  // This ensures compatibility with existing module activation system

  const activatedModules = React.useMemo(() => {
    if (!rawActivatedModules || rawActivatedModules.length === 0) {
      return [];
    }

    return rawActivatedModules.filter(m => {
      const key = (m.module_key || '').toLowerCase();
      const name = (m.module_name || '').toLowerCase();

      if (key === 'settings' ||
          key === 'system_settings' ||
          key === 'system-settings' ||
          key === 'reports' ||
          key === 'system' ||
          key === 'file_storage' ||
          key === 'dividend_income') {
        return false;
      }

      if (name.includes('system settings') ||
          (name.includes('settings') && !name.includes('module') && !name.includes('app'))) {
        return false;
      }

      return true;
    });
  }, [rawActivatedModules]);

  // Also filter out settings/reports from fallback modules
  const filteredFallbackModules = React.useMemo(() => {
    if (!enabledModules) return [];
    
    const knownModules = Object.fromEntries(
      Object.entries(MODULE_DISPLAY_NAMES).map(([key, name]) => {
        const routes = {
          pos: '/dashboard/pos/register',
          dining: '/dashboard/dining/dashboard',
          inbox: '/dashboard/inbox',
          waivers: '/dashboard/waivers',
          bookings: '/dashboard/bookings',
          accounting: '/dashboard/accounting',
          tasks: '/dashboard/tasks',
          forms: '/dashboard/forms',
          scheduling: '/dashboard/scheduling',
          hr: '/dashboard/hr/dashboard',
          mail: '/dashboard/mail/dashboard',
          social_media: '/dashboard/social-media',
          reputation: '/dashboard/reputation',
          reminders: '/dashboard/reminders',
          invoices: '/dashboard/invoices',
          funding: '/dashboard/funding',
          gift_cards: '/dashboard/gift-cards',
          deals: '/dashboard/deals',
          voice_agent: '/dashboard/voice-agent',
          custom_voice_agent: '/dashboard/custom-voice-agent',
          appbuilder: '/dashboard/appbuilder',
          music: '/dashboard/music/dashboard',
          recipe_builder: '/dashboard/recipe-builder',
          liquor: '/dashboard/liquor/inventory',
          vending: '/dashboard/vending',
          power_bank: '/dashboard/power-bank',
          digital_signage: '/dashboard/digital-signage',
          loyalty: '/dashboard/pos/loyalty',
          tavari_apis: '/dashboard/tavari-apis',
        };
        const icons = {
          pos: 'FiShoppingCart',
          dining: 'FiShoppingBag',
          inbox: 'FiInbox',
          waivers: 'FiFileText',
          bookings: 'FiCalendar',
          accounting: 'FiDollarSign',
          tasks: 'FiClipboard',
          forms: 'FiFileText',
          scheduling: 'FiCalendar',
          hr: 'FiUsers',
          mail: 'FiMail',
          social_media: 'FiShare2',
          reputation: 'FiStar',
          reminders: 'FiBell',
          invoices: 'FiFileText',
          funding: 'FiDollarSign',
          gift_cards: 'FiGift',
          deals: 'FiTag',
          voice_agent: 'FiMonitor',
          custom_voice_agent: 'FiMonitor',
          appbuilder: 'FiSmartphone',
          music: 'FiMusic',
          recipe_builder: 'FiClipboard',
          liquor: 'FiPackage',
          vending: 'FiCpu',
          power_bank: 'FiZap',
          digital_signage: 'FiMonitor',
          loyalty: 'FiStar',
          tavari_apis: 'FiGlobe',
        };
        return [key, { name, route: routes[key], icon: icons[key] }];
      })
    );

    return Object.keys(knownModules)
      .filter(key => {
        if (!enabledModules[key]) return false;
        if (key === 'settings' || key === 'system_settings' || key === 'reports' || key === 'file_storage' || key === 'dividend_income') return false;
        return !activatedModules?.some(m => m.module_key === key);
      })
      .map(key => ({
        key,
        ...knownModules[key],
      }))
      .filter(m => m.name && m.route);
  }, [enabledModules, activatedModules]);

  const employeeSeesActivatedModule = React.useCallback(
    (moduleKey) => {
      if (navRole !== 'employee') return true;
      const k = (moduleKey || '').toLowerCase();
      if (k === 'hr') {
        return (
          hasAnyPermission(HR_NAV_EMPLOYEE_MGMT_PERMS) ||
          hasAnyPermission(HR_NAV_TRAINING_PERMS) ||
          hasAnyPermission(HR_NAV_COMMS_PERMS) ||
          hasPermission('hr.payroll.view')
        );
      }
      if (k === 'pos') {
        return hasAnyPermission(POS_SIDEBAR_PERM_KEYS);
      }
      const prefixes = EMPLOYEE_MODULE_PREFIXES[k] || [`${k}.`];
      return prefixes.some((pref) => (userPermissions || []).some((p) => (p || '').startsWith(pref)));
    },
    [navRole, hasAnyPermission, hasPermission, userPermissions]
  );

  const visibleActivatedModules = React.useMemo(() => {
    if (!activatedModules?.length) return [];
    return activatedModules.filter((m) => employeeSeesActivatedModule(m.module_key));
  }, [activatedModules, employeeSeesActivatedModule]);

  const visibleFallbackModules = React.useMemo(() => {
    if (!filteredFallbackModules?.length) return [];
    if (navRole !== 'employee') return filteredFallbackModules;
    return filteredFallbackModules.filter((m) => employeeSeesActivatedModule(m.key));
  }, [filteredFallbackModules, navRole, employeeSeesActivatedModule]);

  const { priorityModules, alphabeticalModules } = React.useMemo(() => {
    const moduleMap = new Map();

    visibleActivatedModules.forEach((module) => {
      moduleMap.set(module.module_key, module);
    });

    visibleFallbackModules.forEach((module) => {
      if (!moduleMap.has(module.key)) {
        moduleMap.set(module.key, {
          module_key: module.key,
          module_name: module.name,
          icon: module.icon,
        });
      }
    });

    const priority = PRIORITY_MODULE_KEYS
      .filter((key) => moduleMap.has(key))
      .map((key) => moduleMap.get(key));

    const alphabetical = Array.from(moduleMap.values()).filter(
      (module) => !PRIORITY_MODULE_KEYS.includes(module.module_key)
    );

    const payrollOnlyHr =
      navRole === 'employee' &&
      hasPermission('hr.payroll.view') &&
      !hasAnyPermission(HR_NAV_EMPLOYEE_MGMT_PERMS) &&
      !hasAnyPermission(HR_NAV_TRAINING_PERMS) &&
      !hasAnyPermission(HR_NAV_COMMS_PERMS);

    const canViewPayrollNav =
      navRole === 'owner' ||
      navRole === 'admin' ||
      navRole === 'manager' ||
      hasPermission('hr.payroll.view');

    if (
      enabledModules['hr'] &&
      canViewPayrollNav &&
      moduleMap.has('hr') &&
      !payrollOnlyHr &&
      !alphabetical.some((module) => module.module_key === 'payroll')
    ) {
      alphabetical.push({
        module_key: 'payroll',
        module_name: MODULE_DISPLAY_NAMES.payroll,
        icon: 'FiDollarSign',
      });
    }

    alphabetical.sort((a, b) => {
      const nameA = getModuleDisplayName(a.module_key, a.module_name);
      const nameB = getModuleDisplayName(b.module_key, b.module_name);
      return nameA.localeCompare(nameB);
    });

    return { priorityModules: priority, alphabeticalModules: alphabetical };
  }, [
    visibleActivatedModules,
    visibleFallbackModules,
    enabledModules,
    navRole,
    hasPermission,
    hasAnyPermission,
  ]);

  // Wait for business context and auth to be ready
  useEffect(() => {
    if (business?.id && !permissionsLoading && !modulesLoading && !catalogLoading && selectedBusinessId) {
      setIsReady(true);
    } else {
      setIsReady(false);
    }
  }, [business?.id, permissionsLoading, modulesLoading, catalogLoading, selectedBusinessId]);

  // Collapse accordion sections when the route leaves that section (e.g. POS open â†’ navigate to Waivers).
  useEffect(() => {
    const section = getSidebarAccordionForPath(location.pathname);
    setExpandedCategory((prev) => {
      if (section === 'file_storage') return 'file_storage';
      if (prev === null) return null;
      return section === prev ? prev : null;
    });
  }, [location.pathname]);

  // Permission check helper - returns true if page should be visible
  const canViewPage = (permissionKey) => {
    if (!isReady || permissionsLoading) return false;
    if (!permissionKey) return false;

    // Sidebar always respects the logged-in account for module visibility.
    // Never hide owner/admin/manager modules because a POS cashier override is active.
    const sidebarRole = navRole;

    if (sidebarRole === 'owner' || sidebarRole === 'admin' || sidebarRole === 'manager' || hasElevatedPrivileges()) {
      return true;
    }

    if (sidebarRole === 'employee') {
      return hasPermission(permissionKey);
    }

    return hasPermission(permissionKey);
  };

  // Handle category expansion with auto-collapse
  const handleCategoryToggle = (categoryName) => {
    if (expandedCategory === categoryName) {
      setExpandedCategory(null);
    } else {
      setExpandedCategory(categoryName);
    }
  };

  // Handle navigation - permissions system controls access, no PIN required
  const handleNavigation = (path) => {
    go(path);
  };

  // Fallback: use internal navigate if parent doesn't pass onNavigate
  const go = (path) => (onNavigate ? onNavigate(path) : navigate(path));

  // Track module usage when navigating to module
  const handleModuleNavigation = async (moduleKey, path) => {
    if (selectedBusinessId) {
      ModuleCatalogService.setBusinessId(selectedBusinessId);
      await ModuleCatalogService.trackModuleUsage(moduleKey);
    }
    go(path);
  };

  const getModuleButtonStyle = (moduleKey) =>
    isPriorityModule(moduleKey) ? styles.priorityButton : styles.button;

  // Get module icon component
  const getModuleIcon = (iconName) => {
    const iconMap = {
      'FiMail': <FiMail />,
      'FiMusic': <FiMusic />,
      'FiMonitor': <FiMonitor />,
      'FiUsers': <FiUsers />,
      'FiShoppingCart': <FiBarChart2 />,
      'FiPackage': <FiPackage />,
      'FiStar': <FiStar />,
      'FiCalendar': <FiCalendar />,
      'FiShoppingBag': <FiShoppingBag />,
      'FiInbox': <FiInbox />,
      'FiSmartphone': <FiSmartphone />,
      'FiDollarSign': <FiDollarSign />,
      'FiFileText': <FiFileText />,
      'FiShare2': <FiShare2 />,
      'FiFolder': <FiFolder />,
      'FiClipboard': <FiClipboard />,
      'FiCpu': <FiCpu />,
      'FiZap': <FiZap />,
      'FiGlobe': <FiGlobe />,
      'FiGift': <FiGift />,
      'FiTag': <FiTag />,
    };
    return iconMap[iconName] || <FiPackage />;
  };

  // Render module navigation based on module key
  const renderModuleNavigation = (module) => {
    const moduleKey = module.module_key;
    const displayName = getModuleDisplayName(moduleKey, module.module_name);
    
    // Don't render System Settings or Reports as modules - they're fixed items
    if (moduleKey === 'settings' || moduleKey === 'system_settings' || moduleKey === 'reports') {
      return null;
    }

    if (moduleKey === 'accounting' && navRole === 'employee') {
      return null;
    }

    if (moduleKey === 'accounting' && enabledModules['accounting']) {
      return (
        <>
          <div style={styles.button} onClick={() => handleCategoryToggle('accounting')}>
            <span style={styles.icon}>{getModuleIcon(module.icon || 'FiDollarSign')}</span>
            <span style={{ flex: 1 }}>{displayName}</span>
            <span>{expandedCategory === 'accounting' ? <FiChevronDown /> : <FiChevronRight />}</span>
          </div>
          {expandedCategory === 'accounting' && (
            <>
              <div style={styles.subButton} onClick={() => handleModuleNavigation('accounting', '/dashboard/accounting')}>
                <span style={styles.subIcon}>•</span>
                <span>Overview</span>
              </div>
              <div style={styles.subButton} onClick={() => handleModuleNavigation('accounting', '/dashboard/accounting/queue')}>
                <span style={styles.subIcon}>•</span>
                <span>Queue</span>
              </div>
              <div style={styles.subButton} onClick={() => handleModuleNavigation('accounting', '/dashboard/accounting/reports')}>
                <span style={styles.subIcon}>•</span>
                <span>Reports</span>
              </div>
              <div style={styles.subButton} onClick={() => handleModuleNavigation('accounting', '/dashboard/accounting/setup/vendors')}>
                <span style={styles.subIcon}>•</span>
                <span>Set Up</span>
              </div>
              <div style={styles.subButton} onClick={() => handleModuleNavigation('accounting', '/dashboard/accounting/activity')}>
                <span style={styles.subIcon}>•</span>
                <span>Activity</span>
              </div>
              <div style={styles.subButton} onClick={() => handleModuleNavigation('accounting', '/dashboard/accounting/settings')}>
                <span style={styles.subIcon}>•</span>
                <span>Settings</span>
              </div>
            </>
          )}
        </>
      );
    }
    
    // Also check by name
    const moduleName = (module.module_name || '').toLowerCase();
    if (moduleName.includes('system settings') || (moduleName.includes('settings') && !moduleName.includes('module'))) {
      return null;
    }
    
    const dashboardRoute = ModuleCatalogService.getModuleDashboardRoute(moduleKey);

    // Special handling for modules with sub-navigation
    if (moduleKey === 'pos' && enabledModules['pos']) {
      if (navRole === 'employee' && !hasAnyPermission(POS_SIDEBAR_PERM_KEYS)) {
        return null;
      }
      return (
        <>
          <div style={getModuleButtonStyle('pos')} onClick={() => handleCategoryToggle('pos')}>
            <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
            <span style={{ flex: 1 }}>{displayName}</span>
            <span>{expandedCategory === 'pos' ? <FiChevronDown /> : <FiChevronRight />}</span>
          </div>
          {expandedCategory === 'pos' && (
            <>
              {canViewPage('pos.register.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/register')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Register</span>
                </div>
              )}
              {(canViewPage('pos.inventory.view') ||
                canViewPage('pos.categories.view') ||
                canViewPage('pos.categories.edit') ||
                canViewPage('pos.modifiers.view') ||
                canViewPage('pos.modifiers.create') ||
                canViewPage('pos.modifiers.edit')) && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/inventory')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Inventory Management</span>
                </div>
              )}
              {canViewPage('pos.discounts.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/discounts')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Discounts</span>
                </div>
              )}
              {canViewPage('pos.receipts.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/receipts')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Receipts</span>
                </div>
              )}
              {(canViewPage('pos.receipts.view') ||
                canViewPage('bookings.view') ||
                canViewPage('bookings.view_all')) && (
                <div
                  style={styles.subButton}
                  onClick={() => handleModuleNavigation('pos', '/dashboard/pos/bookings-receipts')}
                >
                  <span style={styles.subIcon}>•</span>
                  <span>Bookings Receipts</span>
                </div>
              )}
              {canViewPage('pos.settings.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/settings')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Settings</span>
                </div>
              )}
              {canViewPage('pos.stations.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/stations')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Stations</span>
                </div>
              )}
              {canViewPage('pos.kitchen_display.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/kitchen-display')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Kitchen Display</span>
                </div>
              )}
              {canViewPage('pos.daily_deposit.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/daily-deposit')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Daily Deposit</span>
                </div>
              )}
              {canViewPage('pos.loyalty.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/loyalty')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Loyalty</span>
                </div>
              )}
              {(canViewPage('pos.loyalty.view') ||
                canViewPage('pos.settings.view') ||
                canViewPage('pos.settings.loyalty') ||
                canViewPage('pos.loyalty.settings')) && (
                <div
                  style={styles.subButton}
                  onClick={() => handleModuleNavigation('pos', '/dashboard/pos/loyalty-settings?tab=offers')}
                >
                  <span style={styles.subIcon}>•</span>
                  <span>Personalized Offers</span>
                </div>
              )}
              {(canViewPage('pos.loyalty.view') ||
                canViewPage('pos.settings.view') ||
                canViewPage('pos.settings.loyalty') ||
                canViewPage('pos.loyalty.settings')) && (
                <div
                  style={styles.subButton}
                  onClick={() => handleModuleNavigation('pos', '/dashboard/pos/loyalty-settings')}
                >
                  <span style={styles.subIcon}>•</span>
                  <span>Loyalty Program Settings</span>
                </div>
              )}
              {canViewPage('pos.tabs.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/tabs')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Tabs</span>
                </div>
              )}
              {canViewPage('pos.refunds.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/refunds')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Refunds</span>
                </div>
              )}
              {canViewPage('pos.reports.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/reports')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Reports</span>
                </div>
              )}
              {canViewPage('pos.reports.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/daily-sales')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Daily Sales Ledger</span>
                </div>
              )}
              {canViewPage('pos.customer_display.view') && (
                <div
                  style={styles.subButton}
                  onClick={() => handleModuleNavigation('pos', '/dashboard/pos/customer-display-setup')}
                >
                  <span style={styles.subIcon}>•</span>
                  <span>Customer Display</span>
                </div>
              )}
              {canViewPage('pos.display_ads.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/display-ads')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Display Ads</span>
                </div>
              )}
            </>
          )}
        </>
      );
    }

    // HR module: Tavari HR parent with three area links (no standalone "HR Settings" in nav)
    if (moduleKey === 'hr' && enabledModules['hr']) {
      if (navRole === 'employee' && !employeeSeesActivatedModule('hr')) {
        return null;
      }
      const showHrEmpNav = navRole !== 'employee' || hasAnyPermission(HR_NAV_EMPLOYEE_MGMT_PERMS);
      const showHrTrainingNav = navRole !== 'employee' || hasAnyPermission(HR_NAV_TRAINING_PERMS);
      const showHrCommsNav = navRole !== 'employee' || hasAnyPermission(HR_NAV_COMMS_PERMS);
      const payrollOnlyEmployee =
        navRole === 'employee' &&
        hasPermission('hr.payroll.view') &&
        !showHrEmpNav &&
        !showHrTrainingNav &&
        !showHrCommsNav;

      if (payrollOnlyEmployee) {
        return (
          <div style={styles.button} onClick={() => handleModuleNavigation('hr', '/dashboard/hr/payroll')}>
            <span style={styles.icon}><FiDollarSign /></span>
            <span>{getModuleDisplayName('payroll', MODULE_DISPLAY_NAMES.payroll)}</span>
          </div>
        );
      }

      return (
        <>
          <div style={styles.button} onClick={() => handleCategoryToggle('hr')}>
            <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
            <span style={{ flex: 1 }}>{displayName}</span>
            <span>{expandedCategory === 'hr' ? <FiChevronDown /> : <FiChevronRight />}</span>
          </div>
          {expandedCategory === 'hr' && (
            <>
              {showHrEmpNav && (
              <div style={styles.subButton} onClick={() => handleModuleNavigation('hr', '/dashboard/hr/employee-management')}>
                <span style={styles.subIcon}>•</span>
                <span>Employee Management</span>
              </div>
              )}
              {showHrTrainingNav && (
              <div style={styles.subButton} onClick={() => handleModuleNavigation('hr', '/dashboard/hr/training')}>
                <span style={styles.subIcon}>•</span>
                <span>Training</span>
              </div>
              )}
              {showHrCommsNav && (
              <div style={styles.subButton} onClick={() => handleModuleNavigation('hr', '/dashboard/hr/communications')}>
                <span style={styles.subIcon}>•</span>
                <span>HR Communications</span>
              </div>
              )}
            </>
          )}
        </>
      );
    }

    // Payroll - show as separate item if it's a separate module
    if (moduleKey === 'payroll') {
      return (
        <div style={styles.button} onClick={() => handleModuleNavigation('payroll', '/dashboard/hr/payroll')}>
          <span style={styles.icon}><FiDollarSign /></span>
          <span>{displayName}</span>
        </div>
      );
    }

    // Digital Signage - single nav item (module tabs handle sub-pages)
    if (moduleKey === 'digital_signage' && enabledModules['digital_signage']) {
      return (
        <div style={styles.button} onClick={() => handleModuleNavigation('digital_signage', '/dashboard/digital-signage')}>
          <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
          <span>{displayName}</span>
        </div>
      );
    }

    // Mail - dedicated category with automation shortcut
    if (moduleKey === 'mail' && enabledModules['mail']) {
      const canViewAnyMailPage =
        canViewPage('mail.dashboard.view') ||
        canViewPage('mail.campaigns.view') ||
        canViewPage('mail.contacts.view') ||
        canViewPage('mail.settings.view');

      if (!canViewAnyMailPage) {
        return null;
      }

      return (
        <>
          <div style={styles.button} onClick={() => handleCategoryToggle('mail')}>
            <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
            <span style={{ flex: 1 }}>{displayName}</span>
            <span>{expandedCategory === 'mail' ? <FiChevronDown /> : <FiChevronRight />}</span>
          </div>
          {expandedCategory === 'mail' && (
            <>
              {canViewPage('mail.campaigns.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('mail', '/dashboard/mail/builder')}>
                  <span style={styles.subIcon}>•</span>
                  <span>One Time Campaigns</span>
                </div>
              )}
              {canViewPage('mail.campaigns.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('mail', '/dashboard/mail/automations')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Automations</span>
                </div>
              )}
              {canViewPage('mail.campaigns.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('mail', '/dashboard/mail/billing')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Usage</span>
                </div>
              )}
              {canViewPage('mail.settings.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('mail', '/dashboard/mail/settings')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Settings</span>
                </div>
              )}
            </>
          )}
        </>
      );
    }

    // Reputation module
    if (moduleKey === 'reputation' && enabledModules['reputation']) {
      return (
        <div style={styles.button} onClick={() => handleModuleNavigation('reputation', '/dashboard/reputation')}>
          <span style={styles.icon}>{getModuleIcon(module.icon || 'FiStar')}</span>
          <span>{displayName}</span>
        </div>
      );
    }

    if (moduleKey === 'reminders' && enabledModules['reminders']) {
      return (
        <div style={styles.button} onClick={() => handleModuleNavigation('reminders', '/dashboard/reminders')}>
          <span style={styles.icon}>{getModuleIcon(module.icon || 'FiBell')}</span>
          <span>{displayName}</span>
        </div>
      );
    }

    if (moduleKey === 'tavari_apis' && enabledModules['tavari_apis']) {
      return (
        <div style={styles.button} onClick={() => handleModuleNavigation('tavari_apis', '/dashboard/tavari-apis')}>
          <span style={styles.icon}>{getModuleIcon(module.icon || 'FiGlobe')}</span>
          <span>{displayName}</span>
        </div>
      );
    }

    // Social Media module
    if (moduleKey === 'social_media' && enabledModules['social_media']) {
      return (
        <div style={styles.button} onClick={() => handleModuleNavigation('social_media', '/dashboard/social-media')}>
          <span style={styles.icon}>{getModuleIcon(module.icon || 'FiShare2')}</span>
          <span>{displayName}</span>
        </div>
      );
    }

    // Bookings — expandable sub-navigation (like POS)
    if (moduleKey === 'bookings' && enabledModules['bookings']) {
      const canViewBookingsNav =
        canViewPage('bookings.view') || canViewPage('bookings.view_all');
      const canManageBookingSettingsNav =
        hasPermission('bookings.settings.edit') ||
        hasElevatedPrivileges() ||
        isManager();
      const canViewRegistrationFormsNav =
        canManageBookingSettingsNav ||
        canViewPage('bookings.view') ||
        canViewPage('bookings.view_all');

      return (
        <>
          <div style={getModuleButtonStyle('bookings')} onClick={() => handleCategoryToggle('bookings')}>
            <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
            <span style={{ flex: 1 }}>{displayName}</span>
            <span>{expandedCategory === 'bookings' ? <FiChevronDown /> : <FiChevronRight />}</span>
          </div>
          {expandedCategory === 'bookings' && (
            <>
              {canViewBookingsNav && (
                <div
                  style={styles.subButton}
                  onClick={() => handleModuleNavigation('bookings', '/dashboard/bookings')}
                >
                  <span style={styles.subIcon}>•</span>
                  <span>Dashboard</span>
                </div>
              )}
              {canViewRegistrationFormsNav && (
                <div
                  style={styles.subButton}
                  onClick={() => go('/dashboard/bookings?tab=registration-forms')}
                >
                  <span style={styles.subIcon}>•</span>
                  <span>Registration forms</span>
                </div>
              )}
              {canViewBookingsNav && (
                <div
                  style={styles.subButton}
                  onClick={() => handleModuleNavigation('bookings', '/dashboard/bookings/parties')}
                >
                  <span style={styles.subIcon}>•</span>
                  <span>Parties</span>
                </div>
              )}
            </>
          )}
        </>
      );
    }

    // Waivers â€” single entry; sub-features live inside the module (tabs/screens)
    if (moduleKey === 'waivers' && enabledModules['waivers']) {
      return (
        <div style={getModuleButtonStyle('waivers')} onClick={() => handleModuleNavigation('waivers', '/dashboard/waivers')}>
          <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
          <span>{displayName}</span>
        </div>
      );
    }

    // Vending â€” standalone module (not under POS)
    if (moduleKey === 'vending' && enabledModules['vending']) {
      return (
        <div style={styles.button} onClick={() => handleModuleNavigation('vending', '/dashboard/vending')}>
          <span style={styles.icon}>{getModuleIcon(module.icon || 'FiCpu')}</span>
          <span>{displayName}</span>
        </div>
      );
    }

    // Power Bank â€” ChargeNow shared cabinets
    if (moduleKey === 'power_bank' && enabledModules['power_bank']) {
      return (
        <div style={styles.button} onClick={() => handleModuleNavigation('power_bank', '/dashboard/power-bank')}>
          <span style={styles.icon}>{getModuleIcon(module.icon || 'FiZap')}</span>
          <span>{displayName}</span>
        </div>
      );
    }

    // Tavari Forms â€” operational checklists (separate from waivers)
    if (moduleKey === 'forms' && enabledModules['forms']) {
      return (
        <div style={styles.button} onClick={() => handleModuleNavigation('forms', '/dashboard/forms')}>
          <span style={styles.icon}>{getModuleIcon(module.icon || 'FiFileText')}</span>
          <span>{displayName}</span>
        </div>
      );
    }

    // Tavari Task Manager
    if (moduleKey === 'tasks' && enabledModules['tasks']) {
      return (
        <div style={styles.button} onClick={() => handleModuleNavigation('tasks', '/dashboard/tasks')}>
          <span style={styles.icon}>{getModuleIcon(module.icon || 'FiClipboard')}</span>
          <span>{displayName}</span>
        </div>
      );
    }

    // Default: simple button navigation
    return (
      <div style={styles.button} onClick={() => handleModuleNavigation(moduleKey, dashboardRoute)}>
        <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
        <span>{displayName}</span>
      </div>
    );
  };

  // Show loading state while auth initializes
  if (!isReady) {
    return (
    <div className="tavari-sidebar-nav" style={styles.sidebar}>
      <div style={styles.sidebarBody}>
          <div style={styles.loadingState}>Loading...</div>
        </div>
        <div style={styles.sidebarFooter}>{SIDEBAR_DEPLOYMENT_LABEL}</div>
      </div>
    );
  }

  return (
    <div className="tavari-sidebar-nav" style={styles.sidebar}>
      <div style={styles.sidebarBody}>
      {/* FIXED ITEMS - Always visible */}
      {/* Home */}
      <div style={styles.button} onClick={() => go('/dashboard/home')}>
        <span style={styles.icon}><FiHome /></span>
        <span>Home</span>
      </div>

      {/* Customers */}
      {canViewPage('pos.customers.view') && (
        <div style={styles.button} onClick={() => go('/dashboard/pos/customers')}>
          <span style={styles.icon}><FiUser /></span>
          <span>Customers</span>
        </div>
      )}

      {/* Employees */}
      {canViewPage('hr.employees.view') && (
        <div style={styles.button} onClick={() => handleNavigation('/dashboard/employees')}>
          <span style={styles.icon}><FiUsers /></span>
          <span>Employees</span>
        </div>
      )}

      {/* Reports & Analytics */}
      {(canViewPage('reports.dashboard.view') || canViewPage('reports.pos.view') || canViewPage('reports.hr.view') || canViewPage('reports.music.view') || canViewPage('reports.mail.view') || canViewPage('reports.overview.view') || canViewPage('reports.automation.view') || canViewPage('reports.audit.view')) && (
        <>
          <div style={styles.button} onClick={() => handleCategoryToggle('reports')}>
            <span style={styles.icon}><FiPieChart /></span>
            <span style={{ flex: 1 }}>Reports & Analytics</span>
            <span>{expandedCategory === 'reports' ? <FiChevronDown /> : <FiChevronRight />}</span>
          </div>
          {expandedCategory === 'reports' && (
            <>
              {canViewPage('reports.dashboard.view') && (
                <div style={styles.subButton} onClick={() => handleNavigation('/dashboard/reports')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Reports Dashboard</span>
                </div>
              )}
              {canViewPage('reports.automation.view') && (
                <div style={styles.subButton} onClick={() => handleNavigation('/dashboard/reports/automation')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Report Automation</span>
                </div>
              )}
              {canViewPage('reports.audit.view') && (
              <div style={styles.subButton} onClick={() => handleNavigation('/dashboard/audit-logs')}>
                <span style={styles.subIcon}>•</span>
                <span>Audit Log Viewer</span>
              </div>
              )}
            </>
          )}
        </>
      )}

      {/* Private Dividend Income â€” Christian Fournier personal business only */}
      {showPersonalDividendIncome && (
        <div
          style={styles.button}
          onClick={() => handleModuleNavigation('dividend_income', '/dashboard/dividend-income')}
        >
          <span style={styles.icon}><FiDollarSign /></span>
          <span>Dividend Income</span>
        </div>
      )}

      {/* File Storage â€” fixed between Reports & Analytics and System Settings */}
      {(enabledModules['file_storage'] || import.meta.env.DEV) && (
        <>
          <div
            style={styles.button}
            onClick={() => handleCategoryToggle('file_storage')}
            title={!enabledModules['file_storage'] && import.meta.env.DEV ? 'Dev: enable in Supabase for production' : undefined}
          >
            <span style={styles.icon}><FiFolder /></span>
            <span style={{ flex: 1 }}>File Storage</span>
            <span>{expandedCategory === 'file_storage' ? <FiChevronDown /> : <FiChevronRight />}</span>
          </div>
          {expandedCategory === 'file_storage' && (
            <>
              <div
                style={styles.subButton}
                onClick={() => handleModuleNavigation('file_storage', '/dashboard/file-storage')}
              >
                <span style={styles.subIcon}>•</span>
                <span>Dashboard</span>
              </div>
              <div
                style={styles.subButton}
                onClick={() => handleModuleNavigation('file_storage', '/dashboard/file-storage/paper-forms')}
              >
                <span style={styles.subIcon}>•</span>
                <span>Paper Forms</span>
              </div>
            </>
          )}
        </>
      )}

      {/* System Settings */}
      {(canViewPage('settings.basic_info.view') || canViewPage('settings.operating_hours.view') || canViewPage('settings.holiday_hours.view') || canViewPage('settings.roles.view') || canViewPage('settings.branding.view') || canViewPage('settings.scheduling.view') || canViewPage('settings.payments.view') || canViewPage('settings.taxes.view') || canViewPage('settings.security.view')) && (
        <div style={styles.button} onClick={() => handleNavigation('/dashboard/settings')}>
          <span style={styles.icon}><FiSettings /></span>
          <span>System Settings</span>
        </div>
      )}

      {/* DIVIDER - Separator between fixed items and modules */}
      {(priorityModules.length > 0 || alphabeticalModules.length > 0) && (
        <div style={styles.divider} />
      )}

      {/* Priority modules: Tavari POS, Tavari Bookings, Tavari Waivers */}
      {priorityModules.flatMap((module) => {
        const rendered = renderModuleNavigation(module);
        if (!rendered) return [];
        return [
          <React.Fragment key={module.module_key}>
            {rendered}
          </React.Fragment>,
        ];
      })}

      {priorityModules.length > 0 && alphabeticalModules.length > 0 && (
        <div style={styles.divider} />
      )}

      {/* All other modules â€” alphabetical with Tavari prefix */}
      {alphabeticalModules.flatMap((module) => {
        const moduleKey = module.module_key;
        const moduleName = (module.module_name || '').toLowerCase();

        if (moduleKey === 'settings' || moduleKey === 'system_settings' || moduleKey === 'reports' || moduleKey === 'file_storage' || moduleKey === 'dividend_income' ||
            moduleName.includes('system settings') || (moduleName.includes('settings') && !moduleName.includes('module'))) {
          return [];
        }

        const rendered = renderModuleNavigation(module);
        if (!rendered) return [];

        return [
          <React.Fragment key={moduleKey}>
            {rendered}
          </React.Fragment>,
        ];
      })}
      </div>
      <div style={styles.sidebarFooter}>{SIDEBAR_DEPLOYMENT_LABEL}</div>
    </div>
  );
};

const styles = {
  sidebar: {
    width: '240px',
    minWidth: '240px',
    flexShrink: 0,
    backgroundColor: '#f8f8f8',
    paddingTop: '60px',
    borderRight: '1px solid #ddd',
    minHeight: '100vh',
    boxSizing: 'border-box',
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  sidebarBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  sidebarFooter: {
    flexShrink: 0,
    padding: '10px 12px 14px',
    borderTop: '1px solid #ddd',
    fontSize: '14px',
    color: '#666',
    textAlign: 'center',
    lineHeight: 1.35,
    backgroundColor: '#f0f0f0',
  },
  button: {
    padding: '12px 16px',
    fontWeight: 'bold',
    color: '#333',
    borderBottom: '1px solid #ccc',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  priorityButton: {
    padding: '12px 16px',
    fontWeight: 'bold',
    color: '#ffffff',
    backgroundColor: TavariStyles.colors.primary,
    borderBottom: '1px solid #006666',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  subButton: {
    padding: '10px 28px',
    fontSize: '18px',
    fontWeight: 'normal',
    color: '#444',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#f0f0f0',
    borderBottom: '1px solid #ddd',
  },
  icon: {
    fontSize: '12px',
    width: '20px',
    textAlign: 'center',
  },
  subIcon: {
    fontSize: '14px',
    width: '20px',
    textAlign: 'center',
  },
  loadingState: {
    padding: '20px',
    textAlign: 'center',
    color: '#666',
    fontSize: '11px'
  },
  divider: {
    height: '2px',
    backgroundColor: '#ddd',
    margin: '8px 16px',
    borderRadius: '1px'
  }
};

export default SidebarNav;

