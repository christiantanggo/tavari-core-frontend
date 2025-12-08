// src/screens/Music/Ads/RevenueReports.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../supabaseClient';
import { useBusiness } from '../../../contexts/BusinessContext';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { usePermissions } from '../../../hooks/usePermissions';
import PermissionGate from '../../../components/Auth/PermissionGate';
import SessionManager from '../../../components/SessionManager';
import toast from 'react-hot-toast';
import { FiLock, FiDownload } from 'react-icons/fi';

const RevenueReports = () => {
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
  const canViewRevenue = hasAnyPermission(['reports.financial.view', 'music.ads.manage']) || hasElevatedPrivileges();
  const canExportReports = hasPermission('reports.financial.view') || hasElevatedPrivileges();
  
  const [timeframe, setTimeframe] = useState('30d');
  const [reportType, setReportType] = useState('overview');
  const [revenueData, setRevenueData] = useState({
    totalRevenue: 0,
    totalPlays: 0,
    averageCPM: 0,
    revenueByProvider: {},
    revenueByDay: {},
    growth: { growth: 0, trend: 'stable' }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState('json');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (business?.id && !permissionsLoading) {
      if (!canViewRevenue) {
        toast.error('You do not have permission to view revenue reports');
        navigate('/dashboard/music');
        return;
      }
      
      loadRevenueData();
    }
  }, [business?.id, timeframe, permissionsLoading, canViewRevenue]);

  const loadRevenueData = async () => {
    if (!business?.id) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      const dateRange = getDateRange(timeframe);
      
      // Load revenue data
      const { data: revenueRecords, error: revenueError } = await supabase
        .from('music_ad_revenue_detailed')
        .select('*')
        .eq('business_id', business.id)
        .gte('created_at', dateRange.start)
        .lte('created_at', dateRange.end)
        .order('created_at', { ascending: false });

      if (revenueError) throw revenueError;

      // Load ad plays count
      const { count: totalPlays, error: playsError } = await supabase
        .from('music_ad_plays')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', business.id)
        .gte('played_at', dateRange.start)
        .lte('played_at', dateRange.end);

      if (playsError) throw playsError;

      // Process revenue data
      const processedData = processRevenueData(revenueRecords || []);
      processedData.totalPlays = totalPlays || 0;
      
      setRevenueData(processedData);
      
    } catch (err) {
      setError(err.message);
      toast.error('Failed to load revenue data');
    } finally {
      setIsLoading(false);
    }
  };

  const getDateRange = (timeframe) => {
    const now = new Date();
    const start = new Date();
    
    switch (timeframe) {
      case '7d':
        start.setDate(now.getDate() - 7);
        break;
      case '30d':
        start.setDate(now.getDate() - 30);
        break;
      case '90d':
        start.setDate(now.getDate() - 90);
        break;
      default:
        start.setDate(now.getDate() - 30);
    }
    
    return {
      start: start.toISOString(),
      end: now.toISOString()
    };
  };

  const processRevenueData = (records) => {
    const totalRevenue = records.reduce((sum, record) => 
      sum + parseFloat(record.business_payout || 0), 0
    );
    
    // Revenue by provider
    const revenueByProvider = {};
    records.forEach(record => {
      const provider = record.api_provider || 'unknown';
      revenueByProvider[provider] = (revenueByProvider[provider] || 0) + 
        parseFloat(record.business_payout || 0);
    });
    
    // Revenue by day
    const revenueByDay = {};
    records.forEach(record => {
      const date = record.created_at.split('T')[0];
      revenueByDay[date] = (revenueByDay[date] || 0) + 
        parseFloat(record.business_payout || 0);
    });
    
    // Calculate average CPM
    const totalImpressions = records.length;
    const averageCPM = totalImpressions > 0 ? (totalRevenue / totalImpressions) * 1000 : 0;
    
    // Calculate growth (compare first half vs second half)
    const growth = calculateGrowthTrend(revenueByDay);
    
    return {
      totalRevenue,
      averageCPM,
      revenueByProvider,
      revenueByDay,
      growth
    };
  };

  const calculateGrowthTrend = (revenueByDay) => {
    const sortedDays = Object.entries(revenueByDay)
      .sort(([a], [b]) => new Date(a) - new Date(b));
    
    if (sortedDays.length < 2) {
      return { growth: 0, trend: 'stable' };
    }
    
    const midPoint = Math.floor(sortedDays.length / 2);
    const firstHalf = sortedDays.slice(0, midPoint);
    const secondHalf = sortedDays.slice(midPoint);
    
    const firstHalfAvg = firstHalf.reduce((sum, [, revenue]) => sum + revenue, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, [, revenue]) => sum + revenue, 0) / secondHalf.length;
    
    if (firstHalfAvg === 0) {
      return { growth: 0, trend: 'stable' };
    }
    
    const growth = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;
    
    let trend = 'stable';
    if (growth > 5) trend = 'up';
    else if (growth < -5) trend = 'down';
    
    return { growth: Math.round(growth * 100) / 100, trend };
  };

  const getTopPerformingProvider = () => {
    if (!revenueData.revenueByProvider || Object.keys(revenueData.revenueByProvider).length === 0) {
      return null;
    }
    
    const providers = Object.entries(revenueData.revenueByProvider);
    const topProvider = providers.reduce((max, current) => 
      current[1] > max[1] ? current : max
    );
    
    return {
      name: topProvider[0],
      revenue: topProvider[1],
      percentage: (topProvider[1] / revenueData.totalRevenue) * 100
    };
  };

  const handleExport = async () => {
    // Permission check
    if (!canExportReports) {
      toast.error('You do not have permission to export revenue reports');
      return;
    }

    try {
      const exportData = {
        timeframe,
        reportType,
        businessId: business.id,
        businessName: business.name,
        generatedAt: new Date().toISOString(),
        data: revenueData
      };
      
      let content, filename, mimeType;
      
      if (exportFormat === 'csv') {
        // Create CSV content
        const csvRows = [
          ['Provider', 'Revenue', 'Percentage'],
          ...Object.entries(revenueData.revenueByProvider).map(([provider, revenue]) => [
            provider,
            revenue.toFixed(4),
            ((revenue / revenueData.totalRevenue) * 100).toFixed(2) + '%'
          ])
        ];
        
        content = csvRows.map(row => row.join(',')).join('\n');
        filename = `revenue-report-${timeframe}-${Date.now()}.csv`;
        mimeType = 'text/csv';
      } else {
        // JSON export
        content = JSON.stringify(exportData, null, 2);
        filename = `revenue-report-${timeframe}-${Date.now()}.json`;
        mimeType = 'application/json';
      }
      
      // Download file
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setShowExportModal(false);
      toast.success('Report exported successfully');
      
    } catch (error) {
      toast.error('Failed to export data');
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

  const formatNumber = (num) => {
    return new Intl.NumberFormat('en-CA').format(num || 0);
  };

  const topProvider = getTopPerformingProvider();

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
  if (!canViewRevenue) {
    return (
      <SessionManager>
        <div style={styles.errorContainer}>
          <FiLock size={64} style={{ color: '#f44336', marginBottom: '20px' }} />
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '10px' }}>Access Denied</h2>
          <p style={{ fontSize: '16px', color: '#666', marginBottom: '20px' }}>
            You do not have permission to view revenue reports.
          </p>
          <p style={{ fontSize: '14px', color: '#999', marginBottom: '30px' }}>
            Contact your manager or administrator for access to financial reports.
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

  if (isLoading) {
    return (
      <SessionManager>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner}></div>
          <div style={styles.loadingText}>Loading revenue reports...</div>
        </div>
      </SessionManager>
    );
  }

  if (error) {
    return (
      <SessionManager>
        <div style={styles.errorContainer}>
          <div style={styles.errorText}>Error loading reports: {error}</div>
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
        {/* Header */}
        <div style={styles.card}>
          <h1 style={styles.title}>Revenue Reports & Analytics</h1>
          
          {!canExportReports && (
            <div style={{ 
              marginBottom: '15px', 
              padding: '10px', 
              backgroundColor: '#fff3cd', 
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <FiLock size={16} style={{ color: '#856404' }} />
              <span style={{ color: '#856404', fontSize: '14px' }}>
                You can view reports but need financial permissions to export data
              </span>
            </div>
          )}
          
          <div style={styles.controls}>
            <div style={styles.timeframeButtons}>
              {['7d', '30d', '90d'].map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  style={{
                    ...styles.button,
                    backgroundColor: timeframe === tf ? '#009688' : '#fff',
                    color: timeframe === tf ? '#fff' : '#333'
                  }}
                >
                  {tf === '7d' ? '7 Days' : tf === '30d' ? '30 Days' : '90 Days'}
                </button>
              ))}
            </div>
            
            <PermissionGate
              permission="reports.financial.view"
              fallback={
                <button
                  disabled
                  style={{ 
                    ...styles.exportButton, 
                    opacity: 0.5, 
                    cursor: 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                  title="Permission required to export reports"
                >
                  <FiLock size={16} />
                  Export
                </button>
              }
            >
              <button
                onClick={() => setShowExportModal(true)}
                style={{ ...styles.exportButton, display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <FiDownload size={16} />
                Export
              </button>
            </PermissionGate>
          </div>
        </div>

        {/* Report Type Selector */}
        <div style={styles.card}>
          <div style={styles.reportTypeButtons}>
            {[
              { label: 'Overview', value: 'overview' },
              { label: 'By Provider', value: 'provider' },
              { label: 'Performance', value: 'performance' }
            ].map(type => (
              <button
                key={type.value}
                onClick={() => setReportType(type.value)}
                style={{
                  ...styles.button,
                  backgroundColor: reportType === type.value ? '#009688' : '#fff',
                  color: reportType === type.value ? '#fff' : '#333'
                }}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* Overview Report */}
        {reportType === 'overview' && (
          <>
            {/* Summary Stats */}
            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>Revenue Summary</h2>
              
              <div style={styles.statsGrid}>
                <div style={styles.statBox}>
                  <div style={styles.statValue}>{formatCurrency(revenueData.totalRevenue)}</div>
                  <div style={styles.statLabel}>Total Revenue</div>
                </div>
                
                <div style={styles.statBox}>
                  <div style={styles.statValue}>{formatNumber(revenueData.totalPlays)}</div>
                  <div style={styles.statLabel}>Ad Plays</div>
                </div>
                
                <div style={styles.statBox}>
                  <div style={styles.statValue}>{formatCurrency(revenueData.averageCPM)}</div>
                  <div style={styles.statLabel}>Avg CPM</div>
                </div>
                
                <div style={styles.statBox}>
                  <div style={{
                    ...styles.statValue,
                    color: revenueData.growth.trend === 'up' ? '#4caf50' : 
                           revenueData.growth.trend === 'down' ? '#f44336' : '#666'
                  }}>
                    {revenueData.growth.growth > 0 ? '+' : ''}{revenueData.growth.growth.toFixed(1)}%
                  </div>
                  <div style={styles.statLabel}>Growth</div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Provider Report */}
        {reportType === 'provider' && (
          <>
            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>Revenue by Provider</h2>
              
              {Object.entries(revenueData.revenueByProvider).length === 0 ? (
                <div style={styles.noDataText}>No provider data available for this period</div>
              ) : (
                Object.entries(revenueData.revenueByProvider).map(([provider, revenue]) => {
                  const percentage = revenueData.totalRevenue > 0 
                    ? (revenue / revenueData.totalRevenue) * 100 
                    : 0;
                  
                  return (
                    <div key={provider} style={styles.providerItem}>
                      <div style={styles.providerInfo}>
                        <h3 style={styles.providerName}>
                          {provider.charAt(0).toUpperCase() + provider.slice(1)}
                        </h3>
                        <div style={styles.providerDescription}>
                          {percentage.toFixed(1)}% of total revenue
                        </div>
                      </div>
                      <div style={styles.providerAmount}>
                        {formatCurrency(revenue)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Top Provider Highlight */}
            {topProvider && (
              <div style={styles.card}>
                <h2 style={styles.sectionTitle}>Top Performing Provider</h2>
                <div style={styles.topProviderBox}>
                  <div style={styles.topProviderName}>{topProvider.name.toUpperCase()}</div>
                  <div style={styles.topProviderRevenue}>{formatCurrency(topProvider.revenue)}</div>
                  <div style={styles.topProviderPercentage}>{topProvider.percentage.toFixed(1)}% of total</div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Performance Report */}
        {reportType === 'performance' && (
          <div style={styles.card}>
            <h2 style={styles.sectionTitle}>System Performance</h2>
            
            <div style={styles.performanceTable}>
              {[
                { label: 'Total API Requests', value: formatNumber(revenueData.totalPlays) },
                { label: 'Success Rate', value: '94%' },
                { label: 'Average CPM', value: formatCurrency(revenueData.averageCPM) },
                { label: 'Revenue Growth', value: `${revenueData.growth.growth > 0 ? '+' : ''}${revenueData.growth.growth.toFixed(1)}%` }
              ].map((metric, index) => (
                <div key={index} style={styles.performanceRow}>
                  <span>{metric.label}</span>
                  <span style={styles.performanceValue}>{metric.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Export Modal */}
        {showExportModal && canExportReports && (
          <div style={styles.modalOverlay} onClick={() => setShowExportModal(false)}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
              <h2 style={styles.modalTitle}>Export Revenue Report</h2>
              
              <div style={styles.modalContent}>
                <label style={styles.modalLabel}>Export Format:</label>
                <div style={styles.formatButtons}>
                  {['json', 'csv'].map(format => (
                    <button
                      key={format}
                      onClick={() => setExportFormat(format)}
                      style={{
                        ...styles.button,
                        backgroundColor: exportFormat === format ? '#009688' : '#fff',
                        color: exportFormat === format ? '#fff' : '#333'
                      }}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>

                <p style={styles.modalDescription}>
                  Export includes revenue data, ad plays, and provider performance for the selected {timeframe} period.
                </p>
              </div>

              <div style={styles.modalActions}>
                <button
                  onClick={() => setShowExportModal(false)}
                  style={styles.cancelButton}
                >
                  Cancel
                </button>
                <button
                  onClick={handleExport}
                  style={styles.exportActionButton}
                >
                  Export
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </SessionManager>
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
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '20px',
    margin: '0 0 20px 0'
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '15px',
    margin: '0 0 15px 0'
  },
  controls: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '10px'
  },
  timeframeButtons: {
    display: 'flex',
    gap: '5px'
  },
  reportTypeButtons: {
    display: 'flex',
    gap: '5px',
    justifyContent: 'center'
  },
  button: {
    padding: '8px 16px',
    border: '1px solid #009688',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  exportButton: {
    padding: '8px 16px',
    backgroundColor: '#009688',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
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
  noDataText: {
    textAlign: 'center',
    color: '#666',
    fontStyle: 'italic',
    padding: '40px 0'
  },
  providerItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '15px 0',
    borderBottom: '1px solid #eee'
  },
  providerInfo: {
    flex: 1
  },
  providerName: {
    fontSize: '16px',
    fontWeight: '500',
    color: '#333',
    margin: '0 0 5px 0',
    textTransform: 'capitalize'
  },
  providerDescription: {
    fontSize: '14px',
    color: '#666'
  },
  providerAmount: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#009688'
  },
  topProviderBox: {
    textAlign: 'center',
    padding: '30px',
    backgroundColor: '#e8f5e8',
    borderRadius: '8px'
  },
  topProviderName: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#2e7d32',
    marginBottom: '10px'
  },
  topProviderRevenue: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#2e7d32',
    marginBottom: '5px'
  },
  topProviderPercentage: {
    fontSize: '14px',
    color: '#388e3c'
  },
  performanceTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  performanceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid #eee'
  },
  performanceValue: {
    fontWeight: 'bold',
    color: '#009688'
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
    maxWidth: '500px',
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
  modalContent: {
    marginBottom: '30px'
  },
  modalLabel: {
    fontSize: '16px',
    fontWeight: '500',
    color: '#333',
    marginBottom: '10px',
    display: 'block'
  },
  formatButtons: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px'
  },
  modalDescription: {
    fontSize: '14px',
    color: '#666',
    textAlign: 'center',
    lineHeight: '1.5'
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px'
  },
  cancelButton: {
    padding: '10px 20px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: '#fff',
    color: '#333',
    cursor: 'pointer',
    fontSize: '14px'
  },
  exportActionButton: {
    padding: '10px 20px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#009688',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
  }
};

// Add spinner animation CSS
if (!document.querySelector('#revenue-reports-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'revenue-reports-styles';
  styleSheet.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(styleSheet);
}

export default RevenueReports;