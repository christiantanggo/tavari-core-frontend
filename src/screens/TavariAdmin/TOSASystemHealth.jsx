// screens/TavariAdmin/TOSASystemHealth.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMonitor, FiDatabase, FiCpu, FiHardDrive, FiActivity, FiRefreshCw } from 'react-icons/fi';
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

const TOSASystemHealth = () => {
  const navigate = useNavigate();

  // Security context for sensitive system health monitoring
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'TOSASystemHealth',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  // TOSA Authentication
  const auth = useTOSATavariAuth({
    requiredPermissions: ['system_monitoring'],
    componentName: 'TOSASystemHealth'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    isOwner,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks for TOSA operations
  const canViewSystemHealth = auth.hasPermission?.('system_monitoring') || false;
  const canViewDetailedMetrics = auth.hasPermission?.('system_administration') || false;
  const canRefreshMetrics = auth.hasPermission?.('system_monitoring') || false;

  const [metrics, setMetrics] = useState({
    uptime: '99.9%',
    responseTime: '120ms',
    dbConnections: '45/100',
    storageUsed: '67%',
    cpuUsage: '23%',
    memoryUsage: '45%',
    activeUsers: '0',
    apiRequests: '0',
    errorRate: '0.1%',
    lastUpdated: null
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  // TOSA is now open - no auth check needed
  // Removed authentication requirement
  // TOSA is now open - no auth check needed

  // Log initial access
  useEffect(() => {
    if (auth.isAuthenticated && auth.authUser && canViewSystemHealth) {
      logInitialAccess();
    }
  }, [auth.isAuthenticated, auth.authUser, canViewSystemHealth]);

  const logInitialAccess = async () => {
    try {
      await logSecurityEvent('tosa_system_health_accessed', {
        action: 'system_health_screen_loaded',
        tosa_user_id: auth.authUser?.id,
        tosa_user_email: auth.authUser?.email,
        timestamp: new Date().toISOString()
      }, 'high');

      await recordAction('tosa_system_health_accessed', 'system_health', true);

      if (auth.logUserAction) {
        await auth.logUserAction('system_health_viewed', { 
          screen: 'system_health',
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      // Silent fail on logging
    }
  };

  // Load metrics on mount
  useEffect(() => {
    if (auth.isAuthenticated && canViewSystemHealth) {
      loadSystemMetrics();
    }
  }, [auth.isAuthenticated, canViewSystemHealth]);

  // Auto-refresh metrics
  useEffect(() => {
    let interval;
    if (autoRefresh && canRefreshMetrics) {
      interval = setInterval(() => {
        loadSystemMetrics(true);
      }, 30000); // Refresh every 30 seconds
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, canRefreshMetrics]);

  const loadSystemMetrics = async (isAutoRefresh = false) => {
    if (!canViewSystemHealth) {
      toast.error('You do not have permission to view system health');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Rate limit check (skip for auto-refresh to avoid blocking)
      if (!isAutoRefresh) {
        const rateLimitCheck = await checkRateLimit('load_system_health');
        if (!rateLimitCheck.allowed) {
          toast.error('Too many requests. Please wait a moment.');
          setLoading(false);
          return;
        }
      }

      await logSecurityEvent('tosa_system_metrics_access', {
        action: 'load_system_metrics',
        is_auto_refresh: isAutoRefresh,
        tosa_user_id: auth.authUser?.id
      }, 'medium');

      // Load real system metrics from database
      const [usersResult, businessesResult] = await Promise.all([
        // Get active users count (last 24 hours)
        supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .gte('last_sign_in_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        
        // Get total businesses count
        supabase
          .from('businesses')
          .select('id', { count: 'exact', head: true })
      ]);

      // Calculate API requests (estimate from security logs)
      const { count: apiRequestCount } = await supabase
        .from('security_audit_logs')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()); // Last hour

      // Calculate error rate
      const { count: errorCount } = await supabase
        .from('security_audit_logs')
        .select('id', { count: 'exact', head: true })
        .in('severity', ['high', 'critical'])
        .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());

      const errorRate = apiRequestCount > 0 
        ? ((errorCount / apiRequestCount) * 100).toFixed(2)
        : '0.00';

      const updatedMetrics = {
        uptime: '99.9%', // TODO: Calculate from system logs
        responseTime: '120ms', // TODO: Calculate from performance metrics
        dbConnections: '45/100', // TODO: Get from database pool
        storageUsed: '67%', // TODO: Get from storage metrics
        cpuUsage: '23%', // TODO: Get from system metrics
        memoryUsage: '45%', // TODO: Get from system metrics
        activeUsers: String(usersResult.count || 0),
        apiRequests: String(apiRequestCount || 0),
        errorRate: `${errorRate}%`,
        lastUpdated: new Date().toISOString()
      };

      setMetrics(updatedMetrics);

      await recordAction('tosa_system_metrics_loaded', 'system_health', true);
      await logSecurityEvent('tosa_system_metrics_loaded', {
        action: 'load_system_metrics_success',
        is_auto_refresh: isAutoRefresh,
        active_users: usersResult.count || 0,
        api_requests: apiRequestCount || 0,
        error_rate: errorRate,
        tosa_user_id: auth.authUser?.id
      }, 'medium');

      if (!isAutoRefresh) {
        toast.success('System metrics loaded');
      }

    } catch (error) {
      await logSecurityEvent('tosa_system_metrics_load_error', {
        action: 'load_system_metrics_failed',
        error_message: error.message,
        tosa_user_id: auth.authUser?.id
      }, 'high');

      setError('Failed to load system metrics');
      if (!isAutoRefresh) {
        toast.error('Failed to load system metrics');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    await logSecurityEvent('tosa_system_health_refresh', {
      action: 'manual_refresh_metrics',
      tosa_user_id: auth.authUser?.id
    }, 'low');

    await loadSystemMetrics(false);
  };

  const toggleAutoRefresh = async () => {
    const newState = !autoRefresh;
    setAutoRefresh(newState);

    await logSecurityEvent('tosa_auto_refresh_toggled', {
      action: 'toggle_auto_refresh',
      new_state: newState,
      tosa_user_id: auth.authUser?.id
    }, 'low');

    toast.success(newState ? 'Auto-refresh enabled' : 'Auto-refresh disabled');
  };

  const getMetricIcon = (key) => {
    const icons = {
      uptime: <FiMonitor />,
      responseTime: <FiActivity />,
      dbConnections: <FiDatabase />,
      storageUsed: <FiHardDrive />,
      cpuUsage: <FiCpu />,
      memoryUsage: <FiCpu />,
      activeUsers: <FiMonitor />,
      apiRequests: <FiActivity />,
      errorRate: <FiActivity />
    };
    return icons[key] || <FiMonitor />;
  };

  const getMetricColor = (key, value) => {
    // Parse percentage values
    const numValue = parseFloat(value);
    
    if (key === 'errorRate') {
      if (numValue > 5) return TavariStyles.colors.danger;
      if (numValue > 2) return TavariStyles.colors.warning;
      return TavariStyles.colors.success;
    }
    
    if (key === 'uptime') {
      if (numValue < 99) return TavariStyles.colors.danger;
      if (numValue < 99.9) return TavariStyles.colors.warning;
      return TavariStyles.colors.success;
    }
    
    if (key.includes('Usage') || key === 'storageUsed') {
      if (numValue > 80) return TavariStyles.colors.danger;
      if (numValue > 60) return TavariStyles.colors.warning;
      return TavariStyles.colors.success;
    }
    
    return TavariStyles.colors.primary;
  };

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
    actions: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      alignItems: 'center'
    },
    refreshButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    autoRefreshButton: {
      ...TavariStyles.components.button.base,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    lastUpdated: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray500,
      marginBottom: TavariStyles.spacing.lg
    },
    metricsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    metricCard: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xl,
      borderRadius: TavariStyles.borderRadius.lg,
      boxShadow: TavariStyles.shadows.md,
      textAlign: 'center',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      transition: TavariStyles.transitions.normal
    },
    metricIcon: {
      fontSize: '32px',
      marginBottom: TavariStyles.spacing.md
    },
    metricValue: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.xs
    },
    metricLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs,
      textTransform: 'capitalize'
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
      <SecurityWrapper componentName="TOSASystemHealth" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.loading}>
          <div style={TavariStyles.components.loading.spinner}></div>
          <div>Loading System Health...</div>
          <style>{TavariStyles.keyframes.spin}</style>
        </div>
      </SecurityWrapper>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <SecurityWrapper componentName="TOSASystemHealth" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.accessDenied}>
          <h2>Access Denied</h2>
          <p>Tavari employees only. System monitoring access required.</p>
        </div>
      </SecurityWrapper>
    );
  }

  if (!canViewSystemHealth) {
    return (
      <SecurityWrapper componentName="TOSASystemHealth" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.container}>
          <TOSASidebarNav />
          <div style={styles.content}>
            <TOSAHeaderBar />
            <main style={styles.main}>
              <div style={styles.accessDenied}>
                <h2>Access Denied</h2>
                <p>You do not have permission to view system health metrics.</p>
              </div>
            </main>
          </div>
        </div>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper componentName="TOSASystemHealth" sensitiveComponent={true} securityLevel="critical">
      <div style={styles.container}>
        <TOSASidebarNav />
        
        <div style={styles.content}>
          <TOSAHeaderBar />
          
          <main style={styles.main}>
            <div style={styles.header}>
              <h1 style={styles.title}>System Health & Performance</h1>
              
              <div style={styles.actions}>
                {canRefreshMetrics && (
                  <>
                    <button
                      style={styles.refreshButton}
                      onClick={handleRefresh}
                      disabled={loading}
                    >
                      <FiRefreshCw />
                      {loading ? 'Loading...' : 'Refresh'}
                    </button>
                    
                    <button
                      style={{
                        ...styles.autoRefreshButton,
                        ...(autoRefresh 
                          ? TavariStyles.components.button.variants.primary 
                          : TavariStyles.components.button.variants.secondary)
                      }}
                      onClick={toggleAutoRefresh}
                    >
                      <FiActivity />
                      {autoRefresh ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {error && (
              <div style={styles.error}>
                {error}
              </div>
            )}

            {metrics.lastUpdated && (
              <div style={styles.lastUpdated}>
                Last updated: {new Date(metrics.lastUpdated).toLocaleString()}
              </div>
            )}

            {loading && !metrics.lastUpdated ? (
              <div style={styles.loading}>
                <div style={TavariStyles.components.loading.spinner}></div>
                <div>Loading system metrics...</div>
                <style>{TavariStyles.keyframes.spin}</style>
              </div>
            ) : (
              <div style={styles.metricsGrid}>
                {Object.entries(metrics).map(([key, value]) => {
                  if (key === 'lastUpdated') return null;
                  
                  return (
                    <div
                      key={key}
                      style={styles.metricCard}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = TavariStyles.shadows.lg;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = TavariStyles.shadows.md;
                      }}
                    >
                      <div style={{
                        ...styles.metricIcon,
                        color: getMetricColor(key, value)
                      }}>
                        {getMetricIcon(key)}
                      </div>
                      <div style={{
                        ...styles.metricValue,
                        color: getMetricColor(key, value)
                      }}>
                        {value}
                      </div>
                      <div style={styles.metricLabel}>
                        {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </div>
    </SecurityWrapper>
  );
};

export default TOSASystemHealth;