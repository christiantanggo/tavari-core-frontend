// components/Mail/CampaignAnalyticsDashboard.jsx - Step 108: Campaign Performance Metrics Foundation
import React, { useState, useEffect, useMemo } from 'react';
import { 
  FiBarChart2, FiTrendingUp, FiTrendingDown, FiEye, FiMousePointer, 
  FiMail, FiUsers, FiClock, FiTarget, FiAward, FiAlertTriangle,
  FiCalendar, FiFilter, FiDownload, FiRefreshCw, FiShare2, FiSettings, FiX
} from 'react-icons/fi';
import AnalyticsFoundation from '../../helpers/Mail/AnalyticsFoundation';
import { formatDateShort, formatDateTimeForBusiness } from '../../utils/businessDateFormat';

const CampaignAnalyticsDashboard = ({
  businessId,
  businessTimezone = 'America/Toronto',
  isOpen = true,
  onClose,
  embedded = false,
  initialCampaignId = null,
  initialTab = 'overview'
}) => {
  const [timeframe, setTimeframe] = useState('30d'); // '7d', '30d', '90d', 'all'
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [dashboardData, setDashboardData] = useState(null);
  const [contentPerformance, setContentPerformance] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab); // 'overview', 'campaigns', 'content', 'abtest'
  const [chartType, setChartType] = useState('line'); // 'line', 'bar', 'donut'

  const visibleCampaigns = useMemo(() => {
    if (!selectedCampaign) {
      return campaigns;
    }

    return campaigns.filter((campaign) => campaign.id === selectedCampaign);
  }, [campaigns, selectedCampaign]);

  useEffect(() => {
    setActiveTab(initialTab || 'overview');
  }, [initialTab]);

  useEffect(() => {
    if (isOpen && businessId) {
      loadDashboardData();
    }
  }, [isOpen, businessId, timeframe, businessTimezone]);

  useEffect(() => {
    if (!isOpen || !businessId || !selectedCampaign) return;

    const loadSelectedCampaignContent = async () => {
      const contentResult = await AnalyticsFoundation.getContentBlockPerformance(selectedCampaign);
      if (contentResult.success) {
        setContentPerformance(Object.values(contentResult.performance));
      }
    };

    loadSelectedCampaignContent();
  }, [isOpen, businessId, selectedCampaign]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      // Load comprehensive analytics data
      const result = await AnalyticsFoundation.getAnalyticsDashboardData(businessId, timeframe, businessTimezone);
      
      if (result.success) {
        setDashboardData(result.dashboard_data);
        setCampaigns(result.dashboard_data.campaign_performance || []);

        const campaignIds = result.dashboard_data.campaign_performance || [];
        const preferredCampaignId =
          initialCampaignId && campaignIds.some((campaign) => campaign.id === initialCampaignId)
            ? initialCampaignId
            : campaignIds[0]?.id || null;

        setSelectedCampaign(preferredCampaignId);

        // Load content performance data
        if (preferredCampaignId) {
          const firstCampaignId = preferredCampaignId;
          const contentResult = await AnalyticsFoundation.getContentBlockPerformance(firstCampaignId);
          if (contentResult.success) {
            setContentPerformance(Object.values(contentResult.performance));
          }
        }
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateOverallMetrics = () => {
    if (!visibleCampaigns.length) return {
      totalCampaigns: 0,
      totalEmailsSent: 0,
      totalDeliveries: 0,
      averageOpenRate: 0,
      averageClickRate: 0,
      totalViews: 0,
      totalClicks: 0,
      bestPerformingCampaign: null
    };

    const totalEmailsSent = visibleCampaigns.reduce((sum, c) => sum + (c.emails_sent || 0), 0);
    const totalDeliveries = visibleCampaigns.reduce(
      (sum, c) => sum + (c.performance?.deliveries || c.emails_sent || 0),
      0
    );
    const totalViews = visibleCampaigns.reduce((sum, c) => sum + (c.performance?.views || 0), 0);
    const totalClicks = visibleCampaigns.reduce((sum, c) => sum + (c.performance?.clicks || 0), 0);
    
    const averageOpenRate = totalDeliveries > 0 ? (totalViews / totalDeliveries) * 100 : 0;
    const averageClickRate = totalDeliveries > 0 ? (totalClicks / totalDeliveries) * 100 : 0;
    
    const bestPerformingCampaign = visibleCampaigns.reduce((best, current) => {
      const currentRate = current.performance?.click_through_rate || 0;
      const bestRate = best?.performance?.click_through_rate || 0;
      return currentRate > bestRate ? current : best;
    }, null);

    return {
      totalCampaigns: visibleCampaigns.length,
      totalEmailsSent,
      totalDeliveries,
      averageOpenRate,
      averageClickRate,
      totalViews,
      totalClicks,
      bestPerformingCampaign
    };
  };

  const getPerformanceColor = (value, type = 'rate') => {
    if (type === 'rate') {
      if (value >= 25) return '#4caf50'; // Green for high performance
      if (value >= 15) return '#ff9800'; // Orange for medium performance
      return '#f44336'; // Red for low performance
    }
    return '#2196f3'; // Default blue
  };

  const getPerformanceIcon = (value, type = 'rate') => {
    if (type === 'rate') {
      if (value >= 25) return FiTrendingUp;
      if (value >= 15) return FiBarChart2;
      return FiTrendingDown;
    }
    return FiBarChart2;
  };

  const formatMetric = (value, type = 'number') => {
    switch (type) {
      case 'percentage':
        return `${value.toFixed(1)}%`;
      case 'number':
        return value.toLocaleString();
      case 'currency':
        return `$${value.toFixed(2)}`;
      default:
        return value.toString();
    }
  };

  const exportAnalytics = () => {
    const exportData = {
      timeframe,
      generated_at: formatDateTimeForBusiness(new Date(), businessTimezone),
      business_id: businessId,
      overview_metrics: calculateOverallMetrics(),
      campaign_performance: visibleCampaigns,
      content_performance: contentPerformance,
      recommendations: dashboardData?.recommendations || []
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email-analytics-${timeframe}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderOverviewTab = () => {
    const metrics = calculateOverallMetrics();

    return (
      <div style={styles.tabContent}>
        {/* Key Metrics Grid */}
        <div style={styles.metricsGrid}>
          <div style={styles.metricCard}>
            <div style={styles.metricHeader}>
              <FiMail style={styles.metricIcon} />
              <span style={styles.metricLabel}>Total Campaigns</span>
            </div>
            <div style={styles.metricValue}>{metrics.totalCampaigns}</div>
            <div style={styles.metricSubtext}>
              {timeframe === '30d' ? 'Last 30 days' : 
               timeframe === '7d' ? 'Last 7 days' : 
               timeframe === '90d' ? 'Last 90 days' : 'All time'}
            </div>
          </div>

          <div style={styles.metricCard}>
            <div style={styles.metricHeader}>
              <FiUsers style={styles.metricIcon} />
              <span style={styles.metricLabel}>Emails Sent</span>
            </div>
            <div style={styles.metricValue}>{formatMetric(metrics.totalEmailsSent, 'number')}</div>
            <div style={styles.metricSubtext}>Total deliveries</div>
          </div>

          <div style={styles.metricCard}>
            <div style={styles.metricHeader}>
              <FiEye style={{...styles.metricIcon, color: getPerformanceColor(metrics.averageOpenRate)}} />
              <span style={styles.metricLabel}>Avg Open Rate</span>
            </div>
            <div style={{...styles.metricValue, color: getPerformanceColor(metrics.averageOpenRate)}}>
              {formatMetric(metrics.averageOpenRate, 'percentage')}
            </div>
            <div style={styles.metricSubtext}>
              {metrics.averageOpenRate >= 25 ? 'Excellent' : 
               metrics.averageOpenRate >= 15 ? 'Good' : 'Needs improvement'}
            </div>
          </div>

          <div style={styles.metricCard}>
            <div style={styles.metricHeader}>
              <FiMousePointer style={{...styles.metricIcon, color: getPerformanceColor(metrics.averageClickRate)}} />
              <span style={styles.metricLabel}>Avg Click Rate</span>
            </div>
            <div style={{...styles.metricValue, color: getPerformanceColor(metrics.averageClickRate)}}>
              {formatMetric(metrics.averageClickRate, 'percentage')}
            </div>
            <div style={styles.metricSubtext}>
              {metrics.averageClickRate >= 5 ? 'Above average' : 'Below average'}
            </div>
          </div>
        </div>

        {/* Performance Chart Placeholder */}
        <div style={styles.chartSection}>
          <h3 style={styles.chartTitle}>Campaign Performance Over Time</h3>
          <div style={styles.chartContainer}>
            <div style={styles.chartPlaceholder}>
              <FiBarChart2 style={styles.chartPlaceholderIcon} />
              <p style={styles.chartPlaceholderText}>
                Performance chart will be rendered here with actual chart library integration
              </p>
            </div>
          </div>
        </div>

        {/* Best Performing Campaign */}
        {metrics.bestPerformingCampaign && (
          <div style={styles.bestPerformingSection}>
            <h3 style={styles.sectionTitle}>
              <FiAward style={styles.sectionIcon} />
              Best Performing Campaign
            </h3>
            <div style={styles.bestPerformingCard}>
              <div style={styles.bestPerformingHeader}>
                <span style={styles.bestPerformingName}>
                  {metrics.bestPerformingCampaign.name}
                </span>
                <span style={styles.bestPerformingRate}>
                  {formatMetric(metrics.bestPerformingCampaign.performance?.click_through_rate || 0, 'percentage')} CTR
                </span>
              </div>
              <div style={styles.bestPerformingStats}>
                <div style={styles.bestPerformingStat}>
                  <span style={styles.statLabel}>Sent:</span>
                  <span style={styles.statValue}>{metrics.bestPerformingCampaign.emails_sent || 0}</span>
                </div>
                <div style={styles.bestPerformingStat}>
                  <span style={styles.statLabel}>Opens:</span>
                  <span style={styles.statValue}>{metrics.bestPerformingCampaign.performance?.views || 0}</span>
                </div>
                <div style={styles.bestPerformingStat}>
                  <span style={styles.statLabel}>Clicks:</span>
                  <span style={styles.statValue}>{metrics.bestPerformingCampaign.performance?.clicks || 0}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recommendations */}
        {dashboardData?.recommendations && dashboardData.recommendations.length > 0 && (
          <div style={styles.recommendationsSection}>
            <h3 style={styles.sectionTitle}>
              <FiTarget style={styles.sectionIcon} />
              Performance Recommendations
            </h3>
            <div style={styles.recommendationsList}>
              {dashboardData.recommendations.slice(0, 3).map((rec, index) => (
                <div key={index} style={styles.recommendationCard}>
                  <div style={styles.recommendationHeader}>
                    <span style={styles.recommendationType}>{rec.type}</span>
                    <span style={{
                      ...styles.recommendationImpact,
                      backgroundColor: rec.impact === 'high' ? '#ffebee' : '#fff3cd',
                      color: rec.impact === 'high' ? '#c62828' : '#856404'
                    }}>
                      {rec.impact} impact
                    </span>
                  </div>
                  <p style={styles.recommendationText}>{rec.suggestion}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderCampaignsTab = () => {
    return (
      <div style={styles.tabContent}>
        <div style={styles.campaignsHeader}>
          <h3 style={styles.sectionTitle}>Campaign Performance Comparison</h3>
          <div style={styles.campaignsControls}>
            <select
              value={selectedCampaign || 'all'}
              onChange={(e) => setSelectedCampaign(e.target.value === 'all' ? null : e.target.value)}
              style={styles.campaignSelect}
            >
              <option value="all">All Campaigns</option>
              {campaigns.map(campaign => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={styles.campaignsGrid}>
          {visibleCampaigns.map(campaign => (
            <div key={campaign.id} style={styles.campaignCard}>
              <div style={styles.campaignCardHeader}>
                <h4 style={styles.campaignName}>{campaign.name}</h4>
                <span style={styles.campaignDate}>
                  {formatDateShort(campaign.created_at, businessTimezone)}
                </span>
              </div>
              
              <div style={styles.campaignMetrics}>
                <div style={styles.campaignMetric}>
                  <span style={styles.campaignMetricLabel}>Sent</span>
                  <span style={styles.campaignMetricValue}>{campaign.emails_sent || 0}</span>
                </div>
                <div style={styles.campaignMetric}>
                  <span style={styles.campaignMetricLabel}>Open Rate</span>
                  <span style={{
                    ...styles.campaignMetricValue,
                    color: getPerformanceColor(campaign.performance?.view_rate || 0)
                  }}>
                    {formatMetric(campaign.performance?.view_rate || 0, 'percentage')}
                  </span>
                </div>
                <div style={styles.campaignMetric}>
                  <span style={styles.campaignMetricLabel}>Click Rate</span>
                  <span style={{
                    ...styles.campaignMetricValue,
                    color: getPerformanceColor(campaign.performance?.click_through_rate || 0)
                  }}>
                    {formatMetric(campaign.performance?.click_through_rate || 0, 'percentage')}
                  </span>
                </div>
                <div style={styles.campaignMetric}>
                  <span style={styles.campaignMetricLabel}>Conversions</span>
                  <span style={styles.campaignMetricValue}>{campaign.performance?.conversions || 0}</span>
                </div>
              </div>

              <div style={styles.campaignActions}>
                <button 
                  style={styles.campaignActionButton}
                  onClick={() => setSelectedCampaign(campaign.id)}
                >
                  <FiEye style={styles.actionIcon} />
                  View Details
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderContentTab = () => {
    return (
      <div style={styles.tabContent}>
        <h3 style={styles.sectionTitle}>Content Block Performance</h3>
        
        {contentPerformance.length === 0 ? (
          <div style={styles.emptyState}>
            <FiBarChart2 style={styles.emptyIcon} />
            <p style={styles.emptyText}>No content performance data available yet.</p>
            <p style={styles.emptySubtext}>Send some campaigns to see content analytics here.</p>
          </div>
        ) : (
          <div style={styles.contentGrid}>
            {contentPerformance.map((content, index) => (
              <div key={index} style={styles.contentCard}>
                <div style={styles.contentHeader}>
                  <span style={styles.contentType}>{content.block_id}</span>
                  <span style={styles.contentScore}>
                    {formatMetric(content.click_through_rate || 0, 'percentage')} CTR
                  </span>
                </div>
                
                <div style={styles.contentMetrics}>
                  <div style={styles.contentMetric}>
                    <FiEye style={styles.contentMetricIcon} />
                    <span>{content.views || 0} views</span>
                  </div>
                  <div style={styles.contentMetric}>
                    <FiMousePointer style={styles.contentMetricIcon} />
                    <span>{content.clicks || 0} clicks</span>
                  </div>
                  <div style={styles.contentMetric}>
                    <FiTarget style={styles.contentMetricIcon} />
                    <span>{content.conversions || 0} conversions</span>
                  </div>
                </div>

                <div style={styles.contentProgress}>
                  <div style={styles.progressBar}>
                    <div 
                      style={{
                        ...styles.progressFill,
                        width: `${Math.min(content.click_through_rate || 0, 100)}%`,
                        backgroundColor: getPerformanceColor(content.click_through_rate || 0)
                      }}
                    />
                  </div>
                  <span style={styles.progressLabel}>Performance Score</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderABTestTab = () => {
    return (
      <div style={styles.tabContent}>
        <h3 style={styles.sectionTitle}>A/B Test Results</h3>
        
        <div style={styles.emptyState}>
          <FiShare2 style={styles.emptyIcon} />
          <p style={styles.emptyText}>No A/B tests running currently.</p>
          <p style={styles.emptySubtext}>Create A/B tests to compare different campaign variations.</p>
          <button style={styles.createTestButton}>
            <FiSettings style={styles.buttonIcon} />
            Create A/B Test
          </button>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  const dashboardContent = (
    <div style={embedded ? styles.embeddedContainer : styles.modal}>
      <div style={styles.header}>
        <h2 style={styles.title}>Campaign Analytics Dashboard</h2>
        <div style={styles.headerControls}>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            style={styles.timeframeSelect}
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
          <button style={styles.refreshButton} onClick={loadDashboardData} disabled={loading}>
            <FiRefreshCw style={{ ...styles.buttonIcon, ...(loading ? { animation: 'spin 1s linear infinite' } : {}) }} />
          </button>
          <button style={styles.exportButton} onClick={exportAnalytics}>
            <FiDownload style={styles.buttonIcon} />
            Export
          </button>
          {!embedded && (
            <button style={styles.closeButton} onClick={onClose}>
              <FiX />
            </button>
          )}
        </div>
      </div>

      <div style={styles.content}>
        {/* Tab Navigation */}
        <div style={styles.tabs}>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'overview' ? styles.activeTab : {})
            }}
            onClick={() => setActiveTab('overview')}
          >
            <FiBarChart2 style={styles.tabIcon} />
            Overview
          </button>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'campaigns' ? styles.activeTab : {})
            }}
            onClick={() => setActiveTab('campaigns')}
          >
            <FiMail style={styles.tabIcon} />
            Campaigns
          </button>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'content' ? styles.activeTab : {})
            }}
            onClick={() => setActiveTab('content')}
          >
            <FiTarget style={styles.tabIcon} />
            Content
          </button>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'abtest' ? styles.activeTab : {})
            }}
            onClick={() => setActiveTab('abtest')}
          >
            <FiShare2 style={styles.tabIcon} />
            A/B Tests
          </button>
        </div>

        {/* Tab Content */}
        {loading ? (
          <div style={styles.loadingState}>
            <FiRefreshCw style={{ ...styles.loadingIcon, animation: 'spin 1s linear infinite' }} />
            <p>Loading analytics data...</p>
          </div>
        ) : (
          <>
            {activeTab === 'overview' && renderOverviewTab()}
            {activeTab === 'campaigns' && renderCampaignsTab()}
            {activeTab === 'content' && renderContentTab()}
            {activeTab === 'abtest' && renderABTestTab()}
          </>
        )}
      </div>
    </div>
  );

  if (embedded) {
    return dashboardContent;
  }

  return <div style={styles.overlay}>{dashboardContent}</div>;
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    width: '95%',
    maxWidth: '1400px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
  },
  embeddedContainer: {
    backgroundColor: 'white',
    borderRadius: '12px',
    width: '100%',
    minHeight: '700px',
    overflow: 'auto',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 30px',
    borderBottom: '1px solid #f0f0f0',
    backgroundColor: '#fafafa',
    borderRadius: '12px 12px 0 0',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
  },
  headerControls: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  timeframeSelect: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    backgroundColor: 'white',
  },
  refreshButton: {
    backgroundColor: 'white',
    color: 'teal',
    border: '2px solid teal',
    borderRadius: '6px',
    padding: '8px 12px',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  exportButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: '#666',
    padding: '5px',
  },
  buttonIcon: {
    fontSize: '16px',
  },
  content: {
    padding: '0',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #f0f0f0',
    backgroundColor: '#fafafa',
  },
  tab: {
    backgroundColor: 'transparent',
    border: 'none',
    padding: '15px 25px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#666',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
  },
  activeTab: {
    color: 'teal',
    borderBottom: '2px solid teal',
    backgroundColor: 'white',
  },
  tabIcon: {
    fontSize: '16px',
  },
  tabContent: {
    padding: '30px',
  },
  loadingState: {
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
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '20px',
    marginBottom: '40px',
  },
  metricCard: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
  },
  metricHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '10px',
  },
  metricIcon: {
    fontSize: '20px',
    color: 'teal',
  },
  metricLabel: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#666',
  },
  metricValue: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '5px',
  },
  metricSubtext: {
    fontSize: '12px',
    color: '#999',
  },
  chartSection: {
    marginBottom: '40px',
  },
  chartTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '15px',
  },
  chartContainer: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '20px',
    height: '300px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartPlaceholder: {
    textAlign: 'center',
    color: '#666',
  },
  chartPlaceholderIcon: {
    fontSize: '48px',
    marginBottom: '10px',
    color: '#ccc',
  },
  chartPlaceholderText: {
    fontSize: '14px',
    margin: 0,
  },
  bestPerformingSection: {
    marginBottom: '40px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '15px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sectionIcon: {
    fontSize: '20px',
    color: 'teal',
  },
  bestPerformingCard: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '20px',
  },
  bestPerformingHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px',
  },
  bestPerformingName: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
  },
  bestPerformingRate: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#4caf50',
  },
  bestPerformingStats: {
    display: 'flex',
    gap: '30px',
  },
  bestPerformingStat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statLabel: {
    fontSize: '12px',
    color: '#666',
    fontWeight: 'bold',
  },
  statValue: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
  },
  recommendationsSection: {
    marginBottom: '40px',
  },
  recommendationsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  recommendationCard: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '15px',
  },
  recommendationHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  recommendationType: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: 'teal',
    textTransform: 'uppercase',
  },
  recommendationImpact: {
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 'bold',
    textTransform: 'capitalize',
  },
  recommendationText: {
    fontSize: '14px',
    color: '#333',
    margin: 0,
    lineHeight: '1.4',
  },
  campaignsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  campaignsControls: {
    display: 'flex',
    gap: '10px',
  },
  campaignSelect: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    backgroundColor: 'white',
  },
  campaignsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
    gap: '20px',
  },
  campaignCard: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '20px',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
  },
  campaignCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px',
  },
  campaignName: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
  },
  campaignDate: {
    fontSize: '12px',
    color: '#666',
  },
  campaignMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '10px',
    marginBottom: '15px',
  },
  campaignMetric: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  campaignMetricLabel: {
    fontSize: '12px',
    color: '#666',
    fontWeight: 'bold',
  },
  campaignMetricValue: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
  },
  campaignActions: {
    display: 'flex',
    gap: '8px',
  },
  campaignActionButton: {
    backgroundColor: 'white',
    color: 'teal',
    border: '2px solid teal',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s ease',
  },
  actionIcon: {
    fontSize: '14px',
  },
  contentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
  },
  contentCard: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '20px',
  },
  contentHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px',
  },
  contentType: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  contentScore: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'teal',
  },
  contentMetrics: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '15px',
  },
  contentMetric: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    color: '#666',
  },
  contentMetricIcon: {
    fontSize: '14px',
    color: 'teal',
  },
  contentProgress: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  progressBar: {
    width: '100%',
    height: '8px',
    backgroundColor: '#f0f0f0',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  progressLabel: {
    fontSize: '11px',
    color: '#999',
    textAlign: 'center',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
    textAlign: 'center',
    color: '#666',
  },
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '20px',
    color: '#ccc',
  },
  emptyText: {
    fontSize: '18px',
    fontWeight: 'bold',
    marginBottom: '10px',
  },
  emptySubtext: {
    fontSize: '14px',
    marginBottom: '20px',
  },
  createTestButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
};

export default CampaignAnalyticsDashboard;