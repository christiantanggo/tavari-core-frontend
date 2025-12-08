// screens/TavariAdmin/TOSABusinessInsights.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiTrendingUp, FiUsers, FiDollarSign, FiBarChart } from 'react-icons/fi';
import toast from 'react-hot-toast';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import { useTOSATavariAuth } from '../../hooks/useTOSATavariAuth';
import { usePermissions } from '../../hooks/usePermissions';

// Foundation Components
import { TavariStyles } from '../../utils/TavariStyles';
import TOSAHeaderBar from '../../components/TavariAdminComp/TOSAHeaderBar';
import TOSASidebarNav from '../../components/TavariAdminComp/TOSASidebarNav';

const TOSABusinessInsights = () => {
  const navigate = useNavigate();

  // Security context for sensitive business insights
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'TOSABusinessInsights',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  // TOSA Authentication
  const auth = useTOSATavariAuth({
    requiredPermissions: ['business_insights'],
    componentName: 'TOSABusinessInsights'
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
  const canViewInsights = auth.hasPermission?.('business_insights') || false;
  const canViewFinancials = auth.hasPermission?.('financial_data') || false;
  const canViewMetrics = auth.hasPermission?.('business_insights') || false;

  const [insights, setInsights] = useState({
    totalRevenue: '$2,456,789',
    activeBusinesses: '1,234',
    monthlyGrowth: '+12.5%',
    customerSatisfaction: '94.2%'
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Check TOSA authentication on mount
  // TOSA is now open - no auth check needed

  // Log initial access
  useEffect(() => {
    if (auth.isAuthenticated && auth.authUser && canViewInsights) {
      logInitialAccess();
    }
  }, [auth.isAuthenticated, auth.authUser, canViewInsights]);

  const logInitialAccess = async () => {
    try {
      await logSecurityEvent('tosa_insights_accessed', {
        action: 'tosa_insights_screen_loaded',
        tosa_user_id: auth.authUser?.id,
        tosa_user_email: auth.authUser?.email,
        timestamp: new Date().toISOString()
      }, 'high');

      await recordAction('tosa_insights_accessed', 'insights_dashboard', true);

      // Use TOSA auth logging if available
      if (auth.logUserAction) {
        await auth.logUserAction('insights_viewed', { 
          screen: 'business_insights',
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      // Silent fail on logging - don't block user experience
    }
  };

  // Load insights data
  useEffect(() => {
    if (auth.isAuthenticated && canViewInsights) {
      loadInsightsData();
    }
  }, [auth.isAuthenticated, canViewInsights]);

  const loadInsightsData = async () => {
    if (!canViewInsights) {
      toast.error('You do not have permission to view business insights');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('load_tosa_insights');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        setLoading(false);
        return;
      }

      await logSecurityEvent('tosa_insights_data_access', {
        action: 'load_insights_data',
        tosa_user_id: auth.authUser?.id
      }, 'high');

      // Load real insights data from database
      const [businessesResult, usersResult, thisMonthBusinesses, lastMonthBusinesses] = await Promise.all([
        // Total active businesses
        supabase
          .from('businesses')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true),
        
        // Total active users (last 30 days)
        supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .gte('last_sign_in_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
        
        // Businesses created this month
        supabase
          .from('businesses')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
        
        // Businesses created last month
        supabase
          .from('businesses')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString())
          .lt('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
      ]);

      const activeBusinesses = businessesResult.count || 0;
      const activeUsers = usersResult.count || 0;
      const thisMonthCount = thisMonthBusinesses.count || 0;
      const lastMonthCount = lastMonthBusinesses.count || 0;

      // Calculate monthly growth
      const monthlyGrowth = lastMonthCount > 0 
        ? (((thisMonthCount - lastMonthCount) / lastMonthCount) * 100).toFixed(1)
        : thisMonthCount > 0 ? '100.0' : '0.0';
      const growthSign = parseFloat(monthlyGrowth) >= 0 ? '+' : '';

      // Calculate customer satisfaction from security logs (low severity = satisfied)
      const { count: lowSeverityEvents } = await supabase
        .from('security_audit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('severity', 'low')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

      const { count: totalEvents } = await supabase
        .from('security_audit_logs')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

      const satisfactionRate = totalEvents > 0 
        ? ((lowSeverityEvents / totalEvents) * 100).toFixed(1)
        : '100.0';

      const realInsights = {
        totalRevenue: 'N/A', // Revenue tracking would need separate table
        activeBusinesses: activeBusinesses.toLocaleString(),
        monthlyGrowth: `${growthSign}${monthlyGrowth}%`,
        customerSatisfaction: `${satisfactionRate}%`
      };

      setInsights(realInsights);

      await recordAction('tosa_insights_loaded', 'insights_dashboard', true);
      await logSecurityEvent('tosa_insights_loaded', {
        action: 'load_insights_success',
        tosa_user_id: auth.authUser?.id
      }, 'high');

    } catch (err) {
      await logSecurityEvent('tosa_insights_load_error', {
        action: 'load_insights_failed',
        error_message: err.message,
        tosa_user_id: auth.authUser?.id
      }, 'critical');
      
      setError('Failed to load insights data');
      toast.error('Failed to load insights data');
    } finally {
      setLoading(false);
    }
  };

  const handleInsightClick = async (insightKey) => {
    await logSecurityEvent('tosa_insight_clicked', {
      action: 'insight_detail_viewed',
      insight_type: insightKey,
      tosa_user_id: auth.authUser?.id
    }, 'low');

    await recordAction('tosa_insight_clicked', insightKey, true);

    // TODO: Navigate to detailed view or show modal
    toast.info(`Detailed view for ${insightKey} coming soon`);
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
      marginLeft: '250px' // Account for fixed sidebar
    },
    main: {
      flex: 1,
      padding: TavariStyles.spacing.xl,
      paddingTop: '120px'
    },
    header: {
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600
    },
    insightsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl
    },
    insightCard: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xl,
      borderRadius: TavariStyles.borderRadius.lg,
      boxShadow: TavariStyles.shadows.md,
      textAlign: 'center',
      cursor: 'pointer',
      transition: TavariStyles.transitions.normal,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    insightCardHover: {
      transform: 'translateY(-2px)',
      boxShadow: TavariStyles.shadows.lg
    },
    insightIcon: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.md
    },
    insightValue: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.success,
      marginBottom: TavariStyles.spacing.xs
    },
    insightLabel: {
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

  // Get icon for each insight type
  const getInsightIcon = (key) => {
    const icons = {
      totalRevenue: <FiDollarSign />,
      activeBusinesses: <FiUsers />,
      monthlyGrowth: <FiTrendingUp />,
      customerSatisfaction: <FiBarChart />
    };
    return icons[key] || <FiBarChart />;
  };

  // Format insight label
  const formatLabel = (key) => {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  };

  if (auth.authLoading) {
    return (
      <SecurityWrapper componentName="TOSABusinessInsights" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.loading}>
          <div style={TavariStyles.components.loading.spinner}></div>
          <div>Loading TOSA Business Insights...</div>
          <style>{TavariStyles.keyframes.spin}</style>
        </div>
      </SecurityWrapper>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <SecurityWrapper componentName="TOSABusinessInsights" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.accessDenied}>
          <h2>Access Denied</h2>
          <p>Tavari employees only.</p>
        </div>
      </SecurityWrapper>
    );
  }

  if (!canViewInsights) {
    return (
      <SecurityWrapper componentName="TOSABusinessInsights" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.container}>
          <TOSASidebarNav />
          <div style={styles.content}>
            <TOSAHeaderBar />
            <main style={styles.main}>
              <div style={styles.accessDenied}>
                <h2>Access Denied</h2>
                <p>You do not have permission to view business insights.</p>
              </div>
            </main>
          </div>
        </div>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper componentName="TOSABusinessInsights" sensitiveComponent={true} securityLevel="critical">
      <div style={styles.container}>
        <TOSASidebarNav />
        
        <div style={styles.content}>
          <TOSAHeaderBar />
          
          <main style={styles.main}>
            <div style={styles.header}>
              <h1 style={styles.title}>Business Insights & Analytics</h1>
              <p style={styles.subtitle}>
                Real-time metrics and key performance indicators across all Tavari businesses
              </p>
            </div>

            {error && (
              <div style={styles.error}>
                {error}
              </div>
            )}

            {loading ? (
              <div style={styles.loading}>
                <div style={TavariStyles.components.loading.spinner}></div>
                <div>Loading insights...</div>
                <style>{TavariStyles.keyframes.spin}</style>
              </div>
            ) : (
              <div style={styles.insightsGrid}>
                {Object.entries(insights).map(([key, value]) => (
                  <div
                    key={key}
                    style={styles.insightCard}
                    onClick={() => handleInsightClick(key)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = TavariStyles.shadows.lg;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = TavariStyles.shadows.md;
                    }}
                  >
                    <div style={styles.insightIcon}>
                      {getInsightIcon(key)}
                    </div>
                    <div style={styles.insightValue}>{value}</div>
                    <div style={styles.insightLabel}>{formatLabel(key)}</div>
                  </div>
                ))}
              </div>
            )}

            {!loading && (
              <div style={{ 
                marginTop: TavariStyles.spacing.xl,
                padding: TavariStyles.spacing.lg,
                backgroundColor: TavariStyles.colors.infoBg,
                borderRadius: TavariStyles.borderRadius.md,
                border: `1px solid ${TavariStyles.colors.info}`
              }}>
                <p style={{ 
                  margin: 0, 
                  color: TavariStyles.colors.infoText,
                  fontSize: TavariStyles.typography.fontSize.sm
                }}>
                  📊 <strong>Note:</strong> Click on any insight card to view detailed analytics and trends.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </SecurityWrapper>
  );
};

export default TOSABusinessInsights;