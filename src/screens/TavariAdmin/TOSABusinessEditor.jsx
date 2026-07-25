// screens/TavariAdmin/TOSABusinessEditor.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiEdit, FiSave, FiX, FiDatabase, FiUsers, FiSettings, FiCreditCard } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import { useTOSATavariAuth } from '../../hooks/useTOSATavariAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';

// Foundation Components
import { TavariStyles } from '../../utils/TavariStyles';
import TOSAHeaderBar from '../../components/TavariAdminComp/TOSAHeaderBar';
import TOSASidebarNav from '../../components/TavariAdminComp/TOSASidebarNav';
import TOSABusinessSelector from '../../components/TavariAdminComp/TOSABusinessSelector';
import { formatDateShort, getBusinessTimezone } from '../../utils/businessDateFormat';

const TOSABusinessEditor = () => {
  const { businessId: paramBusinessId } = useParams();
  const navigate = useNavigate();

  // Security context for sensitive business editing operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'TOSABusinessEditor',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  // TOSA Authentication
  const auth = useTOSATavariAuth({
    requiredPermissions: ['business_management'],
    componentName: 'TOSABusinessEditor'
  });

  // Permission system (for additional granular checks)
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    isOwner,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks for TOSA operations
  const canViewBusinessData = auth.hasPermission?.('business_management') || false;
  const canEditBusinessData = auth.hasPermission?.('business_management') || false;
  const canViewEmployeeData = auth.hasPermission?.('user_management') || auth.hasPermission?.('business_management') || false;
  const canEditSubscription = auth.hasPermission?.('subscription_management') || false;

  const [selectedBusinessId, setSelectedBusinessId] = useState(paramBusinessId || null);
  const [activeTab, setActiveTab] = useState('general');
  const [businessData, setBusinessData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const businessTimezone = getBusinessTimezone(businessData);

  // Check TOSA authentication on mount
  // TOSA is now open - no auth check needed

  // Log initial access
  useEffect(() => {
    if (auth.isAuthenticated && auth.authUser) {
      logSecurityEvent('tosa_business_editor_accessed', {
        action: 'tosa_business_editor_loaded',
        tosa_user_id: auth.authUser.id,
        tosa_user_email: auth.authUser.email,
        param_business_id: paramBusinessId
      }, 'high');
    }
  }, [auth.isAuthenticated, auth.authUser, paramBusinessId]);

  useEffect(() => {
    if (selectedBusinessId) {
      // Extract the ID if an object was passed
      const businessId = typeof selectedBusinessId === 'object' && selectedBusinessId.id 
        ? selectedBusinessId.id 
        : selectedBusinessId;
        
      if (businessId && typeof businessId === 'string') {
        loadBusinessData(businessId);
      }
    }
  }, [selectedBusinessId]);

  const loadBusinessData = async (businessId) => {
    if (!canViewBusinessData) {
      toast.error('You do not have permission to view business data');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('load_business_data_tosa');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        setLoading(false);
        return;
      }

      // Validate business ID
      if (!businessId || typeof businessId !== 'string') {
        throw new Error('Invalid business ID provided');
      }

      await logSecurityEvent('tosa_business_data_access', {
        action: 'load_business_data',
        business_id: businessId,
        tosa_user_id: auth.authUser?.id
      }, 'high');

      // Load business data - only from businesses table since business_settings doesn't exist
      const { data, error: loadError } = await supabase
        .from('businesses')
        .select('*') // Get all fields from businesses table
        .eq('id', businessId)
        .single();

      if (loadError) {
        await logSecurityEvent('tosa_business_data_load_error', {
          action: 'load_business_data_failed',
          business_id: businessId,
          error_message: loadError.message,
          tosa_user_id: auth.authUser?.id
        }, 'high');
        throw loadError;
      }
      
      // Also try to load related user data for this business
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, full_name, email, employment_status, hire_date, position, department')
        .eq('business_id', businessId)
        .limit(10); // Limit to first 10 users for performance

      if (userError) {
        await logSecurityEvent('tosa_employee_data_load_warning', {
          action: 'load_employees_failed',
          business_id: businessId,
          error_message: userError.message,
          tosa_user_id: auth.authUser?.id
        }, 'medium');
      }

      // Combine the data
      const enrichedData = {
        ...data,
        users: userData || []
      };

      setBusinessData(enrichedData);

      await recordAction('tosa_business_data_loaded', businessId, true);
      await logSecurityEvent('tosa_business_data_loaded', {
        action: 'load_business_data_success',
        business_id: businessId,
        employee_count: userData?.length || 0,
        tosa_user_id: auth.authUser?.id
      }, 'high');

      // Use TOSA auth logging if available
      if (auth.logUserAction) {
        await auth.logUserAction('business_data_loaded', { business_id: businessId });
      }

    } catch (err) {
      await logSecurityEvent('tosa_business_data_load_error', {
        action: 'load_business_data_exception',
        business_id: businessId,
        error_message: err.message,
        tosa_user_id: auth.authUser?.id
      }, 'critical');
      
      setError(err.message);
      toast.error('Failed to load business data');
    } finally {
      setLoading(false);
    }
  };

  const saveBusinessData = async () => {
    if (!businessData) return;

    if (!canEditBusinessData) {
      toast.error('You do not have permission to edit business data');
      return;
    }
    
    setSaving(true);
    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('save_business_data_tosa');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        setSaving(false);
        return;
      }

      // Validate inputs
      const nameValidation = await validateInput(businessData.name, 'text', 'business_name');
      if (!nameValidation.valid) {
        toast.error('Invalid business name');
        setSaving(false);
        return;
      }

      if (businessData.email) {
        const emailValidation = await validateInput(businessData.email, 'email', 'business_email');
        if (!emailValidation.valid) {
          toast.error('Invalid email address');
          setSaving(false);
          return;
        }
      }

      await logSecurityEvent('tosa_business_data_update', {
        action: 'save_business_data',
        business_id: businessData.id,
        changes: ['name', 'email', 'phone', 'is_active', 'subscription_status'],
        tosa_user_id: auth.authUser?.id
      }, 'critical');

      const { error: saveError } = await supabase
        .from('businesses')
        .update({
          name: businessData.name,
          email: businessData.email,
          phone: businessData.phone,
          is_active: businessData.is_active,
          subscription_status: businessData.subscription_status
        })
        .eq('id', businessData.id);

      if (saveError) throw saveError;

      await recordAction('tosa_business_data_saved', businessData.id, true);
      await logSecurityEvent('tosa_business_data_saved', {
        action: 'save_business_data_success',
        business_id: businessData.id,
        tosa_user_id: auth.authUser?.id
      }, 'critical');

      // Use TOSA auth logging if available
      if (auth.logUserAction) {
        await auth.logUserAction('business_data_saved', { 
          business_id: businessData.id,
          changes: ['name', 'email', 'phone', 'is_active', 'subscription_status']
        });
      }

      toast.success('Business data saved successfully!');

    } catch (err) {
      await logSecurityEvent('tosa_business_data_save_error', {
        action: 'save_business_data_failed',
        business_id: businessData.id,
        error_message: err.message,
        tosa_user_id: auth.authUser?.id
      }, 'critical');
      
      setError(err.message);
      toast.error('Error saving business data');
    } finally {
      setSaving(false);
    }
  };

  const handleTabChange = async (tabId) => {
    await logSecurityEvent('tosa_tab_changed', {
      action: 'change_tab',
      business_id: businessData?.id,
      from_tab: activeTab,
      to_tab: tabId,
      tosa_user_id: auth.authUser?.id
    }, 'low');

    setActiveTab(tabId);
  };

  const handleInputChange = async (field, value) => {
    // Validate text inputs
    if (typeof value === 'string' && value.length > 0) {
      const validation = await validateInput(value, 'text', field);
      if (!validation.valid) {
        toast.error(`Invalid input for ${field}`);
        return;
      }
    }

    setBusinessData({...businessData, [field]: value});
  };

  const tabs = [
    { id: 'general', label: 'General Info', icon: <FiEdit />, permission: 'business_management' },
    { id: 'employees', label: 'Employees', icon: <FiUsers />, permission: 'user_management' },
    { id: 'settings', label: 'Settings', icon: <FiSettings />, permission: 'business_management' },
    { id: 'subscription', label: 'Subscription', icon: <FiCreditCard />, permission: 'subscription_management' },
    { id: 'database', label: 'Database', icon: <FiDatabase />, permission: 'business_management' }
  ];

  const styles = {
    container: {
      display: 'flex',
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      fontFamily: TavariStyles.typography.fontFamily
    },
    content: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      marginLeft: '250px' // Account for fixed sidebar width
    },
    main: {
      flex: 1,
      padding: TavariStyles.spacing.xl,
      paddingTop: '120px'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    saveButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      opacity: saving ? 0.6 : 1
    },
    tabContainer: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      boxShadow: TavariStyles.shadows.md,
      overflow: 'hidden'
    },
    tabHeader: {
      display: 'flex',
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    tab: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      padding: TavariStyles.spacing.lg,
      cursor: 'pointer',
      transition: TavariStyles.transitions.normal,
      backgroundColor: TavariStyles.colors.gray50,
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    activeTab: {
      backgroundColor: TavariStyles.colors.white,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`,
      color: TavariStyles.colors.primary
    },
    tabContent: {
      padding: TavariStyles.spacing.xl
    },
    formGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.lg
    },
    label: {
      ...TavariStyles.components.form.label
    },
    input: {
      ...TavariStyles.components.form.input,
      width: '100%'
    },
    textarea: {
      ...TavariStyles.components.form.input,
      width: '100%',
      minHeight: '100px',
      resize: 'vertical'
    },
    select: {
      ...TavariStyles.components.form.select,
      width: '100%'
    },
    employeeList: {
      display: 'grid',
      gap: TavariStyles.spacing.md
    },
    employeeItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md
    },
    databaseStats: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    statCard: {
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      textAlign: 'center'
    },
    statNumber: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    statLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
    },
    loading: {
      ...TavariStyles.components.loading.container
    }
  };

  if (auth.authLoading) {
    return (
      <SecurityWrapper componentName="TOSABusinessEditor" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.loading}>
          <div style={TavariStyles.components.loading.spinner}></div>
          <div>Loading TOSA Business Editor...</div>
          <style>{TavariStyles.keyframes.spin}</style>
        </div>
      </SecurityWrapper>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <SecurityWrapper componentName="TOSABusinessEditor" sensitiveComponent={true} securityLevel="critical">
        <div style={{ padding: '40px', textAlign: 'center', color: TavariStyles.colors.danger }}>
          <h2>Access Denied</h2>
          <p>Tavari employees only.</p>
        </div>
      </SecurityWrapper>
    );
  }

  const renderTabContent = () => {
    if (!businessData) {
      return <div style={{ padding: '40px', textAlign: 'center', color: TavariStyles.colors.gray500 }}>
        Select a business to edit...
      </div>;
    }

    switch (activeTab) {
      case 'general':
        return (
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Business Name</label>
              <input
                style={styles.input}
                type="text"
                value={businessData.name || ''}
                onChange={(e) => handleInputChange('name', e.target.value)}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Email</label>
              <input
                style={styles.input}
                type="email"
                value={businessData.email || ''}
                onChange={(e) => handleInputChange('email', e.target.value)}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Phone</label>
              <input
                style={styles.input}
                type="tel"
                value={businessData.phone || ''}
                onChange={(e) => handleInputChange('phone', e.target.value)}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Status</label>
              <select
                style={styles.select}
                value={businessData.is_active ? 'active' : 'inactive'}
                onChange={(e) => setBusinessData({...businessData, is_active: e.target.value === 'active'})}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        );

      case 'employees':
        if (!canViewEmployeeData) {
          return <div style={{ padding: '40px', textAlign: 'center', color: TavariStyles.colors.danger }}>
            You do not have permission to view employee data
          </div>;
        }

        return (
          <div style={styles.employeeList}>
            <h3>Employees ({businessData.users?.length || 0})</h3>
            {businessData.users && businessData.users.length > 0 ? (
              businessData.users.map((user, index) => (
                <div key={index} style={styles.employeeItem}>
                  <div>
                    <strong>{user.full_name || 'No name'}</strong>
                    <div style={{fontSize: '12px', color: '#666'}}>
                      {user.email} • {user.position || 'No position'} • {user.employment_status || 'Unknown status'}
                    </div>
                    {user.hire_date && (
                      <div style={{fontSize: '12px', color: '#999'}}>
                        Hired: {formatDateShort(user.hire_date, businessTimezone)}
                      </div>
                    )}
                  </div>
                  <button style={styles.saveButton}>View Details</button>
                </div>
              ))
            ) : (
              <div style={{padding: '20px', textAlign: 'center', color: '#666'}}>
                No employees found for this business
              </div>
            )}
          </div>
        );

      case 'settings':
        return (
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Timezone</label>
              <input
                style={styles.input}
                type="text"
                value={businessData.timezone || ''}
                onChange={(e) => handleInputChange('timezone', e.target.value)}
                placeholder="e.g., America/Toronto"
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Operating Hours</label>
              <textarea
                style={styles.textarea}
                value={businessData.operating_hours || ''}
                onChange={(e) => handleInputChange('operating_hours', e.target.value)}
                placeholder="e.g., Mon-Fri: 9AM-5PM"
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Holiday Hours</label>
              <textarea
                style={styles.textarea}
                value={businessData.holiday_hours || ''}
                onChange={(e) => handleInputChange('holiday_hours', e.target.value)}
                placeholder="Special holiday operating hours"
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Tax Number</label>
              <input
                style={styles.input}
                type="text"
                value={businessData.tax_number || ''}
                onChange={(e) => handleInputChange('tax_number', e.target.value)}
                placeholder="Business tax identification number"
              />
            </div>
          </div>
        );

      case 'subscription':
        if (!canEditSubscription) {
          return <div style={{ padding: '40px', textAlign: 'center', color: TavariStyles.colors.danger }}>
            You do not have permission to manage subscriptions
          </div>;
        }

        return (
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Business Status</label>
              <select
                style={styles.select}
                value={businessData.business_state || 'active'}
                onChange={(e) => setBusinessData({...businessData, business_state: e.target.value})}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Created Date</label>
              <input
                style={styles.input}
                type="text"
                value={businessData.created_at ? formatDateShort(businessData.created_at, businessTimezone) : 'Unknown'}
                disabled
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Created By</label>
              <input
                style={styles.input}
                type="text"
                value={businessData.created_by || 'Unknown'}
                disabled
              />
            </div>
          </div>
        );

      case 'database':
        return (
          <div style={styles.databaseStats}>
            <div style={styles.statCard}>
              <div style={styles.statNumber}>{businessData.users?.length || 0}</div>
              <div style={styles.statLabel}>Users</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statNumber}>{businessData.created_at ? '1' : '0'}</div>
              <div style={styles.statLabel}>Business Record</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statNumber}>
                {businessData.created_at ? 
                  Math.floor((new Date() - new Date(businessData.created_at)) / (1000 * 60 * 60 * 24)) : 0
                }
              </div>
              <div style={styles.statLabel}>Days Active</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statNumber}>Available</div>
              <div style={styles.statLabel}>Status</div>
            </div>
          </div>
        );

      default:
        return <div>Tab content not implemented</div>;
    }
  };

  return (
    <SecurityWrapper componentName="TOSABusinessEditor" sensitiveComponent={true} securityLevel="critical">
      <div style={styles.container}>
        <TOSASidebarNav />
        
        <div style={styles.content}>
          <TOSAHeaderBar />
          
          <main style={styles.main}>
            <div style={styles.header}>
              <div>
                <h1 style={styles.title}>Business Editor</h1>
                <TOSABusinessSelector onBusinessSelect={(business) => {
                  // Extract the ID from the business object
                  const businessId = business ? business.id : null;
                  setSelectedBusinessId(businessId);
                }} />
              </div>
              
              {businessData && canEditBusinessData && (
                <button
                  style={styles.saveButton}
                  onClick={saveBusinessData}
                  disabled={saving}
                >
                  <FiSave />
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              )}
            </div>

            {error && (
              <div style={{
                padding: TavariStyles.spacing.md,
                backgroundColor: TavariStyles.colors.errorBg,
                color: TavariStyles.colors.errorText,
                borderRadius: TavariStyles.borderRadius.md,
                marginBottom: TavariStyles.spacing.lg
              }}>
                {error}
              </div>
            )}

            {loading ? (
              <div style={styles.loading}>
                <div style={TavariStyles.components.loading.spinner}></div>
                <div>Loading business data...</div>
                <style>{TavariStyles.keyframes.spin}</style>
              </div>
            ) : (
              <div style={styles.tabContainer}>
                <div style={styles.tabHeader}>
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      style={{
                        ...styles.tab,
                        ...(activeTab === tab.id ? styles.activeTab : {})
                      }}
                      onClick={() => handleTabChange(tab.id)}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </div>
                
                <div style={styles.tabContent}>
                  {renderTabContent()}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </SecurityWrapper>
  );
};

export default TOSABusinessEditor;