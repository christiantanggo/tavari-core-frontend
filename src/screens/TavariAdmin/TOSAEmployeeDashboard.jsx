// screens/TavariAdmin/TOSAEmployeeDashboard.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiUsers, FiShield, FiHeadphones, FiTrendingUp, FiSettings, FiAlertTriangle, FiPackage } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import { useTOSATavariAuth } from '../../hooks/useTOSATavariAuth';
import { usePermissions } from '../../hooks/usePermissions';

// Foundation Components
import { TavariStyles } from '../../utils/TavariStyles';
import TOSAHeaderBar from '../../components/TavariAdminComp/TOSAHeaderBar';
import TOSASidebarNav from '../../components/TavariAdminComp/TOSASidebarNav';

const TOSAEmployeeDashboard = () => {
  const navigate = useNavigate();

  // Security context for sensitive TOSA dashboard operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'TOSAEmployeeDashboard',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  // TOSA Authentication
  const auth = useTOSATavariAuth({
    requiredPermissions: ['dashboard_access'],
    componentName: 'TOSAEmployeeDashboard'
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
  const canViewDashboard = auth.hasPermission?.('dashboard_access') || false;
  const canViewBusinessData = auth.hasPermission?.('business_management') || false;
  const canViewSecurityData = auth.hasPermission?.('security_monitoring') || false;
  const canViewSupportData = auth.hasPermission?.('customer_support') || false;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dashboardData, setDashboardData] = useState({
    totalBusinesses: 0,
    totalUsers: 0,
    activeUsers: 0,
    recentSignups: 0,
    securityAlerts: 0,
    supportTickets: 0,
    systemHealth: 'good',
    recentActivity: []
  });

  // TOSA is now open - no auth check needed
  // Removed authentication requirement

  // Log initial access
  useEffect(() => {
    if (auth.isAuthenticated && auth.authUser && canViewDashboard) {
      logInitialAccess();
    }
  }, [auth.isAuthenticated, auth.authUser, canViewDashboard]);

  const logInitialAccess = async () => {
    try {
      await logSecurityEvent('tosa_dashboard_accessed', {
        action: 'tosa_dashboard_loaded',
        tosa_user_id: auth.authUser?.id,
        tosa_user_email: auth.authUser?.email,
        timestamp: new Date().toISOString()
      }, 'high');

      await recordAction('tosa_dashboard_accessed', 'tosa_main_dashboard', true);

      // Use TOSA auth logging if available
      if (auth.logUserAction) {
        await auth.logUserAction('dashboard_viewed', { 
          screen: 'employee_dashboard',
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      // Silent fail on logging - don't block user experience
    }
  };

  useEffect(() => {
    if (auth.isAuthenticated && canViewDashboard) {
      loadDashboardData();
    }
  }, [auth.isAuthenticated, canViewDashboard]);

  const loadDashboardData = async () => {
    if (!canViewDashboard) {
      toast.error('You do not have permission to view the dashboard');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('load_tosa_dashboard');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        setLoading(false);
        return;
      }

      await logSecurityEvent('tosa_dashboard_data_access', {
        action: 'load_dashboard_data',
        tosa_user_id: auth.authUser?.id
      }, 'high');

      // Load total businesses
      const { data: businesses, error: bizError } = await supabase
        .from('businesses')
        .select('id, created_at, name')
        .order('created_at', { ascending: false });

      if (bizError) {
        await logSecurityEvent('tosa_businesses_load_error', {
          action: 'load_businesses_failed',
          error_message: bizError.message,
          tosa_user_id: auth.authUser?.id
        }, 'medium');
      }

      // Load total users (platform users)
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, created_at, last_sign_in_at')
        .not('id', 'is', null);

      if (usersError) {
        await logSecurityEvent('tosa_users_load_error', {
          action: 'load_users_failed',
          error_message: usersError.message,
          tosa_user_id: auth.authUser?.id
        }, 'medium');
      }

      // Calculate recent activity (last 24 hours)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const activeUsers = users?.filter(user => 
        user.last_sign_in_at && new Date(user.last_sign_in_at) > yesterday
      ).length || 0;

      // Calculate recent signups (last 7 days)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const recentBusinessSignups = businesses?.filter(b => {
        const createdDate = new Date(b.created_at);
        return createdDate > weekAgo;
      }).length || 0;

      // Load security alerts (last 7 days) - only if user has permission
      let securityAlertsCount = 0;
      if (canViewSecurityData) {
        const { data: securityAlerts, error: alertsError } = await supabase
          .from('security_audit_logs')
          .select('id')
          .gte('created_at', weekAgo.toISOString())
          .in('severity', ['high', 'critical']);

        if (alertsError) {
          await logSecurityEvent('tosa_security_alerts_load_error', {
            action: 'load_security_alerts_failed',
            error_message: alertsError.message,
            tosa_user_id: auth.authUser?.id
          }, 'medium');
        } else {
          securityAlertsCount = securityAlerts?.length || 0;
        }
      }

      // Load support tickets count from security_audit_logs (support-related events)
      let supportTicketsCount = 0;
      if (canViewSupportData) {
        const { data: supportEvents, error: supportError } = await supabase
          .from('security_audit_logs')
          .select('id')
          .gte('created_at', weekAgo.toISOString())
          .or('event_type.ilike.%support%,event_type.ilike.%ticket%,event_type.ilike.%help%');

        if (!supportError) {
          supportTicketsCount = supportEvents?.length || 0;
        }
      }

      const dashboardStats = {
        totalBusinesses: businesses?.length || 0,
        totalUsers: users?.length || 0,
        activeUsers: activeUsers,
        recentSignups: recentBusinessSignups,
        securityAlerts: securityAlertsCount,
        supportTickets: supportTicketsCount,
        systemHealth: 'good',
        recentActivity: [
          { 
            type: 'business_signup', 
            message: `${recentBusinessSignups} new businesses registered this week`, 
            time: 'This week' 
          },
          { 
            type: 'user_activity', 
            message: `${activeUsers} users active in last 24 hours`, 
            time: 'Last 24 hours' 
          },
          { 
            type: 'security_alert', 
            message: `${securityAlertsCount} security events detected`, 
            time: 'Last 7 days' 
          }
        ]
      };

      setDashboardData(dashboardStats);

      await recordAction('tosa_dashboard_loaded', 'tosa_main_dashboard', true);
      await logSecurityEvent('tosa_dashboard_loaded', {
        action: 'load_dashboard_success',
        businesses_count: businesses?.length || 0,
        users_count: users?.length || 0,
        security_alerts_count: securityAlertsCount,
        tosa_user_id: auth.authUser?.id
      }, 'high');

    } catch (error) {
      await logSecurityEvent('tosa_dashboard_load_error', {
        action: 'load_dashboard_failed',
        error_message: error.message,
        tosa_user_id: auth.authUser?.id
      }, 'critical');

      setError('Failed to load dashboard data');
      setDashboardData({
        totalBusinesses: 0,
        totalUsers: 0,
        activeUsers: 0,
        recentSignups: 0,
        securityAlerts: 0,
        supportTickets: 0,
        systemHealth: 'error',
        recentActivity: [
          { type: 'error', message: 'Error loading dashboard data', time: 'Now' }
        ]
      });
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickActionClick = async (action) => {
    await logSecurityEvent('tosa_quick_action_clicked', {
      action: 'quick_action_clicked',
      action_title: action.title,
      target_route: action.route,
      tosa_user_id: auth.authUser?.id
    }, 'low');

    await recordAction('tosa_quick_action_clicked', action.route, true);

    action.onClick();
  };

  const quickActions = [
    {
      title: 'Business Management',
      description: 'View and edit business accounts',
      icon: <FiUsers />,
      color: TavariStyles.colors.primary,
      route: '/tosa/business-editor',
      onClick: () => navigate('/tosa/business-editor'),
      permission: 'business_management'
    },
    {
      title: 'Security Monitoring',
      description: 'Monitor security events and threats',
      icon: <FiShield />,
      color: TavariStyles.colors.danger,
      route: '/tosa/security-monitoring',
      onClick: () => navigate('/tosa/security-monitoring'),
      permission: 'security_monitoring'
    },
    {
      title: 'Customer Support',
      description: 'Manage support tickets and issues',
      icon: <FiHeadphones />,
      color: TavariStyles.colors.success,
      route: '/tosa/customer-support',
      onClick: () => navigate('/tosa/customer-support'),
      permission: 'customer_support'
    },
    {
      title: 'System Health',
      description: 'Monitor platform performance',
      icon: <FiTrendingUp />,
      color: TavariStyles.colors.info,
      route: '/tosa/system-health',
      onClick: () => navigate('/tosa/system-health'),
      permission: 'system_monitoring'
    },
    {
      title: 'Module Management',
      description: 'Manage modules, tiers, and subscriptions',
      icon: <FiPackage />,
      color: TavariStyles.colors.warning,
      route: '/tosa/module-management',
      onClick: () => navigate('/tosa/module-management'),
      permission: 'module_management'
    }
  ];

  // Filter actions based on permissions
  const availableActions = quickActions.filter(action => 
    !action.permission || auth.hasPermission?.(action.permission)
  );

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
      marginLeft: '250px'
    },
    main: {
      flex: 1,
      padding: TavariStyles.spacing['3xl'],
      paddingTop: '120px'
    },
    header: {
      marginBottom: TavariStyles.spacing['3xl']
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['4xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing['3xl']
    },
    statCard: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    statNumber: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    statLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    },
    quickActionsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing['3xl']
    },
    actionCard: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      cursor: 'pointer',
      transition: TavariStyles.transitions.normal
    },
    actionIcon: {
      fontSize: '32px',
      marginBottom: TavariStyles.spacing.md
    },
    actionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    actionDescription: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    activityCard: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    activityTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.lg
    },
    activityItem: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius.md,
      marginBottom: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.gray50
    },
    activityIcon: {
      fontSize: '16px',
      color: TavariStyles.colors.gray500,
      marginTop: '2px'
    },
    activityMessage: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      flex: 1
    },
    activityTime: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500
    },
    loading: {
      ...TavariStyles.components.loading.container
    },
    error: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.errorText,
      borderRadius: TavariStyles.borderRadius.md,
      marginBottom: TavariStyles.spacing.lg
    },
    accessDenied: {
      padding: '40px',
      textAlign: 'center',
      color: TavariStyles.colors.danger
    }
  };

  if (auth.authLoading) {
    return (
      <SecurityWrapper componentName="TOSAEmployeeDashboard" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.container}>
          <TOSASidebarNav />
          
          <div style={styles.content}>
            <TOSAHeaderBar />
            
            <main style={styles.main}>
              <div style={styles.loading}>
                <div style={TavariStyles.components.loading.spinner}></div>
                <h2>Loading TOSA Dashboard...</h2>
                <p style={{ color: TavariStyles.colors.gray600 }}>
                  Fetching business data and system metrics...
                </p>
                <style>{TavariStyles.keyframes.spin}</style>
              </div>
            </main>
          </div>
        </div>
      </SecurityWrapper>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <SecurityWrapper componentName="TOSAEmployeeDashboard" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.accessDenied}>
          <h2>Access Denied</h2>
          <p>Tavari employees only.</p>
        </div>
      </SecurityWrapper>
    );
  }

  if (!canViewDashboard) {
    return (
      <SecurityWrapper componentName="TOSAEmployeeDashboard" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.container}>
          <TOSASidebarNav />
          <div style={styles.content}>
            <TOSAHeaderBar />
            <main style={styles.main}>
              <div style={styles.accessDenied}>
                <h2>Access Denied</h2>
                <p>You do not have permission to view the TOSA dashboard.</p>
              </div>
            </main>
          </div>
        </div>
      </SecurityWrapper>
    );
  }

  if (loading) {
    return (
      <SecurityWrapper componentName="TOSAEmployeeDashboard" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.container}>
          <TOSASidebarNav />
          
          <div style={styles.content}>
            <TOSAHeaderBar />
            
            <main style={styles.main}>
              <div style={styles.loading}>
                <div style={TavariStyles.components.loading.spinner}></div>
                <h2>Loading Dashboard Data...</h2>
                <p style={{ color: TavariStyles.colors.gray600 }}>
                  Fetching business data and system metrics...
                </p>
                <style>{TavariStyles.keyframes.spin}</style>
              </div>
            </main>
          </div>
        </div>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper componentName="TOSAEmployeeDashboard" sensitiveComponent={true} securityLevel="critical">
      <div style={styles.container}>
        <TOSASidebarNav />
        
        <div style={styles.content}>
          <TOSAHeaderBar />
          
          <main style={styles.main}>
            {/* Header */}
            <div style={styles.header}>
              <h1 style={styles.title}>Tavari OS Admin Dashboard</h1>
              <p style={styles.subtitle}>Monitor and manage the Tavari platform</p>
            </div>

            {error && (
              <div style={styles.error}>
                {error}
              </div>
            )}

            {/* Statistics Grid */}
            <div style={styles.grid}>
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{dashboardData.totalBusinesses}</div>
                <div style={styles.statLabel}>Total Businesses</div>
              </div>
              
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{dashboardData.totalUsers}</div>
                <div style={styles.statLabel}>Total Users</div>
              </div>
              
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{dashboardData.activeUsers}</div>
                <div style={styles.statLabel}>Active Users (24h)</div>
              </div>
              
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{dashboardData.recentSignups}</div>
                <div style={styles.statLabel}>New Businesses (7d)</div>
              </div>
              
              {canViewSecurityData && (
                <div style={styles.statCard}>
                  <div style={styles.statNumber}>{dashboardData.securityAlerts}</div>
                  <div style={styles.statLabel}>Security Alerts (7d)</div>
                </div>
              )}
              
              {canViewSupportData && (
                <div style={styles.statCard}>
                  <div style={styles.statNumber}>{dashboardData.supportTickets}</div>
                  <div style={styles.statLabel}>Support Tickets</div>
                </div>
              )}
            </div>

            {/* Quick Actions */}
            {availableActions.length > 0 && (
              <div style={styles.quickActionsGrid}>
                {availableActions.map((action, index) => (
                  <div
                    key={index}
                    style={styles.actionCard}
                    onClick={() => handleQuickActionClick(action)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = TavariStyles.shadows.lg;
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = TavariStyles.shadows.md;
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <div style={{ ...styles.actionIcon, color: action.color }}>
                      {action.icon}
                    </div>
                    <div style={styles.actionTitle}>{action.title}</div>
                    <div style={styles.actionDescription}>{action.description}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent Activity */}
            <div style={styles.activityCard}>
              <h3 style={styles.activityTitle}>Recent Platform Activity</h3>
              {dashboardData.recentActivity.map((activity, index) => (
                <div key={index} style={styles.activityItem}>
                  <div style={styles.activityIcon}>
                    {activity.type === 'business_signup' && <FiUsers />}
                    {activity.type === 'user_activity' && <FiUsers />}
                    {activity.type === 'security_alert' && <FiAlertTriangle />}
                    {activity.type === 'support_ticket' && <FiHeadphones />}
                    {activity.type === 'error' && <FiAlertTriangle />}
                  </div>
                  <div style={styles.activityMessage}>{activity.message}</div>
                  <div style={styles.activityTime}>{activity.time}</div>
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>
    </SecurityWrapper>
  );
};

export default TOSAEmployeeDashboard;