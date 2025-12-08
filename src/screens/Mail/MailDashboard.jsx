// screens/Mail/MailDashboard.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import { 
  FiMail, FiUsers, FiSend, FiSettings, FiBarChart2, FiFileText, 
  FiShield, FiDollarSign, FiActivity, FiAlertTriangle, FiPause, FiAlertCircle 
} from 'react-icons/fi';

// Permission System Imports
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import toast from 'react-hot-toast';

const MailDashboard = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  
  // Security context for dashboard
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'MailDashboard',
    sensitiveComponent: false,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  // Authentication using standardized hook
  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData,
    authLoading,
    authError,
    isManager,
    isOwner
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin', 'staff'], // Allow all roles to view dashboard
    requireBusiness: true,
    componentName: 'MailDashboard'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();
  
  // Email sending pause state
  const [emailSendingPaused, setEmailSendingPaused] = useState(() => {
    const stored = localStorage.getItem('EMAIL_SENDING_PAUSED');
    return stored ? JSON.parse(stored) : true; // Default to paused for safety
  });

  const [stats, setStats] = useState({
    totalContacts: 0,
    subscribedContacts: 0,
    totalCampaigns: 0,
    emailsSentThisMonth: 0,
    currentMonthCost: 0.00,
    activeSubscription: null
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const businessId = selectedBusinessId || business?.id;

  // Permission checks
  const canViewDashboard = hasAnyPermission([
    'mail.contacts.view',
    'mail.campaigns.view'
  ]) || hasElevatedPrivileges();
  
  const canViewContacts = hasPermission('mail.contacts.view') || hasElevatedPrivileges();
  const canCreateCampaigns = hasPermission('mail.campaigns.create') || hasElevatedPrivileges();
  const canViewCampaigns = hasPermission('mail.campaigns.view') || hasElevatedPrivileges();
  const canImportContacts = hasPermission('mail.contacts.import') || hasElevatedPrivileges();

  // Check basic dashboard access
  useEffect(() => {
    if (!permissionsLoading && !authLoading && !canViewDashboard) {
      toast.error('You do not have permission to access the mail dashboard');
      navigate('/dashboard');
    }
  }, [permissionsLoading, authLoading, canViewDashboard]);

  // Load dashboard statistics
  useEffect(() => {
    if (businessId && !authLoading && !permissionsLoading && canViewDashboard) {
      loadDashboardStats();
    }
  }, [businessId, authLoading, permissionsLoading, canViewDashboard]);

  // Listen for localStorage changes to update pause state
  useEffect(() => {
    const handleStorageChange = () => {
      const stored = localStorage.getItem('EMAIL_SENDING_PAUSED');
      setEmailSendingPaused(stored ? JSON.parse(stored) : true);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('emailPauseStateChanged', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('emailPauseStateChanged', handleStorageChange);
    };
  }, []);

  const loadDashboardStats = async () => {
    if (!businessId || !canViewDashboard) return;

    // Rate limiting
    if (!checkRateLimit('load_dashboard_stats', 10, 60000)) {
      toast.error('Too many requests. Please wait a moment.');
      return;
    }
    
    try {
      setLoading(true);
      setError(null);

      await logSecurityEvent('mail_dashboard_access', {
        action: 'load_dashboard_statistics',
        business_id: businessId,
        user_id: authUser?.id
      }, 'low');

      // Load contact stats (only if has permission)
      let totalContacts = 0;
      let subscribedContacts = 0;
      
      if (canViewContacts) {
        const { count: totalCount, error: totalError } = await supabase
          .from('mail_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId);

        if (totalError) throw totalError;

        const { count: subscribedCount, error: subscribedError } = await supabase
          .from('mail_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('subscribed', true);

        if (subscribedError) throw subscribedError;
        
        totalContacts = totalCount || 0;
        subscribedContacts = subscribedCount || 0;
      }

      // Load campaign stats (only if has permission)
      let totalCampaigns = 0;
      let emailsSentThisMonth = 0;
      
      if (canViewCampaigns) {
        const { data: campaigns, error: campaignsError } = await supabase
          .from('mail_campaigns')
          .select('id, status, emails_sent, created_at')
          .eq('business_id', businessId);

        if (campaignsError) throw campaignsError;

        totalCampaigns = campaigns?.length || 0;
        
        // Calculate emails sent this month
        const currentDate = new Date();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        
        const thisMonth = campaigns?.filter(c => {
          const campaignDate = new Date(c.created_at);
          return campaignDate >= startOfMonth;
        });
        emailsSentThisMonth = thisMonth?.reduce((sum, c) => sum + (c.emails_sent || 0), 0) || 0;
      }

      // Load billing info for current month (visible to all)
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      
      const { data: billing, error: billingError } = await supabase
        .from('mail_billing')
        .select('*')
        .eq('business_id', businessId)
        .gte('billing_period_start', startOfMonth.toISOString().split('T')[0])
        .order('created_at', { ascending: false })
        .limit(1);

      if (billingError && billingError.code !== 'PGRST116') {
        console.warn('Billing table may not exist yet:', billingError);
      }

      // Calculate current month cost
      const currentBilling = billing?.[0];
      const currentMonthCost = currentBilling?.total_amount || 0;

      setStats({
        totalContacts,
        subscribedContacts,
        totalCampaigns,
        emailsSentThisMonth,
        currentMonthCost,
        activeSubscription: currentBilling
      });

      await recordAction('dashboard_stats_loaded', true, businessId);
    } catch (error) {
      console.error('Error loading dashboard stats:', error);
      setError('Failed to load dashboard statistics');
      await recordAction('dashboard_stats_loaded', false, businessId);
    } finally {
      setLoading(false);
    }
  };

  const navigateTo = (path) => {
    // Log navigation
    logSecurityEvent('mail_dashboard_navigation', {
      action: 'navigate',
      target_path: path,
      business_id: businessId,
      user_id: authUser?.id
    }, 'low');

    // Block navigation to email-sending screens when paused
    if (emailSendingPaused && (path.includes('/builder') || path.includes('/campaigns'))) {
      toast.warning('Email sending is currently PAUSED. Go to Mail Settings to enable sending before creating or managing campaigns.');
      return;
    }

    // Check permissions before navigation
    if (path.includes('/builder') && !canCreateCampaigns) {
      toast.error('You do not have permission to create campaigns');
      return;
    }

    if (path.includes('/campaigns') && !canViewCampaigns) {
      toast.error('You do not have permission to view campaigns');
      return;
    }

    if (path.includes('/contacts') && !canViewContacts) {
      toast.error('You do not have permission to view contacts');
      return;
    }

    navigate(path);
  };

  if (authLoading || permissionsLoading || loading) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <div style={styles.loading}>
            <FiActivity style={styles.loadingIcon} />
            <div>Loading dashboard...</div>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (authError) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <div style={styles.error}>
            <FiAlertCircle style={styles.errorIcon} />
            <h2>Authentication Error</h2>
            <p>{authError}</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (error) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <div style={styles.error}>
            <FiAlertTriangle style={styles.errorIcon} />
            <h2>Dashboard Error</h2>
            <p>{error}</p>
            <button 
              style={styles.retryButton} 
              onClick={loadDashboardStats}
            >
              Try Again
            </button>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper>
      <SecurityWrapper>
        <div style={styles.container}>
          {/* Pause Banner - Only show when paused */}
          {emailSendingPaused && (
            <div style={styles.pauseBanner}>
              <div style={styles.pauseBannerContent}>
                <FiPause style={styles.pauseIcon} />
                <div style={styles.pauseText}>
                  <strong>EMAIL SENDING PAUSED</strong>
                  <span>All campaigns and email sends are currently blocked. Go to Mail Settings to enable sending.</span>
                </div>
                <button 
                  style={styles.settingsButton}
                  onClick={() => navigate('/dashboard/mail/settings')}
                >
                  <FiSettings style={styles.buttonIcon} />
                  Mail Settings
                </button>
              </div>
            </div>
          )}

          {/* Permission Warning */}
          {!canCreateCampaigns && !canViewCampaigns && canViewContacts && (
            <div style={styles.permissionWarning}>
              <FiAlertCircle style={styles.warningIcon} />
              <div>
                <strong>Limited Access:</strong> You have contacts-only access. 
                Contact your administrator to request campaign permissions.
              </div>
            </div>
          )}

          {/* Header */}
          <div style={styles.header}>
            <h1 style={styles.title}>Tavari Mail Dashboard</h1>
            <p style={styles.subtitle}>Pay-per-email marketing with unlimited contacts</p>
          </div>

          {/* Stats Cards */}
          <div style={styles.statsGrid}>
            <PermissionGate 
              permission="mail.contacts.view"
              fallback={
                <div style={styles.statCardDisabled}>
                  <div style={styles.statIcon}><FiUsers /></div>
                  <div style={styles.statContent}>
                    <div style={styles.statNumber}>--</div>
                    <div style={styles.statLabel}>Total Contacts</div>
                    <div style={styles.statSubtext}>No permission</div>
                  </div>
                </div>
              }
            >
              <div style={styles.statCard}>
                <div style={styles.statIcon}><FiUsers /></div>
                <div style={styles.statContent}>
                  <div style={styles.statNumber}>{stats.totalContacts.toLocaleString()}</div>
                  <div style={styles.statLabel}>Total Contacts</div>
                  <div style={styles.statSubtext}>
                    {stats.subscribedContacts.toLocaleString()} subscribed
                  </div>
                </div>
              </div>
            </PermissionGate>
            
            <PermissionGate 
              permission="mail.campaigns.view"
              fallback={
                <div style={styles.statCardDisabled}>
                  <div style={styles.statIcon}><FiMail /></div>
                  <div style={styles.statContent}>
                    <div style={styles.statNumber}>--</div>
                    <div style={styles.statLabel}>Total Campaigns</div>
                    <div style={styles.statSubtext}>No permission</div>
                  </div>
                </div>
              }
            >
              <div style={styles.statCard}>
                <div style={styles.statIcon}><FiMail /></div>
                <div style={styles.statContent}>
                  <div style={styles.statNumber}>{stats.totalCampaigns}</div>
                  <div style={styles.statLabel}>Total Campaigns</div>
                  <div style={styles.statSubtext}>All time</div>
                </div>
              </div>
            </PermissionGate>
            
            <PermissionGate 
              permission="mail.campaigns.view"
              fallback={
                <div style={styles.statCardDisabled}>
                  <div style={styles.statIcon}><FiSend /></div>
                  <div style={styles.statContent}>
                    <div style={styles.statNumber}>--</div>
                    <div style={styles.statLabel}>Emails This Month</div>
                    <div style={styles.statSubtext}>No permission</div>
                  </div>
                </div>
              }
            >
              <div style={styles.statCard}>
                <div style={styles.statIcon}><FiSend /></div>
                <div style={styles.statContent}>
                  <div style={styles.statNumber}>{stats.emailsSentThisMonth.toLocaleString()}</div>
                  <div style={styles.statLabel}>Emails This Month</div>
                  <div style={styles.statSubtext}>Current billing period</div>
                </div>
              </div>
            </PermissionGate>
            
            <div style={styles.statCard}>
              <div style={styles.statIcon}><FiDollarSign /></div>
              <div style={styles.statContent}>
                <div style={styles.statNumber}>${stats.currentMonthCost.toFixed(2)}</div>
                <div style={styles.statLabel}>This Month's Cost</div>
                <div style={styles.statSubtext}>Including overages</div>
              </div>
            </div>
          </div>

          {/* Quick Actions - 3x Grid Layout per Tavari Standards */}
          <div style={styles.quickActionsHeader}>
            <h2 style={styles.sectionTitle}>Quick Actions</h2>
          </div>
          
          <div style={styles.buttonGrid}>
            <PermissionGate 
              permission="mail.campaigns.create"
              fallback={
                <button 
                  style={styles.disabledButton}
                  disabled
                  title="You don't have permission to create campaigns"
                >
                  <FiMail style={{...styles.buttonIcon, color: '#ccc'}} />
                  <span style={{...styles.buttonText, color: '#ccc'}}>Create Campaign</span>
                  <span style={styles.disabledText}>No Permission</span>
                </button>
              }
            >
              <button 
                style={{
                  ...styles.gridButton,
                  ...(emailSendingPaused ? styles.disabledButton : {})
                }}
                onClick={() => navigateTo('/dashboard/mail/builder')}
                disabled={emailSendingPaused}
              >
                <FiMail style={{
                  ...styles.buttonIcon,
                  color: emailSendingPaused ? '#ccc' : 'teal'
                }} />
                <span style={{
                  ...styles.buttonText,
                  color: emailSendingPaused ? '#ccc' : '#333'
                }}>Create Campaign</span>
                {emailSendingPaused && <span style={styles.disabledText}>Paused</span>}
              </button>
            </PermissionGate>
            
            <PermissionGate 
              permission="mail.contacts.view"
              fallback={
                <button 
                  style={styles.disabledButton}
                  disabled
                  title="You don't have permission to view contacts"
                >
                  <FiUsers style={{...styles.buttonIcon, color: '#ccc'}} />
                  <span style={{...styles.buttonText, color: '#ccc'}}>Manage Contacts</span>
                  <span style={styles.disabledText}>No Permission</span>
                </button>
              }
            >
              <button 
                style={styles.gridButton}
                onClick={() => navigateTo('/dashboard/mail/contacts')}
              >
                <FiUsers style={styles.buttonIcon} />
                <span style={styles.buttonText}>Manage Contacts</span>
              </button>
            </PermissionGate>
            
            <PermissionGate 
              permission="mail.campaigns.view"
              fallback={
                <button 
                  style={styles.disabledButton}
                  disabled
                  title="You don't have permission to view campaigns"
                >
                  <FiFileText style={{...styles.buttonIcon, color: '#ccc'}} />
                  <span style={{...styles.buttonText, color: '#ccc'}}>View Campaigns</span>
                  <span style={styles.disabledText}>No Permission</span>
                </button>
              }
            >
              <button 
                style={{
                  ...styles.gridButton,
                  ...(emailSendingPaused ? styles.disabledButton : {})
                }}
                onClick={() => navigateTo('/dashboard/mail/campaigns')}
                disabled={emailSendingPaused}
              >
                <FiFileText style={{
                  ...styles.buttonIcon,
                  color: emailSendingPaused ? '#ccc' : 'teal'
                }} />
                <span style={{
                  ...styles.buttonText,
                  color: emailSendingPaused ? '#ccc' : '#333'
                }}>View Campaigns</span>
                {emailSendingPaused && <span style={styles.disabledText}>Paused</span>}
              </button>
            </PermissionGate>
            
            <PermissionGate 
              permission="mail.contacts.import"
              fallback={
                <button 
                  style={styles.disabledButton}
                  disabled
                  title="You don't have permission to import contacts"
                >
                  <FiUsers style={{...styles.buttonIcon, color: '#ccc'}} />
                  <span style={{...styles.buttonText, color: '#ccc'}}>Import Contacts</span>
                  <span style={styles.disabledText}>No Permission</span>
                </button>
              }
            >
              <button 
                style={styles.gridButton}
                onClick={() => navigateTo('/dashboard/mail/contacts')}
              >
                <FiUsers style={styles.buttonIcon} />
                <span style={styles.buttonText}>Import Contacts</span>
              </button>
            </PermissionGate>
            
            <button 
              style={styles.gridButton}
              onClick={() => navigateTo('/dashboard/mail/performance')}
            >
              <FiActivity style={styles.buttonIcon} />
              <span style={styles.buttonText}>Performance Monitor</span>
            </button>
            
            <button 
              style={styles.gridButton}
              onClick={() => navigateTo('/dashboard/mail/settings')}
            >
              <FiSettings style={styles.buttonIcon} />
              <span style={styles.buttonText}>Mail Settings</span>
            </button>
            
            <button 
              style={styles.gridButton}
              onClick={() => navigateTo('/dashboard/mail/templates')}
            >
              <FiFileText style={styles.buttonIcon} />
              <span style={styles.buttonText}>Email Templates</span>
            </button>
            
            <button 
              style={styles.gridButton}
              onClick={() => navigateTo('/dashboard/mail/billing')}
            >
              <FiBarChart2 style={styles.buttonIcon} />
              <span style={styles.buttonText}>Usage & Billing</span>
            </button>
            
            <button 
              style={styles.gridButton}
              onClick={() => navigateTo('/dashboard/mail/compliance')}
            >
              <FiShield style={styles.buttonIcon} />
              <span style={styles.buttonText}>Compliance Center</span>
            </button>
          </div>

          {/* Current Status */}
          {stats.activeSubscription && (
            <div style={styles.statusSection}>
              <h2 style={styles.sectionTitle}>Current Usage</h2>
              <div style={styles.statusCard}>
                <div style={styles.statusItem}>
                  <span style={styles.statusLabel}>Included Emails:</span>
                  <span style={styles.statusValue}>
                    {stats.activeSubscription.included_emails?.toLocaleString() || '5,000'}
                  </span>
                </div>
                <div style={styles.statusItem}>
                  <span style={styles.statusLabel}>Emails Used:</span>
                  <span style={styles.statusValue}>
                    {stats.activeSubscription.emails_used?.toLocaleString() || '0'}
                  </span>
                </div>
                <div style={styles.statusItem}>
                  <span style={styles.statusLabel}>Remaining:</span>
                  <span style={styles.statusValue}>
                    {((stats.activeSubscription.included_emails || 5000) - (stats.activeSubscription.emails_used || 0)).toLocaleString()}
                  </span>
                </div>
                {stats.activeSubscription.overage_emails > 0 && (
                  <div style={styles.statusItem}>
                    <span style={styles.statusLabel}>Overage Emails:</span>
                    <span style={{...styles.statusValue, color: '#ff9800'}}>
                      {stats.activeSubscription.overage_emails.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Module Visibility for Upselling */}
          <div style={styles.modulesSection}>
            <h3 style={styles.sectionTitle}>Other Tavari Modules</h3>
            <div style={styles.moduleButtons}>
              <button 
                style={styles.moduleButton}
                onClick={() => navigateTo('/dashboard/pos/register')}
              >
                Tavari POS
              </button>
              <button 
                style={styles.moduleButton}
                onClick={() => navigateTo('/dashboard/music/dashboard')}
              >
                Tavari Music
              </button>
            </div>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    padding: '40px',
    maxWidth: '1200px',
    margin: '0 auto',
    backgroundColor: '#f8f8f8',
    minHeight: '100vh',
  },
  permissionWarning: {
    backgroundColor: '#fff3cd',
    border: '2px solid #f39c12',
    borderRadius: '8px',
    padding: '15px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    color: '#856404',
  },
  warningIcon: {
    fontSize: '24px',
    flexShrink: 0,
  },
  pauseBanner: {
    backgroundColor: '#f44336',
    color: 'white',
    padding: '0',
    marginBottom: '30px',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(244, 67, 54, 0.3)',
  },
  pauseBannerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    padding: '20px 25px',
    flexWrap: 'wrap',
  },
  pauseIcon: {
    fontSize: '24px',
    color: 'white',
  },
  pauseText: {
    flex: 1,
    minWidth: '200px',
  },
  settingsButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    color: 'white',
    border: '2px solid rgba(255,255,255,0.3)',
    borderRadius: '6px',
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px',
    color: '#666',
  },
  loadingIcon: {
    fontSize: '48px',
    marginBottom: '20px',
    color: 'teal',
    animation: 'spin 1s linear infinite',
  },
  error: {
    textAlign: 'center',
    padding: '60px 20px',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
  },
  errorIcon: {
    fontSize: '48px',
    color: '#f44336',
    marginBottom: '20px',
  },
  retryButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '20px',
  },
  header: {
    textAlign: 'center',
    marginBottom: '30px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    margin: 0,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '40px',
  },
  statCard: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #ddd',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  statCardDisabled: {
    backgroundColor: '#f5f5f5',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #ddd',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    opacity: 0.6,
  },
  statIcon: {
    fontSize: '24px',
    color: 'teal',
    width: '40px',
    textAlign: 'center',
  },
  statContent: {
    flex: 1,
  },
  statNumber: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
  },
  statLabel: {
    fontSize: '14px',
    color: '#666',
    marginTop: '4px',
  },
  statSubtext: {
    fontSize: '12px',
    color: '#999',
    marginTop: '2px',
  },
  quickActionsHeader: {
    marginBottom: '20px',
  },
  sectionTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '10px',
  },
  buttonGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '20px',
    marginBottom: '40px',
  },
  gridButton: {
    backgroundColor: 'white',
    border: '2px solid teal',
    borderRadius: '8px',
    padding: '30px 20px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    transition: 'all 0.2s ease',
    minHeight: '120px',
    position: 'relative',
  },
  disabledButton: {
    backgroundColor: '#f5f5f5',
    borderColor: '#ddd',
    cursor: 'not-allowed',
    opacity: 0.7,
  },
  buttonIcon: {
    fontSize: '32px',
    color: 'teal',
  },
  buttonText: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
  },
  disabledText: {
    position: 'absolute',
    bottom: '8px',
    fontSize: '12px',
    color: '#999',
    fontStyle: 'italic',
  },
  statusSection: {
    marginBottom: '40px',
  },
  statusCard: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #ddd',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
  },
  statusItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statusLabel: {
    fontSize: '14px',
    color: '#666',
    fontWeight: 'bold',
  },
  statusValue: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
  },
  modulesSection: {
    marginTop: '40px',
    textAlign: 'center',
  },
  moduleButtons: {
    display: 'flex',
    gap: '20px',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  moduleButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  // Mobile responsiveness
  '@media (max-width: 768px)': {
    buttonGrid: {
      gridTemplateColumns: '1fr',
    },
    statsGrid: {
      gridTemplateColumns: '1fr',
    },
    pauseBannerContent: {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: '15px',
    },
    settingsButton: {
      justifyContent: 'center',
    },
  },
};

// Add CSS animation for spinning icons
if (!document.querySelector('#mail-dashboard-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'mail-dashboard-styles';
  styleSheet.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleSheet);
}

export default MailDashboard;