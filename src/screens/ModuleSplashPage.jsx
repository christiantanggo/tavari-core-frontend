// ModuleSplashPage.jsx
// Splash page for non-activated modules (shows pricing and activate button)
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiCheck, FiX, FiArrowLeft } from 'react-icons/fi';
import { useBusinessContext } from '../contexts/BusinessContext';
import { usePOSAuth } from '../hooks/usePOSAuth';
import { usePermissions } from '../hooks/usePermissions';
import ModuleCatalogService from '../services/ModuleCatalogService';
import AppBuilderModuleService from '../services/AppBuilder/AppBuilderModuleService';
import { TavariStyles } from '../utils/TavariStyles';
import SecurityWrapper from '../Security/SecurityWrapper';
import PermissionGate from '../components/Auth/PermissionGate';
import toast from 'react-hot-toast';

// Icon mapping for modules
const iconMap = {
  'FiMail': '📧',
  'FiMusic': '🎵',
  'FiMonitor': '🖥️',
  'FiUsers': '👥',
  'FiShoppingCart': '🛒',
  'FiPackage': '📦',
  'FiStar': '⭐',
  'FiCalendar': '📅',
  'FiShoppingBag': '🛍️',
  'FiInbox': '📥',
  'FiSmartphone': '📱',
  'FiFileText': '📄',
  'FiDollarSign': '💰',
  'FiCpu': '🥤'
};

const ModuleSplashPage = () => {
  const { moduleKey } = useParams();
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const [module, setModule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);

  const { userRole, isOwner, isManager } = usePOSAuth({
    requiredRoles: null,
    requireBusiness: true,
    componentName: 'ModuleSplashPage'
  });

  const { hasElevatedPrivileges } = usePermissions();

  const canActivate = hasElevatedPrivileges() || isOwner || isManager;

  useEffect(() => {
    if (!selectedBusinessId || !moduleKey) return;

    loadModule();
  }, [selectedBusinessId, moduleKey]);

  const loadModule = async () => {
    try {
      setLoading(true);
      ModuleCatalogService.setBusinessId(selectedBusinessId);
      const allModules = await ModuleCatalogService.getAllModulesWithStatus();
      const foundModule = allModules.find(m => m.module_key === moduleKey);
      setModule(foundModule);
    } catch (error) {
      console.error('Error loading module:', error);
      toast.error('Failed to load module information');
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async () => {
    if (!canActivate) {
      toast.error('You do not have permission to activate modules');
      return;
    }

    try {
      setActivating(true);
      AppBuilderModuleService.setBusinessId(selectedBusinessId);
      await AppBuilderModuleService.enableModule(moduleKey);
      
      toast.success(`${module?.module_name || 'Module'} activated successfully!`);
      
      // Track usage
      await ModuleCatalogService.trackModuleUsage(moduleKey);
      
      // Dispatch custom event to notify other components (like SidebarNav)
      window.dispatchEvent(new CustomEvent('module-activated', {
        detail: {
          moduleKey,
          businessId: selectedBusinessId,
          moduleName: module?.module_name
        }
      }));
      
      // Small delay to ensure sidebar updates before navigation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Navigate to module dashboard
      const dashboardRoute = ModuleCatalogService.getModuleDashboardRoute(moduleKey);
      navigate(dashboardRoute);
    } catch (error) {
      console.error('Error activating module:', error);
      toast.error('Failed to activate module. Please try again.');
    } finally {
      setActivating(false);
    }
  };

  if (loading) {
    return (
      <SecurityWrapper>
        <div style={styles.container}>
          <div style={styles.loading}>Loading module information...</div>
        </div>
      </SecurityWrapper>
    );
  }

  if (!module) {
    return (
      <SecurityWrapper>
        <div style={styles.container}>
          <div style={styles.error}>
            <h2>Module Not Found</h2>
            <p>The module you're looking for doesn't exist.</p>
            <button style={styles.backButton} onClick={() => navigate('/dashboard/home')}>
              <FiArrowLeft /> Back to Home
            </button>
          </div>
        </div>
      </SecurityWrapper>
    );
  }

  // If already activated, redirect to dashboard
  if (module.isEnabled) {
    const dashboardRoute = ModuleCatalogService.getModuleDashboardRoute(moduleKey);
    navigate(dashboardRoute);
    return null;
  }

  return (
    <SecurityWrapper>
      <PermissionGate
        requiredRoles={['owner', 'admin', 'manager']}
        requireBusiness={true}
        componentName="ModuleSplashPage"
      >
        <div style={styles.container}>
          <button style={styles.backButton} onClick={() => navigate('/dashboard/home')}>
            <FiArrowLeft /> Back to Modules
          </button>

          <div style={styles.content}>
            <div style={styles.iconContainer}>
              <div style={styles.icon}>
                {iconMap[module.icon] || '📦'}
              </div>
            </div>

            <h1 style={styles.title}>{module.module_name}</h1>
            <p style={styles.description}>{module.description}</p>

            <div style={styles.category}>
              <span style={styles.categoryBadge}>{module.module_category}</span>
            </div>

            {/* Features List */}
            <div style={styles.featuresSection}>
              <h3 style={styles.featuresTitle}>What's Included</h3>
              <div style={styles.featuresList}>
                {getModuleFeatures(module.module_key).map((feature, idx) => (
                  <div key={idx} style={styles.featureItem}>
                    <FiCheck style={styles.checkIcon} />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pricing Section */}
            <div style={styles.pricingSection}>
              <h3 style={styles.pricingTitle}>Pricing</h3>
              <div style={styles.pricingCard}>
                <div style={styles.pricingAmount}>
                  {formatModuleBillingLabel(module)}
                </div>
                <p style={styles.pricingNote}>
                  {getModulePricingNote(module)}
                </p>
              </div>
            </div>

            {/* Activate Button */}
            {canActivate ? (
              <button
                style={styles.activateButton}
                onClick={handleActivate}
                disabled={activating}
              >
                {activating ? 'Activating...' : 'Activate Module'}
              </button>
            ) : (
              <div style={styles.noPermission}>
                <p>You need owner, admin, or manager permissions to activate modules.</p>
              </div>
            )}
          </div>
        </div>
      </PermissionGate>
    </SecurityWrapper>
  );
};

// Helper functions for module-specific content
const getModuleFeatures = (moduleKey) => {
  const features = {
    'pos': [
      'Point of Sale System',
      'Inventory Management',
      'Sales Reports',
      'Receipt Printing',
      'Multi-station Support'
    ],
    'music': [
      'Playlist Management',
      'Ad Scheduling',
      'Revenue Sharing',
      'System Monitoring',
      'Multi-zone Support'
    ],
    'mail': [
      'Email Campaigns',
      'Contact Management',
      'Marketing Automation',
      'Template Builder',
      'Analytics & Reporting'
    ],
    'hr': [
      'Employee Management',
      'Payroll Processing',
      'Document Management',
      'Time Tracking',
      'HR Analytics'
    ],
    'digital_signage': [
      'Screen Management',
      'Content Scheduling',
      'Multi-zone Displays',
      'Dynamic Ads',
      'Menu Boards & Party Hosts'
    ],
    'recipe_builder': [
      'Recipe Management',
      'Supplier Integration',
      'Order Management',
      'Price Tracking',
      'Inventory Integration'
    ],
    'loyalty': [
      'Loyalty Programs',
      'Points & Rewards',
      'Customer Engagement',
      'Analytics',
      'POS Integration'
    ],
    'scheduling': [
      'Employee Scheduling',
      'Shift Management',
      'Time Clock',
      'Availability Tracking',
      'Payroll Integration'
    ],
    'dining': [
      'Table Management',
      'Floor Plan Editor',
      'Reservations',
      'Dining Orders',
      'Guest Management'
    ],
    'bookings': [
      'Event Bookings',
      'Party Packages',
      'Scheduling',
      'Deposits & Payments',
      'Calendar Management'
    ],
    'liquor': [
      'Liquor Inventory',
      'Compliance Tracking',
      'Supplier Management',
      'Reporting',
      'Audit Trails'
    ],
    'inbox': [
      'Email Inbox',
      'Domain Management',
      'Mailbox Configuration',
      'Email Routing',
      'Compliance Tools'
    ],
    'appbuilder': [
      'Custom App Creation',
      'Branding & Theming',
      'Module Configuration',
      'Build Management',
      'Deployment Tools'
    ],
    'waivers': [
      'Digital Waivers',
      'Template Management',
      'Compliance Tracking',
      'Signature Collection',
      'Renewal Management'
    ],
    'accounting': [
      'Sales batching (POS + Bookings)',
      'Expense approval from email',
      'P&L and HST reports',
      'ERPNext posting',
      'Period lock and deposit grouping'
    ],
    'vending': [
      'Cloud vending device registration',
      'Kiosk launch links & secrets',
      'Optional catalog SKU mapping',
      'Works without Tavari POS enabled'
    ],
    'reminders': [
      'Employee email & portal reminders',
      'Once, weekly, or monthly schedules',
      'Holiday-aware send dates',
      'Complete & remind tomorrow actions',
      'Per-staff targeting + manual emails'
    ]
  };
  return features[moduleKey] || ['Full feature access', '24/7 Support', 'Regular Updates'];
};

const formatModuleBillingLabel = (mod) => {
  if (!mod) return 'Contact Sales';
  const base = (Number(mod.billing_base_cents) || 0) / 100;
  const seat = (Number(mod.billing_seat_cents) || 0) / 100;
  const inc = mod.billing_included_seats;
  if (base === 0 && seat === 0) return 'Free';
  let label = `$${base.toFixed(2)}/month base`;
  if (seat > 0) {
    label += ` + $${seat.toFixed(2)}/user`;
    if (inc === -1) label += ' (seats included)';
    else if (inc > 0) label += ` (${inc} users included)`;
  }
  return label;
};

const getModulePricingNote = (mod) => {
  if (!mod) return 'Billed monthly in CAD. Cancel anytime.';
  const seat = (Number(mod.billing_seat_cents) || 0) / 100;
  if (seat > 0) {
    return 'Billed monthly in CAD. Only users with module access count as seats. Prorated when seats are added.';
  }
  return 'Billed monthly in CAD. Cancel anytime.';
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: TavariStyles?.colors?.gray50 || '#f9fafb',
    padding: TavariStyles?.spacing?.xl || '24px',
    paddingTop: '100px'
  },
  loading: {
    textAlign: 'center',
    padding: '60px 20px',
    fontSize: TavariStyles?.typography?.fontSize?.lg || '18px',
    color: TavariStyles?.colors?.gray600 || '#4b5563'
  },
  error: {
    textAlign: 'center',
    padding: '60px 20px',
    maxWidth: '600px',
    margin: '0 auto'
  },
  backButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px',
    backgroundColor: TavariStyles?.colors?.white || '#ffffff',
    border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
    borderRadius: TavariStyles?.borderRadius?.md || '8px',
    cursor: 'pointer',
    fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
    color: TavariStyles?.colors?.gray700 || '#374151',
    marginBottom: TavariStyles?.spacing?.xl || '24px',
    transition: 'all 0.2s ease'
  },
  content: {
    maxWidth: '800px',
    margin: '0 auto',
    backgroundColor: TavariStyles?.colors?.white || '#ffffff',
    borderRadius: TavariStyles?.borderRadius?.xl || '16px',
    padding: TavariStyles?.spacing?.['3xl'] || '48px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
  },
  iconContainer: {
    textAlign: 'center',
    marginBottom: TavariStyles?.spacing?.xl || '24px'
  },
  icon: {
    fontSize: '80px',
    marginBottom: TavariStyles?.spacing?.lg || '16px'
  },
  title: {
    fontSize: '2.5rem',
    fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
    color: TavariStyles?.colors?.gray900 || '#111827',
    textAlign: 'center',
    marginBottom: TavariStyles?.spacing?.md || '12px'
  },
  description: {
    fontSize: TavariStyles?.typography?.fontSize?.lg || '18px',
    color: TavariStyles?.colors?.gray600 || '#4b5563',
    textAlign: 'center',
    marginBottom: TavariStyles?.spacing?.xl || '24px',
    lineHeight: 1.6
  },
  category: {
    textAlign: 'center',
    marginBottom: TavariStyles?.spacing?.xl || '24px'
  },
  categoryBadge: {
    display: 'inline-block',
    padding: '6px 16px',
    backgroundColor: TavariStyles?.colors?.primary + '15' || '#00808015',
    color: TavariStyles?.colors?.primary || '#008080',
    borderRadius: TavariStyles?.borderRadius?.full || '9999px',
    fontSize: TavariStyles?.typography?.fontSize?.sm || '14px',
    fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500'
  },
  featuresSection: {
    marginBottom: TavariStyles?.spacing?.['2xl'] || '32px'
  },
  featuresTitle: {
    fontSize: TavariStyles?.typography?.fontSize?.xl || '20px',
    fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
    color: TavariStyles?.colors?.gray900 || '#111827',
    marginBottom: TavariStyles?.spacing?.lg || '16px'
  },
  featuresList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: TavariStyles?.spacing?.md || '12px'
  },
  featureItem: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles?.spacing?.sm || '8px',
    fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
    color: TavariStyles?.colors?.gray700 || '#374151'
  },
  checkIcon: {
    color: TavariStyles?.colors?.success || '#10b981',
    fontSize: '20px',
    flexShrink: 0
  },
  pricingSection: {
    marginBottom: TavariStyles?.spacing?.['2xl'] || '32px',
    textAlign: 'center'
  },
  pricingTitle: {
    fontSize: TavariStyles?.typography?.fontSize?.xl || '20px',
    fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
    color: TavariStyles?.colors?.gray900 || '#111827',
    marginBottom: TavariStyles?.spacing?.lg || '16px'
  },
  pricingCard: {
    backgroundColor: TavariStyles?.colors?.gray50 || '#f9fafb',
    borderRadius: TavariStyles?.borderRadius?.lg || '12px',
    padding: TavariStyles?.spacing?.xl || '24px'
  },
  pricingAmount: {
    fontSize: '3rem',
    fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
    color: TavariStyles?.colors?.primary || '#008080',
    marginBottom: TavariStyles?.spacing?.sm || '8px'
  },
  pricingNote: {
    fontSize: TavariStyles?.typography?.fontSize?.sm || '14px',
    color: TavariStyles?.colors?.gray600 || '#4b5563'
  },
  activateButton: {
    width: '100%',
    padding: '16px 32px',
    backgroundColor: TavariStyles?.colors?.primary || '#008080',
    color: TavariStyles?.colors?.white || '#ffffff',
    border: 'none',
    borderRadius: TavariStyles?.borderRadius?.lg || '12px',
    fontSize: TavariStyles?.typography?.fontSize?.lg || '18px',
    fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    marginTop: TavariStyles?.spacing?.xl || '24px'
  },
  noPermission: {
    textAlign: 'center',
    padding: TavariStyles?.spacing?.xl || '24px',
    backgroundColor: TavariStyles?.colors?.gray50 || '#f9fafb',
    borderRadius: TavariStyles?.borderRadius?.lg || '12px',
    color: TavariStyles?.colors?.gray600 || '#4b5563'
  }
};

export default ModuleSplashPage;

