// src/screens/Music/Ads/AdDashboard.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../supabaseClient';
import { useBusiness } from '../../../contexts/BusinessContext';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { usePermissions } from '../../../hooks/usePermissions';
import PermissionGate from '../../../components/Auth/PermissionGate';
import SessionManager from '../../../components/SessionManager';
import AdPlayer from '../../../components/Ads/AdPlayer';
import toast from 'react-hot-toast';
import { FiLock } from 'react-icons/fi';

const AdDashboard = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  const { profile } = useUserProfile();
  
  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    isOwner,
    isManager,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canManageAds = hasPermission('music.ads.manage') || hasElevatedPrivileges();
  const canViewRevenue = hasAnyPermission(['reports.financial.view', 'music.ads.manage']) || hasElevatedPrivileges();
  const canEditSettings = hasPermission('music.settings.edit') || hasElevatedPrivileges();
  const canAccessAdDashboard = hasAnyPermission(['music.ads.manage', 'reports.financial.view']) || hasElevatedPrivileges();
  
  const [dashboardData, setDashboardData] = useState({
    isInitialized: false,
    totalRevenue: 0,
    todayRevenue: 0,
    weekRevenue: 0,
    totalPlays: 0,
    apiProviders: [],
    recentActivity: []
  });
  
  const [systemHealth, setSystemHealth] = useState({
    providers: {}
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showHealthModal, setShowHealthModal] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (business?.id && !permissionsLoading) {
      if (!canAccessAdDashboard) {
        toast.error('You do not have permission to access the ad dashboard');
        navigate('/dashboard/music');
        return;
      }
      
      loadDashboardData();
      // Set up refresh interval
      const interval = setInterval(loadDashboardData, 30000); // Refresh every 30 seconds
      return () => clearInterval(interval);
    }
  }, [business?.id, permissionsLoading, canAccessAdDashboard]);

  const loadDashboardData = async () => {
    if (!business?.id) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      // Load revenue data from multiple timeframes
      const [revenueData, apiHealth, activityData] = await Promise.all([
        loadRevenueData(),
        loadApiHealth(),
        loadRecentActivity()
      ]);
      
      setDashboardData({
        isInitialized: true,
        ...revenueData,
        apiProviders: apiHealth.providers || [],
        recentActivity: activityData || []
      });
      
      setSystemHealth({
        providers: apiHealth.providerHealth || {}
      });
      
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  const loadRevenueData = async () => {
    // Permission check
    if (!canViewRevenue) {
      return {
        totalRevenue: 0,
        todayRevenue: 0,
        weekRevenue: 0,
        totalPlays: 0
      };
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      // Get revenue data from our detailed tracking table
      const { data: revenueData, error: revenueError } = await supabase
        .from('music_ad_revenue_detailed')
        .select('*')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false });

      if (revenueError) throw revenueError;

      // Get ad plays count
      const { count: totalPlays, error: playsError } = await supabase
        .from('music_ad_plays')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', business.id);

      if (playsError) throw playsError;

      // Calculate revenue totals
      const totalRevenue = revenueData?.reduce((sum, record) => sum + parseFloat(record.business_payout || 0), 0) || 0;
      const todayRevenue = revenueData?.filter(record => 
        record.created_at >= `${today}T00:00:00.000Z`
      ).reduce((sum, record) => sum + parseFloat(record.business_payout || 0), 0) || 0;
      
      const weekRevenue = revenueData?.filter(record => 
        record.created_at >= `${weekAgo}T00:00:00.000Z`
      ).reduce((sum, record) => sum + parseFloat(record.business_payout || 0), 0) || 0;

      return {
        totalRevenue,
        todayRevenue,
        weekRevenue,
        totalPlays: totalPlays || 0
      };
      
    } catch (error) {
      return {
        totalRevenue: 0,
        todayRevenue: 0,
        weekRevenue: 0,
        totalPlays: 0
      };
    }
  };

  const loadApiHealth = async () => {
    try {
      // Get API configuration and performance data
      const { data: apiData, error: apiError } = await supabase
        .from('music_ad_apis')
        .select('*')
        .eq('active', true)
        .order('priority', { ascending: true });

      if (apiError) throw apiError;

      // Get latest performance data for each API
      const { data: perfData, error: perfError } = await supabase
        .from('music_api_performance')
        .select('*')
        .eq('business_id', business.id)
        .eq('date_recorded', new Date().toISOString().split('T')[0]);

      if (perfError) throw perfError;

      const providers = apiData?.map(api => {
        const perf = perfData?.find(p => p.api_provider === api.api_name);
        const fillRate = perf ? (perf.successful_requests / Math.max(perf.total_requests, 1)) * 100 : 0;
        
        return {
          provider: api.api_name,
          displayName: api.display_name,
          status: fillRate > 80 ? 'healthy' : fillRate > 50 ? 'degraded' : 'error',
          fillRate: fillRate,
          responseTime: perf?.average_response_time_ms || 0
        };
      }) || [];

      const providerHealth = {};
      providers.forEach(p => {
        providerHealth[p.provider] = {
          status: p.status,
          fillRate: p.fillRate,
          responseTime: p.responseTime
        };
      });

      return { providers, providerHealth };
      
    } catch (error) {
      return { 
        providers: [
          { provider: 'spotify', displayName: 'Spotify Ad Studio', status: 'unknown' },
          { provider: 'google', displayName: 'Google Ad Manager', status: 'unknown' },
          { provider: 'siriusxm', displayName: 'SiriusXM Media', status: 'unknown' },
          { provider: 'networks', displayName: 'Ad Networks', status: 'unknown' }
        ], 
        providerHealth: {} 
      };
    }
  };

  const loadRecentActivity = async () => {
    try {
      // Get recent ad plays with revenue data
      const { data: activityData, error } = await supabase
        .from('music_ad_plays')
        .select(`
          *,
          music_ad_revenue_detailed (
            business_payout,
            api_provider
          )
        `)
        .eq('business_id', business.id)
        .order('played_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      return activityData?.map((play, index) => ({
        id: play.id || index,
        type: 'ad_play',
        message: `Ad played successfully${play.music_ad_revenue_detailed?.[0]?.api_provider ? ` via ${play.music_ad_revenue_detailed[0].api_provider}` : ''}`,
        timestamp: new Date(play.played_at),
        revenue: parseFloat(play.music_ad_revenue_detailed?.[0]?.business_payout || 0)
      })) || [];
      
    } catch (error) {
      return [];
    }
  };

  const onRefresh = async () => {
    if (!canAccessAdDashboard) {
      toast.error('You do not have permission to refresh dashboard data');
      return;
    }
    
    setRefreshing(true);
    await loadDashboardData();
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(amount || 0);
  };

  const getActivityIcon = (type) => {
    switch (type) {
      case 'ad_play': return '▶️';
      case 'revenue': return '💰';
      case 'error': return '⚠️';
      default: return 'ℹ️';
    }
  };

  const getActivityColor = (type) => {
    switch (type) {
      case 'ad_play': return '#4caf50';
      case 'revenue': return '#009688';
      case 'error': return '#f44336';
      default: return '#666';
    }
  };

  const getSystemHealthStatus = () => {
    if (!systemHealth.providers || Object.keys(systemHealth.providers).length === 0) {
      return { status: 'unknown', color: '#666', text: 'System Status Unknown' };
    }
    
    const providers = Object.values(systemHealth.providers);
    const healthyCount = providers.filter(p => p.status === 'healthy').length;
    const totalCount = providers.length;
    
    if (healthyCount === totalCount) {
      return { status: 'excellent', color: '#4caf50', text: 'All Systems Operational' };
    } else if (healthyCount >= totalCount * 0.7) {
      return { status: 'good', color: '#8bc34a', text: 'Most Systems Operational' };
    } else if (healthyCount > 0) {
      return { status: 'degraded', color: '#ff9800', text: 'Limited Functionality' };
    } else {
      return { status: 'down', color: '#f44336', text: 'System Issues Detected' };
    }
  };

  const healthStatus = getSystemHealthStatus();

  // Show loading while permissions are being checked
  if (permissionsLoading) {
    return (
      <SessionManager>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner}></div>
          <div style={styles.loadingText}>Loading permissions...</div>
        </div>
      </SessionManager>
    );
  }

  // Show access denied if no permission
  if (!canAccessAdDashboard) {
    return (
      <SessionManager>
        <div style={styles.errorContainer}>
          <FiLock size={64} style={{ color: '#f44336', marginBottom: '20px' }} />
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '10px' }}>Access Denied</h2>
          <p style={{ fontSize: '16px', color: '#666', marginBottom: '20px' }}>
            You do not have permission to access the ad dashboard.
          </p>
          <p style={{ fontSize: '14px', color: '#999', marginBottom: '30px' }}>
            Contact your manager or administrator for access.
          </p>
          <button 
            onClick={() => navigate('/dashboard/music')} 
            style={styles.retryButton}
          >
            Return to Music Dashboard
          </button>
        </div>
      </SessionManager>
    );
  }

  if (isLoading && !dashboardData.isInitialized) {
    return (
      <SessionManager>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner}></div>
          <div style={styles.loadingText}>Loading Ad Dashboard...</div>
        </div>
      </SessionManager>
    );
  }

  if (error) {
    return (
      <SessionManager>
        <div style={styles.errorContainer}>
          <div style={styles.errorText}>Error loading dashboard: {error}</div>
          <button onClick={() => window.location.reload()} style={styles.retryButton}>
            Retry
          </button>
        </div>
      </SessionManager>
    );
  }

  return (
    <SessionManager>
      <div style={styles.container}>
        {/* Header Stats */}
        <div style={styles.card}>
          <h1 style={styles.headerTitle}>Ad Revenue Dashboard</h1>
          
          <PermissionGate 
            permissions={['reports.financial.view', 'music.ads.manage']}
            requireAny
            fallback={
              <div style={{ 
                textAlign: 'center', 
                padding: '40px', 
                backgroundColor: '#fff3cd',
                borderRadius: '8px',
                border: '2px solid #ffc107'
              }}>
                <FiLock size={48} style={{ color: '#ff9800', marginBottom: '15px' }} />
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px' }}>Revenue Data Hidden</h3>
                <p style={{ color: '#856404' }}>
                  You need financial reporting permissions to view revenue statistics.
                </p>
              </div>
            }
          >
            <div style={styles.statsGrid}>
              <div style={styles.statBox}>
                <div style={styles.statValue}>{formatCurrency(dashboardData.todayRevenue)}</div>
                <div style={styles.statLabel}>Today's Revenue</div>
              </div>
              
              <div style={styles.statBox}>
                <div style={styles.statValue}>{formatCurrency(dashboardData.weekRevenue)}</div>
                <div style={styles.statLabel}>7-Day Revenue</div>
              </div>
              
              <div style={styles.statBox}>
                <div style={styles.statValue}>{formatCurrency(dashboardData.totalRevenue)}</div>
                <div style={styles.statLabel}>Total Revenue</div>
              </div>
              
              <div style={styles.statBox}>
                <div style={styles.statValue}>{dashboardData.totalPlays.toLocaleString()}</div>
                <div style={styles.statLabel}>Total Ad Plays</div>
              </div>
            </div>
          </PermissionGate>
        </div>

        {/* System Health */}
        <div style={styles.card}>
          <div style={styles.healthHeader}>
            <h2 style={styles.sectionTitle}>System Health</h2>
            <button 
              onClick={() => setShowHealthModal(true)}
              style={{
                ...styles.healthChip,
                backgroundColor: healthStatus.color + '20',
                color: healthStatus.color
              }}
            >
              {healthStatus.text}
            </button>
          </div>
          
          <div style={styles.providersRow}>
            {dashboardData.apiProviders.map((provider, index) => (
              <div key={index} style={styles.providerStatus}>
                <div 
                  style={{
                    ...styles.providerIndicator,
                    backgroundColor: provider.status === 'healthy' ? '#4caf50' : 
                                   provider.status === 'degraded' ? '#ff9800' : '#f44336'
                  }} 
                />
                <span style={styles.providerName}>
                  {provider.displayName || provider.provider}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Quick Actions</h2>
          
          <div style={styles.actionsGrid}>
            <PermissionGate 
              permissions={['reports.financial.view', 'music.ads.manage']}
              requireAny
              fallback={
                <button
                  disabled
                  style={{ ...styles.actionButton, opacity: 0.5, cursor: 'not-allowed' }}
                  title="Permission required to view revenue reports"
                >
                  <FiLock style={{ marginRight: '8px' }} />
                  Revenue Reports
                </button>
              }
            >
              <button
                onClick={() => navigate('/dashboard/music/ads/revenue')}
                style={styles.actionButton}
              >
                📊 Revenue Reports
              </button>
            </PermissionGate>
            
            <PermissionGate 
              permission="music.settings.edit"
              fallback={
                <button
                  disabled
                  style={{ ...styles.actionButton, opacity: 0.5, cursor: 'not-allowed' }}
                  title="Permission required to edit ad settings"
                >
                  <FiLock style={{ marginRight: '8px' }} />
                  Ad Settings
                </button>
              }
            >
              <button
                onClick={() => navigate('/dashboard/music/ads/settings')}
                style={styles.actionButton}
              >
                ⚙️ Ad Settings
              </button>
            </PermissionGate>
            
            <PermissionGate 
              permissions={['reports.financial.view', 'music.ads.manage']}
              requireAny
              fallback={
                <button
                  disabled
                  style={{ ...styles.actionButton, opacity: 0.5, cursor: 'not-allowed' }}
                  title="Permission required to view payout history"
                >
                  <FiLock style={{ marginRight: '8px' }} />
                  Payout History
                </button>
              }
            >
              <button
                onClick={() => navigate('/dashboard/music/ads/payouts')}
                style={styles.actionButton}
              >
                🏦 Payout History
              </button>
            </PermissionGate>
            
            <PermissionGate 
              permission="music.ads.manage"
              fallback={
                <button
                  disabled
                  style={{ ...styles.actionButton, opacity: 0.5, cursor: 'not-allowed' }}
                  title="Permission required to manage ad scheduler"
                >
                  <FiLock style={{ marginRight: '8px' }} />
                  Ad Scheduler
                </button>
              }
            >
              <button
                onClick={() => setShowScheduler(!showScheduler)}
                style={{
                  ...styles.actionButton,
                  backgroundColor: showScheduler ? '#009688' : '#fff',
                  color: showScheduler ? '#fff' : '#009688'
                }}
              >
                ⏰ {showScheduler ? 'Hide Scheduler' : 'Ad Scheduler'}
              </button>
            </PermissionGate>
            
            <button
              onClick={onRefresh}
              disabled={refreshing}
              style={{
                ...styles.actionButton,
                opacity: refreshing ? 0.6 : 1
              }}
            >
              🔄 {refreshing ? 'Refreshing...' : 'Refresh Data'}
            </button>
          </div>
        </div>

        {/* Ad Scheduler Section */}
        {showScheduler && canManageAds && (
          <div style={styles.card}>
            <div style={styles.schedulerHeader}>
              <h2 style={styles.sectionTitle}>Ad Scheduler</h2>
              <button 
                onClick={() => setShowScheduler(false)}
                style={styles.closeButton}
              >
                ✕
              </button>
            </div>
            <AdSchedulerWeb 
              business={business}
              profile={profile}
              onSettingsChange={(settings) => {
                loadDashboardData();
              }}
            />
          </div>
        )}

        {/* Test AdPlayer Component */}
        <PermissionGate permission="music.ads.manage">
          <div style={styles.card}>
            <h2 style={styles.sectionTitle}>Ad Player Test</h2>
            <div style={{marginBottom: '10px', fontSize: '12px', color: '#666'}}>
              Testing with proper UUID format
            </div>
            <AdPlayer
              key={`test-ad-player-${Math.random()}`}
              ad={{
                id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
                title: 'Test Advertisement - Fixed',
                advertiser: 'Test Company',
                audioUrl: 'https://commondatastorage.googleapis.com/codeskulptor-demos/DDR_assets/Kangaroo_MusiQue_-_The_Neverwritten_Role_Playing_Game.mp3',
                duration: 30,
                cpm: 20.00,
                currency: 'CAD',
                metadata: { provider: 'test' }
              }}
              onAdCompleted={(data) => {}}
              onAdError={(error) => {}}
              showControls={true}
            />
          </div>
        </PermissionGate>

        {/* Recent Activity */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Recent Activity</h2>
          
          {dashboardData.recentActivity.length === 0 ? (
            <div style={styles.noActivityText}>No recent ad activity</div>
          ) : (
            <div style={styles.activityList}>
              {dashboardData.recentActivity.map((activity) => (
                <div key={activity.id} style={styles.activityItem}>
                  <div style={styles.activityIcon}>
                    <span style={{ color: getActivityColor(activity.type) }}>
                      {getActivityIcon(activity.type)}
                    </span>
                  </div>
                  <div style={styles.activityInfo}>
                    <div style={styles.activityMessage}>{activity.message}</div>
                    <div style={styles.activityTime}>{activity.timestamp.toLocaleString()}</div>
                  </div>
                  <PermissionGate 
                    permissions={['reports.financial.view', 'music.ads.manage']}
                    requireAny
                  >
                    {activity.revenue > 0 && (
                      <div style={styles.activityRevenue}>
                        +{formatCurrency(activity.revenue)}
                      </div>
                    )}
                  </PermissionGate>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Health Details Modal */}
        {showHealthModal && (
          <div style={styles.modalOverlay} onClick={() => setShowHealthModal(false)}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
              <h2 style={styles.modalTitle}>System Health Details</h2>
              
              {dashboardData.apiProviders.map((provider, index) => (
                <div key={index} style={styles.providerDetail}>
                  <div style={styles.providerDetailHeader}>
                    <h3 style={styles.providerDetailName}>
                      {provider.displayName || provider.provider}
                    </h3>
                    <span 
                      style={{
                        ...styles.statusChip,
                        backgroundColor: provider.status === 'healthy' ? '#e8f5e8' : 
                                       provider.status === 'degraded' ? '#fff3e0' : '#ffebee',
                        color: provider.status === 'healthy' ? '#2e7d32' : 
                               provider.status === 'degraded' ? '#f57c00' : '#c62828'
                      }}
                    >
                      {provider.status?.toUpperCase() || 'UNKNOWN'}
                    </span>
                  </div>
                  
                  {provider.fillRate !== undefined && (
                    <div style={styles.providerMetric}>
                      Fill Rate: {provider.fillRate.toFixed(1)}%
                    </div>
                  )}
                  
                  {provider.responseTime > 0 && (
                    <div style={styles.providerMetric}>
                      Response Time: {provider.responseTime}ms
                    </div>
                  )}
                  
                  {index < dashboardData.apiProviders.length - 1 && (
                    <div style={styles.divider} />
                  )}
                </div>
              ))}
              
              <button
                onClick={() => setShowHealthModal(false)}
                style={styles.closeButton}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </SessionManager>
  );
};

// Web-compatible AdScheduler Component
const AdSchedulerWeb = ({ business, profile, onSettingsChange }) => {
  const [schedules, setSchedules] = useState([]);
  const [activeSchedule, setActiveSchedule] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Permission system
  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const canEditSchedule = hasPermission('music.ads.manage') || hasElevatedPrivileges();

  useEffect(() => {
    if (business?.id) {
      loadSchedules();
    }
  }, [business?.id]);

  const loadSchedules = async () => {
    if (!business?.id) return;
    
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('music_ad_schedule')
        .select(`
          *,
          music_ad_time_rules (*)
        `)
        .eq('business_id', business.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      setSchedules(data || []);
      
      // Set active schedule
      if (data?.length > 0) {
        const active = data.find(s => s.active) || data[0];
        setActiveSchedule(active);
      }
      
    } catch (err) {
      setError('Failed to load ad schedules');
    } finally {
      setIsLoading(false);
    }
  };

  const updateSchedule = async (field, value) => {
    if (!activeSchedule) return;
    
    // Permission check
    if (!canEditSchedule) {
      toast.error('You do not have permission to edit ad schedule');
      return;
    }
    
    try {
      const { error } = await supabase
        .from('music_ad_schedule')
        .update({ 
          [field]: value, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', activeSchedule.id)
        .eq('business_id', business.id);
      
      if (error) throw error;
      
      setActiveSchedule(prev => ({ ...prev, [field]: value }));
      
      if (onSettingsChange) {
        onSettingsChange({ ...activeSchedule, [field]: value });
      }
      
      toast.success('Schedule updated successfully');
      
    } catch (err) {
      toast.error('Failed to update schedule');
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(amount || 0);
  };

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>Loading scheduler...</div>;
  }

  if (error) {
    return <div style={{ textAlign: 'center', padding: '40px', color: '#f44336' }}>{error}</div>;
  }

  if (!activeSchedule) {
    return <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>No schedule found</div>;
  }

  return (
    <div style={schedulerStyles.container}>
      {/* Current Schedule Status */}
      <div style={schedulerStyles.statusSection}>
        <div style={schedulerStyles.statusHeader}>
          <h3 style={schedulerStyles.statusTitle}>{activeSchedule.schedule_name}</h3>
          <div style={schedulerStyles.statusIndicator}>
            <div style={{
              ...schedulerStyles.statusDot,
              backgroundColor: activeSchedule.active ? '#4caf50' : '#666'
            }} />
            <span style={schedulerStyles.statusText}>
              {activeSchedule.active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
        
        <div style={schedulerStyles.quickStats}>
          <div style={schedulerStyles.statItem}>
            <span style={schedulerStyles.statLabel}>Frequency:</span>
            <span style={schedulerStyles.statValue}>Every {activeSchedule.ad_frequency} songs</span>
          </div>
          <div style={schedulerStyles.statItem}>
            <span style={schedulerStyles.statLabel}>Max/Hour:</span>
            <span style={schedulerStyles.statValue}>{activeSchedule.max_ads_per_hour}</span>
          </div>
          <div style={schedulerStyles.statItem}>
            <span style={schedulerStyles.statLabel}>Volume:</span>
            <span style={schedulerStyles.statValue}>{Math.round(activeSchedule.volume_adjustment * 100)}%</span>
          </div>
        </div>
      </div>

      {/* Quick Controls */}
      <div style={schedulerStyles.controlsSection}>
        <div style={schedulerStyles.controlGroup}>
          <label style={schedulerStyles.controlLabel}>
            <input
              type="checkbox"
              checked={activeSchedule.active || false}
              onChange={(e) => updateSchedule('active', e.target.checked)}
              style={schedulerStyles.checkbox}
              disabled={!canEditSchedule}
            />
            Enable Ad Scheduling
            {!canEditSchedule && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
          </label>
        </div>

        <div style={schedulerStyles.controlGroup}>
          <label style={schedulerStyles.controlLabel}>
            Ad Frequency (Every X songs): {activeSchedule.ad_frequency}
            {!canEditSchedule && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
          </label>
          <input
            type="range"
            min="1"
            max="20"
            value={activeSchedule.ad_frequency}
            onChange={(e) => updateSchedule('ad_frequency', parseInt(e.target.value))}
            style={schedulerStyles.slider}
            disabled={!canEditSchedule}
          />
        </div>

        <div style={schedulerStyles.controlGroup}>
          <label style={schedulerStyles.controlLabel}>
            Max Ads Per Hour: {activeSchedule.max_ads_per_hour}
            {!canEditSchedule && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
          </label>
          <input
            type="range"
            min="1"
            max="20"
            value={activeSchedule.max_ads_per_hour}
            onChange={(e) => updateSchedule('max_ads_per_hour', parseInt(e.target.value))}
            style={schedulerStyles.slider}
            disabled={!canEditSchedule}
          />
        </div>

        <div style={schedulerStyles.controlGroup}>
          <label style={schedulerStyles.controlLabel}>
            Ad Volume: {Math.round(activeSchedule.volume_adjustment * 100)}%
            {!canEditSchedule && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
          </label>
          <input
            type="range"
            min="0.3"
            max="1.0"
            step="0.1"
            value={activeSchedule.volume_adjustment}
            onChange={(e) => updateSchedule('volume_adjustment', parseFloat(e.target.value))}
            style={schedulerStyles.slider}
            disabled={!canEditSchedule}
          />
        </div>
      </div>

      {/* Time Rules Summary */}
      {activeSchedule.music_ad_time_rules?.length > 0 && (
        <div style={schedulerStyles.rulesSection}>
          <h4 style={schedulerStyles.rulesTitle}>Active Time Rules</h4>
          {activeSchedule.music_ad_time_rules.slice(0, 3).map((rule) => (
            <div key={rule.id} style={schedulerStyles.ruleItem}>
              <span style={schedulerStyles.ruleName}>{rule.rule_name}</span>
              <span style={schedulerStyles.ruleTime}>
                {rule.start_time} - {rule.end_time}
              </span>
              <span style={{
                ...schedulerStyles.ruleStatus,
                color: rule.enabled ? '#4caf50' : '#666'
              }}>
                {rule.enabled ? 'Active' : 'Inactive'}
              </span>
            </div>
          ))}
          {activeSchedule.music_ad_time_rules.length > 3 && (
            <div style={schedulerStyles.moreRules}>
              +{activeSchedule.music_ad_time_rules.length - 3} more rules
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    padding: '20px',
    backgroundColor: '#f5f5f5',
    minHeight: '100vh'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5'
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e9ecef',
    borderTop: '4px solid #009688',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '15px'
  },
  loadingText: {
    fontSize: '16px',
    color: '#666'
  },
  errorText: {
    fontSize: '16px',
    color: '#f44336',
    marginBottom: '20px',
    textAlign: 'center'
  },
  retryButton: {
    padding: '10px 20px',
    backgroundColor: '#009688',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  headerTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '20px',
    textAlign: 'center',
    margin: '0 0 20px 0'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '15px'
  },
  statBox: {
    textAlign: 'center',
    padding: '20px',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px'
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#009688',
    marginBottom: '5px'
  },
  statLabel: {
    fontSize: '12px',
    color: '#666',
    textTransform: 'uppercase'
  },
  healthHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px'
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0
  },
  healthChip: {
    padding: '6px 12px',
    borderRadius: '16px',
    border: 'none',
    fontSize: '12px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  providersRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px'
  },
  providerStatus: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: '8px 12px',
    borderRadius: '16px'
  },
  providerIndicator: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    marginRight: '8px'
  },
  providerName: {
    fontSize: '12px',
    color: '#333',
    textTransform: 'capitalize'
  },
  actionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '10px'
  },
  actionButton: {
    padding: '15px 20px',
    border: '1px solid #009688',
    borderRadius: '8px',
    backgroundColor: '#fff',
    color: '#009688',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    textAlign: 'left',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  schedulerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    color: '#666',
    cursor: 'pointer',
    padding: '5px',
    borderRadius: '4px'
  },
  noActivityText: {
    textAlign: 'center',
    color: '#666',
    fontStyle: 'italic',
    padding: '40px 0'
  },
  activityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
    marginBottom: '20px'
  },
  activityItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '15px',
    border: '1px solid #eee',
    borderRadius: '8px'
  },
  activityIcon: {
    fontSize: '20px',
    marginRight: '15px'
  },
  activityInfo: {
    flex: 1
  },
  activityMessage: {
    fontSize: '14px',
    color: '#333',
    marginBottom: '5px'
  },
  activityTime: {
    fontSize: '12px',
    color: '#666'
  },
  activityRevenue: {
    color: '#4caf50',
    fontWeight: 'bold',
    fontSize: '14px'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '30px',
    maxWidth: '600px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'auto'
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: '20px',
    margin: '0 0 20px 0'
  },
  providerDetail: {
    marginBottom: '15px'
  },
  providerDetailHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  providerDetailName: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    textTransform: 'capitalize',
    margin: 0
  },
  statusChip: {
    padding: '4px 8px',
    borderRadius: '12px',
    fontSize: '10px',
    fontWeight: 'bold'
  },
  providerMetric: {
    fontSize: '12px',
    color: '#666',
    marginBottom: '4px'
  },
  divider: {
    height: '1px',
    backgroundColor: '#eee',
    margin: '15px 0'
  }
};

const schedulerStyles = {
  container: {
    maxWidth: '100%'
  },
  statusSection: {
    backgroundColor: '#f8f9fa',
    padding: '15px',
    borderRadius: '8px',
    marginBottom: '20px'
  },
  statusHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px'
  },
  statusTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%'
  },
  statusText: {
    fontSize: '14px',
    color: '#666'
  },
  quickStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '15px'
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  statLabel: {
    fontSize: '12px',
    color: '#666',
    marginBottom: '4px'
  },
  statValue: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#009688'
  },
  controlsSection: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '15px',
    marginBottom: '20px'
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  controlLabel: {
    fontSize: '14px',
    color: '#333',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer'
  },
  slider: {
    width: '100%',
    height: '6px',
    borderRadius: '3px',
    background: '#ddd',
    outline: 'none',
    cursor: 'pointer'
  },
  rulesSection: {
    backgroundColor: '#f8f9fa',
    padding: '15px',
    borderRadius: '8px'
  },
  rulesTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '10px',
    margin: '0 0 10px 0'
  },
  ruleItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #eee'
  },
  ruleName: {
    fontSize: '13px',
    color: '#333',
    fontWeight: '500'
  },
  ruleTime: {
    fontSize: '12px',
    color: '#666'
  },
  ruleStatus: {
    fontSize: '12px',
    fontWeight: 'bold'
  },
  moreRules: {
    fontSize: '12px',
    color: '#666',
    textAlign: 'center',
    marginTop: '10px',
    fontStyle: 'italic'
  }
};

// Add spinner animation CSS
if (!document.querySelector('#ad-dashboard-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'ad-dashboard-styles';
  styleSheet.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .actionButton:hover {
      background-color: #009688 !important;
      color: #fff !important;
    }

    input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      background: transparent;
      cursor: pointer;
    }

    input[type="range"]::-webkit-slider-track {
      background: #ddd;
      height: 6px;
      border-radius: 3px;
    }

    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      height: 18px;
      width: 18px;
      border-radius: 50%;
      background: #009688;
      cursor: pointer;
    }

    input[type="range"]::-moz-range-track {
      background: #ddd;
      height: 6px;
      border-radius: 3px;
      border: none;
    }

    input[type="range"]::-moz-range-thumb {
      height: 18px;
      width: 18px;
      border-radius: 50%;
      background: #009688;
      cursor: pointer;
      border: none;
    }

    input[type="checkbox"] {
      width: 18px !important;
      height: 18px !important;
      cursor: pointer;
      margin: 0;
      margin-right: 8px;
      accent-color: #009688;
    }

    input[type="range"]:disabled,
    input[type="checkbox"]:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(styleSheet);
}

export default AdDashboard;