// Step 100: Create AppBuilderAnalyticsScreen.jsx
// Analytics dashboard - Tavari Standards
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, TrendingUp, Download, Calendar } from 'lucide-react';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useAppBuilderAnalytics } from '../../hooks/useAppBuilderAnalytics';
import SecurityWrapper from '../../Security/SecurityWrapper.jsx';
import { TavariStyles } from '../../utils/TavariStyles';
import { getContainerStyles, getCenteredContentStyles } from '../../utils/tavariLayoutUtils';

// Get styles function
const getStyles = () => {
  try {
    return {
      container: {
        minHeight: '100vh',
        backgroundColor: TavariStyles?.colors?.gray50 || '#f9fafb',
        ...getContainerStyles()
      },
      loadingContainer: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: TavariStyles?.colors?.gray50 || '#f9fafb'
      },
      loadingContent: {
        textAlign: 'center'
      },
      spinner: {
        width: '48px',
        height: '48px',
        border: `3px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
        borderTop: `3px solid ${TavariStyles?.colors?.primary || '#008080'}`,
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        margin: '0 auto'
      },
      loadingText: {
        marginTop: TavariStyles?.spacing?.lg || '16px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px'
      },
      content: {
        ...getCenteredContentStyles('1400px')
      },
      header: {
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      headerTop: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: TavariStyles?.spacing?.md || '12px'
      },
      backButton: {
        display: 'flex',
        alignItems: 'center',
        gap: TavariStyles?.spacing?.sm || '8px',
        backgroundColor: 'transparent',
        border: 'none',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        cursor: 'pointer',
        marginBottom: TavariStyles?.spacing?.md || '12px',
        padding: TavariStyles?.spacing?.xs || '4px'
      },
      title: {
        fontSize: TavariStyles?.typography?.fontSize?.['3xl'] || '24px',
        fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        marginBottom: TavariStyles?.spacing?.sm || '8px',
        margin: 0
      },
      subtitle: {
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        margin: 0
      },
      dateSelect: {
        padding: `${TavariStyles?.spacing?.sm || '8px'} ${TavariStyles?.spacing?.md || '12px'}`,
        border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        outline: 'none',
        cursor: 'pointer'
      },
      statsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: TavariStyles?.spacing?.xl || '20px',
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      statCard: {
        backgroundColor: TavariStyles?.colors?.white || '#ffffff',
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        boxShadow: TavariStyles?.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
        padding: TavariStyles?.spacing?.xl || '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      },
      statContent: {
        flex: 1
      },
      statLabel: {
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        marginBottom: TavariStyles?.spacing?.xs || '4px',
        margin: 0
      },
      statValue: {
        fontSize: TavariStyles?.typography?.fontSize?.['3xl'] || '24px',
        fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        margin: 0
      },
      sectionCard: {
        backgroundColor: TavariStyles?.colors?.white || '#ffffff',
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        boxShadow: TavariStyles?.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
        padding: TavariStyles?.spacing?.xl || '20px',
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      sectionHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: TavariStyles?.spacing?.md || '12px'
      },
      sectionTitle: {
        fontSize: TavariStyles?.typography?.fontSize?.xl || '18px',
        fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        margin: 0
      },
      exportButton: {
        display: 'flex',
        alignItems: 'center',
        gap: TavariStyles?.spacing?.xs || '4px',
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        color: TavariStyles?.colors?.primary || '#008080',
        backgroundColor: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: TavariStyles?.spacing?.xs || '4px'
      },
      eventList: {
        display: 'flex',
        flexDirection: 'column',
        gap: TavariStyles?.spacing?.sm || '8px'
      },
      eventItem: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`,
        paddingBottom: TavariStyles?.spacing?.sm || '8px'
      },
      eventType: {
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        margin: 0
      },
      eventTime: {
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        margin: 0,
        marginTop: TavariStyles?.spacing?.xs || '4px'
      },
      eventUserId: {
        fontSize: TavariStyles?.typography?.fontSize?.xs || '12px',
        color: TavariStyles?.colors?.gray500 || '#6b7280'
      },
      emptyState: {
        color: TavariStyles?.colors?.gray500 || '#6b7280',
        textAlign: 'center',
        padding: TavariStyles?.spacing?.xl || '20px'
      },
      typeList: {
        display: 'flex',
        flexDirection: 'column',
        gap: TavariStyles?.spacing?.md || '12px'
      },
      typeItem: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      },
      typeName: {
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        color: TavariStyles?.colors?.gray700 || '#374151',
        margin: 0
      },
      typeCount: {
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        margin: 0
      }
    };
  } catch (e) {
    console.error('Error in getStyles:', e);
    return {};
  }
};

const AppBuilderAnalyticsScreen = () => {
  const navigate = useNavigate();
  const styles = useMemo(() => getStyles(), []);
  const [dateRange, setDateRange] = useState('30d');
  const { analytics, stats, loading, refresh } = useAppBuilderAnalytics(dateRange);

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'AppBuilderAnalyticsScreen'
  });

  if (auth.authLoading || loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingContent}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <SecurityWrapper>
      <div style={styles.container}>
        <div style={styles.content}>
          {/* Header */}
          <div style={styles.header}>
            <button
              onClick={() => navigate('/appbuilder')}
              style={styles.backButton}
            >
              <ArrowLeft size={20} />
              <span>Back to Dashboard</span>
            </button>
            <div style={styles.headerTop}>
              <div>
                <h1 style={styles.title}>Analytics</h1>
                <p style={styles.subtitle}>View app usage and performance metrics</p>
              </div>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                style={styles.dateSelect}
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
              </select>
            </div>
          </div>

          {/* Stats Cards */}
          {stats && (
            <div style={styles.statsGrid}>
              <div style={styles.statCard}>
                <div style={styles.statContent}>
                  <p style={styles.statLabel}>Total Events</p>
                  <p style={styles.statValue}>{stats.total_events || 0}</p>
                </div>
                <BarChart3 size={40} style={{ color: TavariStyles?.colors?.primary || '#008080' }} />
              </div>

              <div style={styles.statCard}>
                <div style={styles.statContent}>
                  <p style={styles.statLabel}>Event Types</p>
                  <p style={styles.statValue}>
                    {stats.events_by_type ? Object.keys(stats.events_by_type).length : 0}
                  </p>
                </div>
                <TrendingUp size={40} style={{ color: TavariStyles?.colors?.success || '#10b981' }} />
              </div>

              <div style={styles.statCard}>
                <div style={styles.statContent}>
                  <p style={styles.statLabel}>Active Days</p>
                  <p style={styles.statValue}>
                    {stats.events_by_day ? Object.keys(stats.events_by_day).length : 0}
                  </p>
                </div>
                <Calendar size={40} style={{ color: TavariStyles?.colors?.warning || '#f59e0b' }} />
              </div>
            </div>
          )}

          {/* Events by Type */}
          {stats?.events_by_type && (
            <div style={styles.sectionCard}>
              <h2 style={styles.sectionTitle}>Events by Type</h2>
              <div style={styles.typeList}>
                {Object.entries(stats.events_by_type).map(([type, count]) => (
                  <div key={type} style={styles.typeItem}>
                    <span style={styles.typeName}>{type}</span>
                    <span style={styles.typeCount}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Events */}
          <div style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Recent Events</h2>
              <button style={styles.exportButton}>
                <Download size={16} />
                Export
              </button>
            </div>
            <div style={styles.eventList}>
              {analytics && Array.isArray(analytics) && analytics.length > 0 ? (
                analytics.slice(0, 20).map((event) => {
                  if (!event || !event.id) return null;
                  return (
                    <div key={event.id} style={styles.eventItem}>
                      <div>
                        <p style={styles.eventType}>{event.event_type || 'Unknown'}</p>
                        <p style={styles.eventTime}>
                          {event.timestamp ? new Date(event.timestamp).toLocaleString() : 'Unknown time'}
                        </p>
                      </div>
                      {event.user_id && (
                        <span style={styles.eventUserId}>
                          User ID: {event.user_id.substring(0, 8)}...
                        </span>
                      )}
                    </div>
                  );
                })
              ) : (
                <p style={styles.emptyState}>No events found</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </SecurityWrapper>
  );
};

// Add CSS animation for spinner
if (typeof document !== 'undefined') {
  const existingStyle = document.querySelector('#analytics-spinner-animation');
  if (!existingStyle) {
    const style = document.createElement('style');
    style.id = 'analytics-spinner-animation';
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

export default AppBuilderAnalyticsScreen;
