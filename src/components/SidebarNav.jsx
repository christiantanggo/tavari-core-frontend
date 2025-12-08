// components/SidebarNav.jsx - Fixed items at top, then activated modules
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiHome, FiUsers, FiUser, FiBarChart2, FiMusic, FiMail, FiInbox, FiChevronDown, FiChevronRight, FiClipboard, FiPieChart, FiShoppingBag, FiPackage, FiDollarSign, FiSmartphone, FiSettings, FiFileText, FiSearch, FiUpload, FiMonitor, FiCalendar } from 'react-icons/fi';
import { TavariStyles } from '../utils/TavariStyles';
import { usePOSAuth } from '../hooks/usePOSAuth';
import { useBusiness } from '../contexts/BusinessContext';
import { usePermissions } from '../hooks/usePermissions';
import { useModulesEnabled } from '../hooks/useModuleEnabled';
import { useModuleCatalog } from '../hooks/useModuleCatalog';
import ModuleCatalogService from '../services/ModuleCatalogService';

const SidebarNav = ({ onNavigate }) => {
  // Single state to track which category is expanded (only one at a time)
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const navigate = useNavigate();

  // Get business context first
  const { business } = useBusiness();

  // Get user role for access control - only after business is set
  const { userRole, isManager, isOwner, authLoading, selectedBusinessId } = usePOSAuth({
    requiredRoles: null, // Allow any authenticated user to see sidebar
    requireBusiness: true,
    componentName: 'SidebarNav'
  });

  // Get permissions - use role from permissions hook for accuracy
  const { hasPermission, permissionsLoading, userRole: permissionsUserRole, userPermissions } = usePermissions();
  // Use role from permissions system if available, fallback to auth role
  const effectiveRole = permissionsUserRole || userRole;

  // Check which modules are enabled for this business
  const { modules: enabledModules, loading: modulesLoading } = useModulesEnabled([
    'pos', 'music', 'mail', 'hr', 'recipe_builder', 'scheduling', 'loyalty', 'digital_signage',
    'dining', 'bookings', 'liquor', 'inbox', 'appbuilder', 'waivers'
  ]);

  // Get activated modules for dynamic sidebar rendering
  // Use both useModuleCatalog (for marketplace data) and useModulesEnabled (for enabled check)
  // This ensures we have the most accurate module status
  const { activatedModules: rawActivatedModules, loading: catalogLoading } = useModuleCatalog();
  
  // Also get enabled modules from the old method as a fallback/verification
  // This ensures compatibility with existing module activation system

  // Define module display order (as specified by user)
  const moduleDisplayOrder = [
    'pos',              // Tavari POS
    'dining',           // Tavari Dining
    'inbox',            // Tavari Inbox
    'waivers',          // Tavari Waivers
    'bookings',         // Tavari Bookings
    'scheduling',       // Tavari Scheduling
    'hr',               // Tavari HR
    // Note: Payroll is shown as separate navigation item after HR (not a module)
    'mail',             // Tavari Mail
    'appbuilder',       // Tavari App Builder
    'music',            // Tavari Music
    'recipe_builder',   // Tavari Recipe Manager
    'liquor',           // Tavari Liquor Management
    'digital_signage',  // Digital Signage (if not in list, add at end)
    'loyalty'           // Loyalty (if not in list, add at end)
  ];

  // Sort activated modules according to display order
  const activatedModules = React.useMemo(() => {
    if (!rawActivatedModules || rawActivatedModules.length === 0) {
      return [];
    }
    
    // Filter out System Settings and Reports - they're already fixed items at the top
    const filteredModules = rawActivatedModules.filter(m => {
      const key = (m.module_key || '').toLowerCase();
      const name = (m.module_name || '').toLowerCase();
      
      // Filter by module_key - be very explicit
      if (key === 'settings' || 
          key === 'system_settings' || 
          key === 'system-settings' ||
          key === 'reports' ||
          key === 'system') {
        return false;
      }
      
      // Also filter by module_name to catch any variations
      // Match "System Settings", "Settings", but NOT "Module Settings" or similar
      if (name.includes('system settings') || 
          (name.includes('settings') && !name.includes('module') && !name.includes('app'))) {
        return false;
      }
      
      return true;
    });
    
    // Create a map for quick lookup
    const moduleMap = new Map(filteredModules.map(m => [m.module_key, m]));
    
    // Sort according to display order, then by usage count for modules not in order list
    const ordered = [];
    const unordered = [];
    
    // First, add modules in specified order
    moduleDisplayOrder.forEach(key => {
      if (moduleMap.has(key)) {
        ordered.push(moduleMap.get(key));
        moduleMap.delete(key);
      }
    });
    
    // Then add any remaining modules (not in order list) sorted by usage
    moduleMap.forEach(module => {
      unordered.push(module);
    });
    
    // Sort unordered modules by usage count (descending), then by last used
    unordered.sort((a, b) => {
      if (b.usageCount !== a.usageCount) {
        return b.usageCount - a.usageCount;
      }
      if (b.lastUsed && a.lastUsed) {
        return new Date(b.lastUsed) - new Date(a.lastUsed);
      }
      if (b.lastUsed && !a.lastUsed) return -1;
      if (a.lastUsed && !b.lastUsed) return 1;
      return a.module_name.localeCompare(b.module_name);
    });
    
    return [...ordered, ...unordered];
  }, [rawActivatedModules]);
  
  // Also filter out settings/reports from fallback modules
  const filteredFallbackModules = React.useMemo(() => {
    if (!enabledModules) return [];
    
    const knownModules = {
      'dining': { name: 'Tavari Dining', route: '/dashboard/dining/dashboard', icon: 'FiShoppingBag' },
      'bookings': { name: 'Tavari Bookings', route: '/dashboard/bookings', icon: 'FiCalendar' },
      'liquor': { name: 'Tavari Liquor Management', route: '/dashboard/liquor/inventory', icon: 'FiPackage' },
      'inbox': { name: 'Tavari Inbox', route: '/dashboard/inbox', icon: 'FiInbox' },
      'appbuilder': { name: 'Tavari App Builder', route: '/dashboard/appbuilder', icon: 'FiSmartphone' },
      'waivers': { name: 'Tavari Waivers', route: '/dashboard/waivers', icon: 'FiFileText' }
    };
    
    // Get enabled modules that aren't already rendered, excluding fixed items
    return moduleDisplayOrder
      .filter(key => {
        if (!enabledModules[key]) return false;
        // Exclude fixed items (settings, reports, etc.)
        if (key === 'settings' || key === 'system_settings' || key === 'reports') return false;
        // Check if this module is already rendered in activatedModules
        return !activatedModules?.some(m => m.module_key === key);
      })
      .map(key => ({
        key,
        ...knownModules[key]
      }))
      .filter(m => m.name); // Only include known modules
  }, [enabledModules, activatedModules, moduleDisplayOrder]);

  // Wait for business context and auth to be ready
  useEffect(() => {
    if (business?.id && !authLoading && !permissionsLoading && !modulesLoading && !catalogLoading && selectedBusinessId) {
      setIsReady(true);
    } else {
      setIsReady(false);
    }
  }, [business?.id, authLoading, permissionsLoading, modulesLoading, catalogLoading, selectedBusinessId]);

  // Check if user can access employee management (manager, admin, owner only)
  const canAccessEmployees = isReady && (userRole === 'manager' || userRole === 'admin' || userRole === 'owner' || isManager || isOwner);

  // Permission check helper - returns true if page should be visible
  const canViewPage = (permissionKey) => {
    if (!isReady || permissionsLoading) return false;
    if (!permissionKey) return false;
    
    // For employees specifically, STRICTLY check permissions only
    if (effectiveRole === 'employee') {
      return hasPermission(permissionKey);
    }
    
    // For owners/admins/managers, they can see everything (legacy behavior)
    if (effectiveRole === 'owner' || effectiveRole === 'admin' || effectiveRole === 'manager') {
      return true;
    }
    
    // For all other roles, strictly check permissions
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

  // Get module icon component
  const getModuleIcon = (iconName) => {
    const iconMap = {
      'FiMail': <FiMail />,
      'FiMusic': <FiMusic />,
      'FiMonitor': <FiMonitor />,
      'FiUsers': <FiUsers />,
      'FiShoppingCart': <FiBarChart2 />,
      'FiPackage': <FiPackage />,
      'FiStar': <FiBarChart2 />,
      'FiCalendar': <FiCalendar />,
      'FiShoppingBag': <FiShoppingBag />,
      'FiInbox': <FiInbox />,
      'FiSmartphone': <FiSmartphone />,
      'FiFileText': <FiFileText />
    };
    return iconMap[iconName] || <FiPackage />;
  };

  // Render module navigation based on module key
  const renderModuleNavigation = (module) => {
    const moduleKey = module.module_key;
    
    // Don't render System Settings or Reports as modules - they're fixed items
    if (moduleKey === 'settings' || moduleKey === 'system_settings' || moduleKey === 'reports') {
      return null;
    }
    
    // Also check by name
    const moduleName = (module.module_name || '').toLowerCase();
    if (moduleName.includes('system settings') || (moduleName.includes('settings') && !moduleName.includes('module'))) {
      return null;
    }
    
    const dashboardRoute = ModuleCatalogService.getModuleDashboardRoute(moduleKey);

    // Special handling for modules with sub-navigation
    if (moduleKey === 'pos' && enabledModules['pos']) {
      return (
        <>
          <div style={styles.button} onClick={() => handleCategoryToggle('pos')}>
            <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
            <span style={{ flex: 1 }}>{module.module_name}</span>
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
              {canViewPage('pos.inventory.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/inventory')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Inventory</span>
                </div>
              )}
              {canViewPage('pos.categories.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('pos', '/dashboard/pos/categories')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Categories</span>
                </div>
              )}
            </>
          )}
        </>
      );
    }

    // HR module - show HR dashboard, but also show Payroll as separate if enabled
    if (moduleKey === 'hr' && enabledModules['hr']) {
      return (
        <>
          <div style={styles.button} onClick={() => handleCategoryToggle('hr')}>
            <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
            <span style={{ flex: 1 }}>{module.module_name}</span>
            <span>{expandedCategory === 'hr' ? <FiChevronDown /> : <FiChevronRight />}</span>
          </div>
          {expandedCategory === 'hr' && (
            <>
              {canViewPage('hr.employees.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('hr', '/dashboard/hr/dashboard')}>
                  <span style={styles.subIcon}>•</span>
                  <span>HR Dashboard</span>
                </div>
              )}
              {canViewPage('hr.employees.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('hr', '/dashboard/hr/employees')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Employee Profiles</span>
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
          <span>Tavari Payroll</span>
        </div>
      );
    }

    // Digital Signage with sub-navigation
    if (moduleKey === 'digital_signage' && enabledModules['digital_signage']) {
      return (
        <>
          <div style={styles.button} onClick={() => handleCategoryToggle('digital_signage')}>
            <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
            <span style={{ flex: 1 }}>{module.module_name}</span>
            <span>{expandedCategory === 'digital_signage' ? <FiChevronDown /> : <FiChevronRight />}</span>
          </div>
          {expandedCategory === 'digital_signage' && (
            <>
              {canViewPage('digital_signage.dashboard.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('digital_signage', '/dashboard/digital-signage')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Dashboard</span>
                </div>
              )}
              {canViewPage('digital_signage.screens.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('digital_signage', '/dashboard/digital-signage/screens')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Screens</span>
                </div>
              )}
              {canViewPage('digital_signage.content.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('digital_signage', '/dashboard/digital-signage/content')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Content</span>
                </div>
              )}
            </>
          )}
        </>
      );
    }

    // Mail with sub-navigation
    if (moduleKey === 'mail' && enabledModules['mail']) {
      return (
        <>
          <div style={styles.button} onClick={() => handleCategoryToggle('mail')}>
            <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
            <span style={{ flex: 1 }}>{module.module_name}</span>
            <span>{expandedCategory === 'mail' ? <FiChevronDown /> : <FiChevronRight />}</span>
          </div>
          {expandedCategory === 'mail' && (
            <>
              {canViewPage('mail.dashboard.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('mail', '/dashboard/mail/dashboard')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Mail Dashboard</span>
                </div>
              )}
              {canViewPage('mail.campaigns.view') && (
                <div style={styles.subButton} onClick={() => handleModuleNavigation('mail', '/dashboard/mail/campaigns')}>
                  <span style={styles.subIcon}>•</span>
                  <span>Campaigns</span>
                </div>
              )}
            </>
          )}
        </>
      );
    }

    // Waivers with sub-navigation
    if (moduleKey === 'waivers' && enabledModules['waivers']) {
      return (
        <>
          <div style={styles.button} onClick={() => handleCategoryToggle('waivers')}>
            <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
            <span style={{ flex: 1 }}>{module.module_name}</span>
            <span>{expandedCategory === 'waivers' ? <FiChevronDown /> : <FiChevronRight />}</span>
          </div>
          {expandedCategory === 'waivers' && (
            <>
              <div style={styles.subButton} onClick={() => handleModuleNavigation('waivers', '/dashboard/waivers')}>
                <span style={styles.subIcon}>•</span>
                <span>Dashboard</span>
              </div>
              <div style={styles.subButton} onClick={() => handleModuleNavigation('waivers', '/dashboard/waivers/search')}>
                <span style={styles.subIcon}>•</span>
                <span>Search</span>
              </div>
            </>
          )}
        </>
      );
    }

    // Default: simple button navigation
    return (
      <div style={styles.button} onClick={() => handleModuleNavigation(moduleKey, dashboardRoute)}>
        <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
        <span>{module.module_name}</span>
      </div>
    );
  };

  // Show loading state while auth initializes
  if (!isReady) {
    return (
      <div style={styles.sidebar}>
        <div style={styles.loadingState}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={styles.sidebar}>
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
      {(canViewPage('reports.dashboard.view') || canViewPage('reports.pos.view') || canViewPage('reports.hr.view') || canViewPage('reports.music.view') || canViewPage('reports.mail.view') || canViewPage('reports.overview.view') || canViewPage('reports.automation.view')) && (
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
              <div style={styles.subButton} onClick={() => handleNavigation('/dashboard/audit-logs')}>
                <span style={styles.subIcon}>•</span>
                <span>Audit Log Viewer</span>
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
      {activatedModules && activatedModules.length > 0 && (
        <div style={styles.divider} />
      )}

      {/* ACTIVATED MODULES - Dynamically rendered */}
      {activatedModules && activatedModules.flatMap((module) => {
        const moduleKey = module.module_key;
        const moduleName = (module.module_name || '').toLowerCase();
        
        // Skip System Settings and Reports - they're fixed items
        if (moduleKey === 'settings' || moduleKey === 'system_settings' || moduleKey === 'reports' ||
            moduleName.includes('system settings') || (moduleName.includes('settings') && !moduleName.includes('module'))) {
          return [];
        }
        
        const result = [];
        
        // Render the module
        const rendered = renderModuleNavigation(module);
        if (!rendered) return []; // Skip if renderModuleNavigation returns null
        
        result.push(
          <React.Fragment key={moduleKey}>
            {rendered}
          </React.Fragment>
        );
        
        // Special case: If HR is enabled, show Payroll as separate item right after HR
        if (moduleKey === 'hr' && enabledModules['hr'] && canViewPage('hr.payroll.view')) {
          result.push(
            <div key="payroll-separate" style={styles.button} onClick={() => handleModuleNavigation('hr', '/dashboard/hr/payroll')}>
              <span style={styles.icon}><FiDollarSign /></span>
              <span>Tavari Payroll</span>
            </div>
          );
        }
        
        return result;
      })}
      
      {/* FALLBACK: Render enabled modules that might not be in activatedModules from catalog */}
      {/* This ensures modules like dining that are enabled but might not be in app_modules still show up */}
      {/* Note: Fixed items like System Settings and Reports are excluded */}
      {filteredFallbackModules && filteredFallbackModules.length > 0 && filteredFallbackModules.map(module => (
        <div key={`fallback-${module.key}`} style={styles.button} onClick={() => handleModuleNavigation(module.key, module.route)}>
          <span style={styles.icon}>{getModuleIcon(module.icon)}</span>
          <span>{module.name}</span>
        </div>
      ))}
    </div>
  );
};

const styles = {
  sidebar: {
    width: '240px',
    backgroundColor: '#f8f8f8',
    paddingTop: '60px',
    borderRight: '1px solid #ddd',
    minHeight: '100vh',
    boxSizing: 'border-box',
    position: 'relative',
    zIndex: 1,
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
  subButton: {
    padding: '10px 28px',
    fontSize: '14px',
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
    fontSize: '18px',
    width: '20px',
    textAlign: 'center',
  },
  subIcon: {
    fontSize: '12px',
    width: '20px',
    textAlign: 'center',
  },
  loadingState: {
    padding: '20px',
    textAlign: 'center',
    color: '#666',
    fontSize: '14px'
  },
  divider: {
    height: '2px',
    backgroundColor: '#ddd',
    margin: '8px 16px',
    borderRadius: '1px'
  }
};

export default SidebarNav;
