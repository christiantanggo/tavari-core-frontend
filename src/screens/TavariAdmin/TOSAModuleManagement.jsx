// TOSA Module Management - Admin interface for managing modules, tiers, and subscriptions
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiPackage, FiDollarSign, FiUsers, FiSettings, FiCheck, FiX, FiEdit, FiSearch, FiFilter } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { useTOSATavariAuth } from '../../hooks/useTOSATavariAuth';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import TOSASidebarNav from '../../components/TavariAdminComp/TOSASidebarNav';
import TOSAHeaderBar from '../../components/TavariAdminComp/TOSAHeaderBar';
import TOSAModuleTiersManager from '../../components/TavariAdminComp/TOSAModuleTiersManager';
import TOSAPackagesManager from '../../components/TavariAdminComp/TOSAPackagesManager';
import TOSABusinessSubscriptionsManager from '../../components/TavariAdminComp/TOSABusinessSubscriptionsManager';
import TOSAModuleBillingModal from '../../components/TavariAdminComp/TOSAModuleBillingModal';
import TOSABusinessModuleSeatAccessModal from '../../components/TavariAdminComp/TOSABusinessModuleSeatAccessModal';

const TOSAModuleManagement = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('modules'); // modules, businesses, tiers, packages, subscriptions

  // TOSA Authentication
  const auth = useTOSATavariAuth({
    requiredPermissions: ['module_management'],
    componentName: 'TOSAModuleManagement'
  });

  // Security context
  const {
    logSecurityEvent,
    recordAction
  } = useSecurityContext({
    componentName: 'TOSAModuleManagement',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  // State
  const [modules, setModules] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [businessModules, setBusinessModules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [selectedModule, setSelectedModule] = useState(null);
  const [billingModule, setBillingModule] = useState(null);
  const [seatAccess, setSeatAccess] = useState(null);
  const [businessStripeById, setBusinessStripeById] = useState({});

  // Load all modules
  useEffect(() => {
    if (auth.isAuthenticated) {
      // Force reload modules to ensure fresh data
      loadModules();
      loadBusinesses();
      loadBusinessModules();
    }
  }, [auth.isAuthenticated]);

  // Force reload when component mounts to ensure fresh data
  useEffect(() => {
    loadModules();
  }, []);

  const loadModules = async () => {
    try {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('app_modules')
        .select('*')
        .order('module_category', { ascending: true })
        .order('module_name', { ascending: true });

      if (err) {
        console.error('Error loading modules:', err);
        console.error('Error details:', {
          code: err.code,
          message: err.message,
          details: err.details,
          hint: err.hint
        });
        throw err;
      }
      
      console.log('✅ Loaded modules from database:', data);
      setModules(data || []);
      
      if (!data || data.length === 0) {
        console.warn('No modules found in app_modules table');
        toast.error('No modules found. Please seed the app_modules table.');
      }
    } catch (err) {
      console.error('Error loading modules:', err);
      setError('Failed to load modules: ' + (err.message || 'Unknown error'));
      toast.error('Failed to load modules: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const loadBusinesses = async () => {
    try {
      const { data, error: err } = await supabase
        .from('businesses')
        .select('id, name, business_email, created_at, stripe_subscription_id')
        .order('name', { ascending: true });

      if (err) throw err;
      setBusinesses(data || []);
      const stripeMap = {};
      (data || []).forEach((b) => {
        stripeMap[b.id] = b.stripe_subscription_id || null;
      });
      setBusinessStripeById(stripeMap);
    } catch (err) {
      console.error('Error loading businesses:', err);
    }
  };

  const formatModuleBilling = (module) => {
    const base = ((Number(module.billing_base_cents) || 0) / 100).toFixed(2);
    const seat = ((Number(module.billing_seat_cents) || 0) / 100).toFixed(2);
    const inc = module.billing_included_seats;
    const incLabel = inc === -1 ? '∞ included' : `${inc ?? 0} included`;
    return `$${base} base + $${seat}/seat (${incLabel})`;
  };

  const loadBusinessModules = async () => {
    try {
      const { data: moduleUsage, error: err } = await supabase
        .from('business_module_usage')
        .select('*')
        .order('created_at', { ascending: false });

      if (err) throw err;

      // Load related data separately since there's no foreign key relationship
      const businessIds = [...new Set(moduleUsage?.map(m => m.business_id) || [])];
      const moduleKeys = [...new Set(moduleUsage?.map(m => m.module_key).filter(Boolean) || [])];

      const [businessesData, modulesData] = await Promise.all([
        businessIds.length > 0 ? supabase
          .from('businesses')
          .select('id, name')
          .in('id', businessIds) : { data: [] },
        moduleKeys.length > 0 ? supabase
          .from('app_modules')
          .select('module_key, module_name, module_category, description')
          .in('module_key', moduleKeys) : { data: [] }
      ]);

      // Enrich module usage data with related info
      const enriched = (moduleUsage || []).map(usage => ({
        ...usage,
        businesses: businessesData.data?.find(b => b.id === usage.business_id) || null,
        app_modules: modulesData.data?.find(m => m.module_key === usage.module_key) || null
      }));

      setBusinessModules(enriched);
    } catch (err) {
      console.error('Error loading business modules:', err);
    }
  };

  const toggleModuleForBusiness = async (businessId, moduleKey, enabled) => {
    try {
      await logSecurityEvent('tosa_module_toggle', {
        action: enabled ? 'enable_module' : 'disable_module',
        business_id: businessId,
        module_key: moduleKey,
        tosa_user_id: auth.authUser?.id
      }, 'high');

      // Get module info
      const { data: moduleInfo } = await supabase
        .from('app_modules')
        .select('module_name')
        .eq('module_key', moduleKey)
        .single();

      const { error: err } = await supabase
        .from('business_module_usage')
        .upsert({
          business_id: businessId,
          module_key: moduleKey,
          module_name: moduleInfo?.module_name || moduleKey,
          enabled: enabled,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'business_id,module_key'
        });

      if (err) throw err;

      await recordAction('tosa_module_toggled', `${businessId}:${moduleKey}`, true);
      toast.success(`Module ${enabled ? 'enabled' : 'disabled'} successfully`);
      loadBusinessModules();
    } catch (err) {
      console.error('Error toggling module:', err);
      toast.error('Failed to toggle module');
    }
  };

  const getModuleStats = (moduleKey) => {
    const enabled = businessModules.filter(bm => bm.module_key === moduleKey && bm.enabled).length;
    const total = businessModules.filter(bm => bm.module_key === moduleKey).length;
    return { enabled, total };
  };

  const getBusinessModuleCount = (businessId) => {
    return businessModules.filter(bm => bm.business_id === businessId && bm.enabled).length;
  };

  const filteredModules = modules.filter(m => 
    m.module_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.module_key?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.module_category?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredBusinesses = businesses.filter(b =>
    b.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.business_email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderModulesTab = () => (
    <div style={styles.tabContent}>
      <div style={styles.searchBar}>
        <FiSearch style={{ marginRight: 8, color: TavariStyles.colors.gray500 }} />
        <input
          type="text"
          placeholder="Search modules..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />
      </div>

      <div style={styles.tableContainer}>
        <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.tableHeader}>Module Name</th>
                <th style={styles.tableHeader}>Module Key</th>
                <th style={styles.tableHeader}>Category</th>
                <th style={styles.tableHeader}>Description</th>
                <th style={styles.tableHeader}>Billing (CAD/mo)</th>
                <th style={{ ...styles.tableHeader, textAlign: 'center' }}>Enabled Count</th>
                <th style={styles.tableHeader}>Default</th>
                <th style={styles.tableHeader}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredModules.map(module => {
                const stats = getModuleStats(module.module_key);
                return (
                  <tr key={module.module_key} style={styles.tableRow}>
                    <td style={styles.tableCell}>
                    <div style={{ fontWeight: 600, color: TavariStyles.colors.gray900 }}>
                      {module.module_name}
                    </div>
                  </td>
                    <td style={styles.tableCell}>
                    <code style={{
                      fontSize: 13, 
                      color: TavariStyles.colors.gray600,
                      backgroundColor: TavariStyles.colors.gray100,
                      padding: '2px 6px',
                      borderRadius: 4
                    }}>
                      {module.module_key}
                    </code>
                  </td>
                    <td style={styles.tableCell}>
                    <span style={styles.categoryBadge}>{module.module_category}</span>
                  </td>
                  <td style={styles.tableCell}>
                    <span style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                      {module.description || 'No description'}
                    </span>
                  </td>
                  <td style={styles.tableCell}>
                    <span style={{ fontSize: 13, color: TavariStyles.colors.gray700 }}>
                      {formatModuleBilling(module)}
                    </span>
                  </td>
                  <td style={{ ...styles.tableCell, textAlign: 'center' }}>
                    <span style={{ 
                      fontSize: 18, 
                      fontWeight: 700, 
                      color: TavariStyles.colors.primary 
                    }}>
                      {stats.enabled}
                    </span>
                  </td>
                  <td style={styles.tableCell}>
                    <span style={styles.defaultBadge}>
                      {module.enabled_by_default ? 'Default' : 'Optional'}
                    </span>
                  </td>
                  <td style={styles.tableCell}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button
                        type="button"
                        style={styles.viewButton}
                        onClick={() => setBillingModule(module)}
                      >
                        <FiDollarSign style={{ marginRight: 4 }} />
                        Pricing
                      </button>
                      <button
                        type="button"
                        style={styles.secondaryButton}
                        onClick={() => {
                          setSelectedModule(module.module_key);
                          setActiveTab('businesses');
                          setSearchTerm('');
                        }}
                      >
                        Businesses
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderBusinessesTab = () => (
    <div style={styles.tabContent}>
      {selectedModule && (
        <div style={styles.filterBanner}>
          <span>
            Showing businesses for module: <code>{selectedModule}</code>
          </span>
          <button type="button" style={styles.secondaryButton} onClick={() => setSelectedModule(null)}>
            Clear filter
          </button>
        </div>
      )}
      <div style={styles.searchBar}>
        <FiSearch style={{ marginRight: 8, color: TavariStyles.colors.gray500 }} />
        <input
          type="text"
          placeholder="Search businesses..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />
      </div>

      <div style={styles.businessesList}>
        {filteredBusinesses.map(business => {
          const enabledModules = businessModules.filter(
            bm => bm.business_id === business.id && bm.enabled
          );
          const moduleCount = enabledModules.length;

          return (
            <div key={business.id} style={styles.businessCard}>
              <div style={styles.businessHeader}>
                <div>
                  <h3 style={styles.businessName}>{business.name}</h3>
                  <p style={styles.businessEmail}>{business.business_email || 'No email'}</p>
                </div>
                <div style={styles.businessStats}>
                  <span style={styles.moduleCount}>{moduleCount} modules enabled</span>
                </div>
              </div>

              <div style={styles.modulesList}>
                {(selectedModule
                  ? modules.filter((m) => m.module_key === selectedModule)
                  : modules
                ).map(module => {
                  const businessModule = businessModules.find(
                    bm => bm.business_id === business.id && bm.module_key === module.module_key
                  );
                  const isEnabled = businessModule?.enabled || false;

                  return (
                    <div key={module.module_key} style={styles.moduleToggle}>
                      <div style={styles.moduleToggleInfo}>
                        <span style={styles.moduleToggleName}>{module.module_name}</span>
                        <span style={styles.moduleToggleCategory}>
                          {module.module_category} · {formatModuleBilling(module)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          style={styles.seatButton}
                          onClick={() => setSeatAccess({
                            businessId: business.id,
                            businessName: business.name,
                            moduleKey: module.module_key,
                            moduleName: module.module_name,
                            stripeSubscriptionId: businessStripeById[business.id] || business.stripe_subscription_id,
                          })}
                        >
                          Seats
                        </button>
                        <button
                          type="button"
                          style={{
                            ...styles.toggleButton,
                            backgroundColor: isEnabled ? TavariStyles.colors.success : TavariStyles.colors.gray300,
                            color: isEnabled ? '#fff' : TavariStyles.colors.gray700
                          }}
                          onClick={() => toggleModuleForBusiness(business.id, module.module_key, !isEnabled)}
                        >
                          {isEnabled ? <FiCheck /> : <FiX />}
                          {isEnabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderTiersTab = () => (
    <div style={styles.tabContent}>
      <TOSAModuleTiersManager onTierUpdate={() => {
        loadModules();
        loadBusinessModules();
      }} />
    </div>
  );

  const renderPackagesTab = () => (
    <div style={styles.tabContent}>
      <TOSAPackagesManager onPackageUpdate={() => {
        loadModules();
        loadBusinessModules();
      }} />
    </div>
  );

  return (
    <SecurityWrapper componentName="TOSAModuleManagement" sensitiveComponent={true} securityLevel="critical">
      <div style={styles.container}>
        <TOSASidebarNav />
        
        <div style={styles.content}>
          <TOSAHeaderBar />
          
          <main style={styles.main}>
            <div style={styles.header}>
              <h1 style={styles.title}>Module Management</h1>
              <p style={styles.subtitle}>
                Manage modules, configure pricing tiers, and control business subscriptions
              </p>
            </div>

            {/* Tabs */}
            <div style={styles.tabsContainer}>
              <button
                style={{
                  ...styles.tab,
                  ...(activeTab === 'modules' ? styles.tabActive : {})
                }}
                onClick={() => setActiveTab('modules')}
              >
                <FiPackage style={{ marginRight: 8 }} />
                All Modules ({modules.length})
              </button>
              <button
                style={{
                  ...styles.tab,
                  ...(activeTab === 'businesses' ? styles.tabActive : {})
                }}
                onClick={() => setActiveTab('businesses')}
              >
                <FiUsers style={{ marginRight: 8 }} />
                Business Modules ({businesses.length})
              </button>
              <button
                style={{
                  ...styles.tab,
                  ...(activeTab === 'tiers' ? styles.tabActive : {})
                }}
                onClick={() => setActiveTab('tiers')}
              >
                <FiDollarSign style={{ marginRight: 8 }} />
                Pricing Tiers
              </button>
              <button
                style={{
                  ...styles.tab,
                  ...(activeTab === 'packages' ? styles.tabActive : {})
                }}
                onClick={() => setActiveTab('packages')}
              >
                <FiPackage style={{ marginRight: 8 }} />
                Packages
              </button>
              <button
                style={{
                  ...styles.tab,
                  ...(activeTab === 'subscriptions' ? styles.tabActive : {})
                }}
                onClick={() => setActiveTab('subscriptions')}
              >
                <FiUsers style={{ marginRight: 8 }} />
                Business Subscriptions
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'modules' && renderModulesTab()}
            {activeTab === 'businesses' && renderBusinessesTab()}
            {activeTab === 'tiers' && renderTiersTab()}
            {activeTab === 'packages' && renderPackagesTab()}
            {activeTab === 'subscriptions' && (
              <div style={styles.tabContent}>
                <TOSABusinessSubscriptionsManager />
              </div>
            )}
          </main>
        </div>
      </div>

      {billingModule && (
        <TOSAModuleBillingModal
          module={billingModule}
          onClose={() => setBillingModule(null)}
          onSaved={loadModules}
        />
      )}
      {seatAccess && (
        <TOSABusinessModuleSeatAccessModal
          businessId={seatAccess.businessId}
          businessName={seatAccess.businessName}
          moduleKey={seatAccess.moduleKey}
          moduleName={seatAccess.moduleName}
          stripeSubscriptionId={seatAccess.stripeSubscriptionId}
          onClose={() => setSeatAccess(null)}
        />
      )}
    </SecurityWrapper>
  );
};

const styles = {
  container: {
    display: 'flex',
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.background,
  },
  content: {
    flex: 1,
    marginLeft: 250,
    display: 'flex',
    flexDirection: 'column',
  },
  main: {
    flex: 1,
    padding: TavariStyles.spacing.xl,
    overflowY: 'auto',
  },
  header: {
    marginBottom: TavariStyles.spacing.xl,
  },
  title: {
    fontSize: 33,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
    margin: 0,
    marginBottom: TavariStyles.spacing.sm,
  },
  subtitle: {
    fontSize: 16,
    color: TavariStyles.colors.gray600,
    margin: 0,
  },
  tabsContainer: {
    display: 'flex',
    gap: 8,
    marginBottom: TavariStyles.spacing.xl,
    borderBottom: `2px solid ${TavariStyles.colors.border}`,
    paddingBottom: TavariStyles.spacing.md,
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '3px solid transparent',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    color: TavariStyles.colors.gray600,
    transition: 'all 0.2s',
  },
  tabActive: {
    color: TavariStyles.colors.primary,
    borderBottom: `3px solid ${TavariStyles.colors.primary}`,
  },
  tabContent: {
    padding: TavariStyles.spacing.lg,
  },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: '#fff',
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    marginBottom: TavariStyles.spacing.xl,
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    fontSize: 14,
    color: TavariStyles.colors.gray900,
  },
  tableContainer: {
    backgroundColor: '#fff',
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.lg,
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tableHeader: {
    padding: TavariStyles.spacing.md,
    textAlign: 'left',
    fontSize: 13,
    fontWeight: 600,
    color: TavariStyles.colors.gray700,
    borderBottom: `2px solid ${TavariStyles.colors.border}`,
    backgroundColor: TavariStyles.colors.gray50,
  },
  tableRow: {
    borderBottom: `1px solid ${TavariStyles.colors.border}`,
    transition: 'background-color 0.2s',
  },
  tableCell: {
    padding: TavariStyles.spacing.md,
    fontSize: 14,
    color: TavariStyles.colors.gray900,
  },
  emptyState: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xxl,
    color: TavariStyles.colors.gray600,
    backgroundColor: '#fff',
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.lg,
  },
  moduleName: {
    fontSize: 18,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    margin: 0,
    marginBottom: 4,
  },
  moduleKey: {
    fontSize: 13,
    color: TavariStyles.colors.gray500,
    margin: 0,
    fontFamily: 'monospace',
  },
  categoryBadge: {
    display: 'inline-block',
    padding: '4px 8px',
    backgroundColor: TavariStyles.colors.primary + '20',
    color: TavariStyles.colors.primary,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: 11,
    fontWeight: 500,
    marginTop: 4,
  },
  moduleStats: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 700,
    color: TavariStyles.colors.primary,
  },
  statLabel: {
    fontSize: 11,
    color: TavariStyles.colors.gray500,
    textTransform: 'uppercase',
  },
  moduleDescription: {
    fontSize: 14,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: TavariStyles.spacing.md,
    lineHeight: 1.5,
  },
  moduleFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  defaultBadge: {
    padding: '4px 8px',
    backgroundColor: TavariStyles.colors.gray100,
    color: TavariStyles.colors.gray700,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: 11,
    fontWeight: 500,
  },
  viewButton: {
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
  },
  secondaryButton: {
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.md}`,
    backgroundColor: '#fff',
    color: TavariStyles.colors.gray800,
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  },
  seatButton: {
    padding: '6px 10px',
    backgroundColor: TavariStyles.colors.gray100,
    color: TavariStyles.colors.gray800,
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  },
  filterBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.primary + '12',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: 13,
    color: TavariStyles.colors.gray800,
  },
  businessesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.lg,
  },
  businessCard: {
    backgroundColor: '#fff',
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.lg,
  },
  businessHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: TavariStyles.spacing.md,
    paddingBottom: TavariStyles.spacing.md,
    borderBottom: `1px solid ${TavariStyles.colors.border}`,
  },
  businessName: {
    fontSize: 20,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    margin: 0,
    marginBottom: 4,
  },
  businessEmail: {
    fontSize: 14,
    color: TavariStyles.colors.gray600,
    margin: 0,
  },
  businessStats: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 8,
  },
  moduleCount: {
    fontSize: 14,
    fontWeight: 500,
    color: TavariStyles.colors.gray700,
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: 13,
    fontWeight: 500,
  },
  modulesList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
    gap: TavariStyles.spacing.md,
  },
  moduleToggle: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.sm,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md,
  },
  moduleToggleInfo: {
    display: 'flex',
    flexDirection: 'column',
  },
  moduleToggleName: {
    fontSize: 13,
    fontWeight: 500,
    color: TavariStyles.colors.gray900,
  },
  moduleToggleCategory: {
    fontSize: 11,
    color: TavariStyles.colors.gray500,
  },
  toggleButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    transition: 'all 0.2s',
  },
  placeholderCard: {
    backgroundColor: '#fff',
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xxl,
    textAlign: 'center',
  },
};

export default TOSAModuleManagement;

