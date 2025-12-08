// screens/Mail/SendLogsScreen.jsx - WITH PERMISSION SYSTEM INTEGRATION
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import EmailPauseBanner from '../../components/EmailPauseBanner';
import toast from 'react-hot-toast';
import {
  FiSearch, FiFilter, FiDownload, FiRefreshCw, FiAlertTriangle, 
  FiCheckCircle, FiClock, FiX, FiMail, FiEye, FiCalendar, FiFileText, FiLock
} from 'react-icons/fi';

const SendLogsScreen = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  
  // Permission system integration
  const { 
    hasPermission, 
    hasAnyPermission,
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  const [logs, setLogs] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    status: 'all', // all, sent, failed, pending, bounced
    campaignId: 'all',
    dateRange: '7d', // 1d, 7d, 30d, all
    messageId: ''
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalLogs, setTotalLogs] = useState(0);
  const [selectedLog, setSelectedLog] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    bounced: 0
  });

  const businessId = business?.id;

  // Permission checks based on permissionRegistry.js
  const canViewLogs = hasAnyPermission([
    'mail.campaigns.view',
    'reports.export'
  ]) || hasElevatedPrivileges();

  const canViewCampaigns = hasPermission('mail.campaigns.view') || hasElevatedPrivileges();
  const canExportData = hasPermission('reports.export') || hasElevatedPrivileges();
  const canViewDetails = hasPermission('mail.campaigns.view') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewLogs) {
      toast.error('You do not have permission to view send logs');
      navigate('/dashboard/mail/dashboard');
    }
  }, [permissionsLoading, canViewLogs, navigate]);

  // Load campaigns for filter dropdown
  const loadCampaigns = useCallback(async () => {
    if (!businessId) return;
    
    // Check permission before loading
    if (!canViewCampaigns) {
      console.warn('User does not have permission to view campaigns');
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('mail_campaigns')
        .select('id, name, status, created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCampaigns(data || []);
    } catch (error) {
      console.error('Error loading campaigns:', error);
      toast.error('Failed to load campaigns');
    }
  }, [businessId, canViewCampaigns]);

  // Load send logs with filters
  const loadSendLogs = useCallback(async () => {
    if (!businessId) return;
    
    // Check permission before loading
    if (!canViewLogs) {
      toast.error('You do not have permission to view send logs');
      return;
    }
    
    try {
      setLoading(true);
      
      let query = supabase
        .from('mail_campaign_sends')
        .select(`
          *,
          campaign:mail_campaigns(id, name, subject_line),
          contact:mail_contacts(id, first_name, last_name, email)
        `);

      // Add business filter through campaign
      query = query.in('campaign_id', 
        campaigns.length > 0 ? campaigns.map(c => c.id) : ['']
      );

      // Apply status filter
      if (filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      // Apply campaign filter
      if (filters.campaignId !== 'all') {
        query = query.eq('campaign_id', filters.campaignId);
      }

      // Apply date range filter
      if (filters.dateRange !== 'all') {
        const now = new Date();
        let startDate;
        
        switch (filters.dateRange) {
          case '1d':
            startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
          case '7d':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case '30d':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          default:
            startDate = null;
        }
        
        if (startDate) {
          query = query.gte('created_at', startDate.toISOString());
        }
      }

      // Apply message ID filter
      if (filters.messageId.trim()) {
        query = query.ilike('ses_message_id', `%${filters.messageId.trim()}%`);
      }

      // Apply search filter
      if (searchTerm.trim()) {
        query = query.ilike('email_address', `%${searchTerm.trim()}%`);
      }

      // Get total count for pagination
      const countQuery = await query;
      setTotalLogs(countQuery.data?.length || 0);

      // Apply pagination and ordering
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

      if (error) throw error;
      setLogs(data || []);

      // Load stats
      await loadStats();
    } catch (error) {
      console.error('Error loading send logs:', error);
      toast.error('Failed to load send logs');
    } finally {
      setLoading(false);
    }
  }, [businessId, campaigns, filters, searchTerm, currentPage, pageSize, canViewLogs]);

  // Load summary statistics
  const loadStats = useCallback(async () => {
    if (!businessId || campaigns.length === 0) return;
    
    try {
      const { data, error } = await supabase
        .from('mail_campaign_sends')
        .select('status')
        .in('campaign_id', campaigns.map(c => c.id));

      if (error) throw error;

      const stats = {
        total: data?.length || 0,
        sent: data?.filter(l => l.status === 'sent').length || 0,
        failed: data?.filter(l => l.status === 'failed').length || 0,
        pending: data?.filter(l => l.status === 'pending').length || 0,
        bounced: data?.filter(l => l.status === 'bounced').length || 0
      };

      setStats(stats);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }, [businessId, campaigns]);

  // Load data when business or filters change
  useEffect(() => {
    if (businessId && !permissionsLoading) {
      loadCampaigns();
    }
  }, [businessId, permissionsLoading, loadCampaigns]);

  useEffect(() => {
    if (campaigns.length > 0 && !permissionsLoading) {
      loadSendLogs();
    }
  }, [campaigns, permissionsLoading, loadSendLogs]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, searchTerm]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleExportLogs = async () => {
    // Permission check
    if (!canExportData) {
      toast.error('You do not have permission to export data');
      return;
    }

    try {
      // Export current filtered results
      const csvRows = [
        [
          'Email', 'Campaign', 'Status', 'Sent At', 'Error Message', 
          'Retry Count', 'SES Message ID', 'Contact Name'
        ]
      ];

      logs.forEach(log => {
        csvRows.push([
          log.email_address || '',
          log.campaign?.name || '',
          log.status || '',
          log.sent_at ? new Date(log.sent_at).toLocaleString() : '',
          log.error_message || '',
          log.retry_count || 0,
          log.ses_message_id || '',
          `${log.contact?.first_name || ''} ${log.contact?.last_name || ''}`.trim()
        ]);
      });

      const csvContent = csvRows.map(row => 
        row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
      ).join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `send_logs_${filters.dateRange}_${Date.now()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      toast.success('Send logs exported successfully');
    } catch (error) {
      console.error('Error exporting logs:', error);
      toast.error('Failed to export logs. Please try again.');
    }
  };

  const handleViewDetails = (log) => {
    // Permission check
    if (!canViewDetails) {
      toast.error('You do not have permission to view log details');
      return;
    }

    setSelectedLog(log);
    setShowDetails(true);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'sent': return <FiCheckCircle style={{ color: '#4caf50' }} />;
      case 'failed': return <FiAlertTriangle style={{ color: '#f44336' }} />;
      case 'pending': return <FiClock style={{ color: '#ff9800' }} />;
      case 'bounced': return <FiX style={{ color: '#f44336' }} />;
      default: return <FiMail style={{ color: '#666' }} />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'sent': return '#4caf50';
      case 'failed': return '#f44336';
      case 'pending': return '#ff9800';
      case 'bounced': return '#f44336';
      default: return '#666';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Not sent';
    return new Date(dateString).toLocaleString();
  };

  const totalPages = Math.ceil(totalLogs / pageSize);

  // Show loading while permissions are being checked
  if (permissionsLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <FiRefreshCw style={{...styles.loadingIcon, animation: 'spin 1s linear infinite'}} />
          <div>Loading permissions...</div>
        </div>
      </div>
    );
  }

  // Show access denied if no permission
  if (!canViewLogs) {
    return (
      <div style={styles.container}>
        <div style={styles.accessDenied}>
          <FiLock style={styles.accessDeniedIcon} />
          <h2 style={styles.accessDeniedTitle}>Access Denied</h2>
          <p style={styles.accessDeniedText}>
            You do not have permission to view send logs.
          </p>
          <p style={styles.accessDeniedSubtext}>
            Contact your administrator to request access.
          </p>
          <button 
            style={styles.backButton}
            onClick={() => navigate('/dashboard/mail/dashboard')}
          >
            Back to Mail Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Email Pause Banner */}
      <EmailPauseBanner 
        customMessage="Email sending is paused. Send logs show historical data only."
      />

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>Send Logs</h1>
          <p style={styles.subtitle}>Complete history of email sending activity</p>
        </div>
        <div style={styles.headerActions}>
          <button style={styles.secondaryButton} onClick={loadSendLogs}>
            <FiRefreshCw style={styles.buttonIcon} />
            Refresh
          </button>
          
          {/* Export button - protected by permission */}
          <PermissionGate 
            permission="reports.export"
            fallback={
              <button 
                style={{...styles.secondaryButton, ...styles.disabledButton}}
                disabled
                title="You don't have permission to export data"
              >
                <FiLock style={styles.buttonIcon} />
                Export CSV
              </button>
            }
          >
            <button style={styles.secondaryButton} onClick={handleExportLogs}>
              <FiDownload style={styles.buttonIcon} />
              Export CSV
            </button>
          </PermissionGate>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <FiMail style={styles.statIcon} />
          <div>
            <div style={styles.statNumber}>{stats.total.toLocaleString()}</div>
            <div style={styles.statLabel}>Total Sends</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <FiCheckCircle style={{...styles.statIcon, color: '#4caf50'}} />
          <div>
            <div style={styles.statNumber}>{stats.sent.toLocaleString()}</div>
            <div style={styles.statLabel}>Successful</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <FiAlertTriangle style={{...styles.statIcon, color: '#f44336'}} />
          <div>
            <div style={styles.statNumber}>{stats.failed.toLocaleString()}</div>
            <div style={styles.statLabel}>Failed</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <FiClock style={{...styles.statIcon, color: '#ff9800'}} />
          <div>
            <div style={styles.statNumber}>{stats.pending.toLocaleString()}</div>
            <div style={styles.statLabel}>Pending</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={styles.filtersPanel}>
        <div style={styles.searchContainer}>
          <FiSearch style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search by email address..."
            style={styles.searchInput}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div style={styles.filtersContainer}>
          <select 
            style={styles.filterSelect}
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
            <option value="bounced">Bounced</option>
          </select>
          
          <select 
            style={styles.filterSelect}
            value={filters.campaignId}
            onChange={(e) => handleFilterChange('campaignId', e.target.value)}
            disabled={!canViewCampaigns}
          >
            <option value="all">All Campaigns</option>
            {campaigns.map(campaign => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>

          <select 
            style={styles.filterSelect}
            value={filters.dateRange}
            onChange={(e) => handleFilterChange('dateRange', e.target.value)}
          >
            <option value="1d">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>

          <input
            type="text"
            placeholder="SES Message ID..."
            style={styles.messageIdInput}
            value={filters.messageId}
            onChange={(e) => handleFilterChange('messageId', e.target.value)}
          />
        </div>
      </div>

      {/* Logs Table */}
      {loading ? (
        <div style={styles.loading}>
          <FiRefreshCw style={{...styles.loadingIcon, animation: 'spin 1s linear infinite'}} />
          <div>Loading send logs...</div>
        </div>
      ) : logs.length === 0 ? (
        <div style={styles.emptyState}>
          <FiFileText style={styles.emptyIcon} />
          <h3 style={styles.emptyTitle}>No send logs found</h3>
          <p style={styles.emptyText}>
            {searchTerm || filters.status !== 'all' || filters.campaignId !== 'all' 
              ? 'Try adjusting your search or filters.' 
              : 'Send logs will appear here after campaigns are sent.'}
          </p>
        </div>
      ) : (
        <>
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.tableHeader}>
                  <th style={styles.tableHeaderCell}>Status</th>
                  <th style={styles.tableHeaderCell}>Email</th>
                  <th style={styles.tableHeaderCell}>Campaign</th>
                  <th style={styles.tableHeaderCell}>Sent At</th>
                  <th style={styles.tableHeaderCell}>Retries</th>
                  <th style={styles.tableHeaderCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} style={styles.tableRow}>
                    <td style={styles.statusColumn}>
                      <div style={styles.statusBadge}>
                        {getStatusIcon(log.status)}
                        <span style={{color: getStatusColor(log.status)}}>
                          {log.status}
                        </span>
                      </div>
                    </td>
                    <td style={styles.emailColumn}>
                      <div style={styles.emailInfo}>
                        <div style={styles.emailAddress}>{log.email_address}</div>
                        {log.contact && (
                          <div style={styles.contactName}>
                            {log.contact.first_name} {log.contact.last_name}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={styles.campaignColumn}>
                      <div style={styles.campaignName}>
                        {log.campaign?.name || 'Unknown Campaign'}
                      </div>
                    </td>
                    <td style={styles.dateColumn}>
                      {formatDate(log.sent_at)}
                    </td>
                    <td style={styles.retryColumn}>
                      {log.retry_count > 0 && (
                        <span style={styles.retryBadge}>
                          {log.retry_count} retries
                        </span>
                      )}
                    </td>
                    <td style={styles.actionsColumn}>
                      {/* View Details button - protected by permission */}
                      <PermissionGate 
                        permission="mail.campaigns.view"
                        fallback={
                          <button 
                            style={{...styles.actionButton, ...styles.disabledActionButton}}
                            disabled
                            title="You don't have permission to view details"
                          >
                            <FiLock />
                          </button>
                        }
                      >
                        <button 
                          style={styles.actionButton}
                          onClick={() => handleViewDetails(log)}
                          title="View Details"
                        >
                          <FiEye />
                        </button>
                      </PermissionGate>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={styles.pagination}>
            <div style={styles.paginationInfo}>
              Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalLogs)} of {totalLogs} logs
            </div>
            <div style={styles.paginationControls}>
              <button 
                style={{
                  ...styles.paginationButton,
                  ...(currentPage === 1 ? styles.disabledButton : {})
                }}
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(currentPage - 1)}
              >
                Previous
              </button>
              <span style={styles.pageInfo}>Page {currentPage} of {totalPages}</span>
              <button 
                style={{
                  ...styles.paginationButton,
                  ...(currentPage === totalPages ? styles.disabledButton : {})
                }}
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
            <div style={styles.pageSizeSelector}>
              <select 
                value={pageSize} 
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={styles.pageSizeSelect}
              >
                <option value={25}>25 per page</option>
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
              </select>
            </div>
          </div>
        </>
      )}

      {/* Details Modal */}
      {showDetails && selectedLog && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Send Log Details</h2>
              <button 
                style={styles.closeButton}
                onClick={() => setShowDetails(false)}
              >
                <FiX />
              </button>
            </div>
            <div style={styles.modalContent}>
              <div style={styles.detailsGrid}>
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>Status:</span>
                  <span style={{...styles.detailValue, color: getStatusColor(selectedLog.status)}}>
                    {selectedLog.status}
                  </span>
                </div>
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>Email:</span>
                  <span style={styles.detailValue}>{selectedLog.email_address}</span>
                </div>
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>Campaign:</span>
                  <span style={styles.detailValue}>{selectedLog.campaign?.name}</span>
                </div>
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>Subject:</span>
                  <span style={styles.detailValue}>{selectedLog.campaign?.subject_line}</span>
                </div>
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>Sent At:</span>
                  <span style={styles.detailValue}>{formatDate(selectedLog.sent_at)}</span>
                </div>
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>Retry Count:</span>
                  <span style={styles.detailValue}>{selectedLog.retry_count}</span>
                </div>
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>SES Message ID:</span>
                  <span style={styles.detailValue}>{selectedLog.ses_message_id || 'N/A'}</span>
                </div>
                {selectedLog.error_message && (
                  <div style={styles.detailItem}>
                    <span style={styles.detailLabel}>Error:</span>
                    <span style={{...styles.detailValue, color: '#f44336'}}>
                      {selectedLog.error_message}
                    </span>
                  </div>
                )}
                {selectedLog.contact && (
                  <div style={styles.detailItem}>
                    <span style={styles.detailLabel}>Contact:</span>
                    <span style={styles.detailValue}>
                      {selectedLog.contact.first_name} {selectedLog.contact.last_name}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
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
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '30px',
  },
  headerLeft: {
    flex: 1,
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
  headerActions: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: 'white',
    color: 'teal',
    border: '2px solid teal',
    borderRadius: '8px',
    padding: '10px 18px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.3s ease',
  },
  buttonIcon: {
    fontSize: '14px',
  },
  disabledButton: {
    opacity: 0.5,
    cursor: 'not-allowed',
    backgroundColor: '#f5f5f5',
    color: '#999',
    borderColor: '#ddd',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '20px',
    marginBottom: '30px',
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
  statIcon: {
    fontSize: '24px',
    color: 'teal',
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
  filtersPanel: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #ddd',
    marginBottom: '20px',
  },
  searchContainer: {
    position: 'relative',
    marginBottom: '20px',
  },
  searchIcon: {
    position: 'absolute',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#666',
    fontSize: '16px',
  },
  searchInput: {
    width: '100%',
    padding: '10px 12px 10px 40px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '6px',
  },
  filtersContainer: {
    display: 'flex',
    gap: '15px',
    flexWrap: 'wrap',
  },
  filterSelect: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    backgroundColor: 'white',
  },
  messageIdInput: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    minWidth: '200px',
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
  },
  accessDenied: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px 20px',
    textAlign: 'center',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
    marginTop: '40px',
  },
  accessDeniedIcon: {
    fontSize: '64px',
    color: '#f44336',
    marginBottom: '20px',
  },
  accessDeniedTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '10px',
  },
  accessDeniedText: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '8px',
  },
  accessDeniedSubtext: {
    fontSize: '14px',
    color: '#999',
    marginBottom: '30px',
  },
  backButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
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
  emptyTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    marginBottom: '10px',
  },
  emptyText: {
    fontSize: '14px',
    maxWidth: '400px',
  },
  tableContainer: {
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
    overflow: 'hidden',
    marginBottom: '20px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tableHeader: {
    backgroundColor: '#f8f8f8',
  },
  tableHeaderCell: {
    padding: '15px',
    textAlign: 'left',
    fontWeight: 'bold',
    color: '#333',
    borderBottom: '1px solid #ddd',
  },
  tableRow: {
    borderBottom: '1px solid #f0f0f0',
  },
  statusColumn: {
    padding: '15px',
    width: '120px',
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  emailColumn: {
    padding: '15px',
  },
  emailInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  emailAddress: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  contactName: {
    fontSize: '12px',
    color: '#666',
  },
  campaignColumn: {
    padding: '15px',
  },
  campaignName: {
    fontSize: '14px',
    color: '#333',
  },
  dateColumn: {
    padding: '15px',
    fontSize: '14px',
    color: '#666',
  },
  retryColumn: {
    padding: '15px',
  },
  retryBadge: {
    backgroundColor: '#fff3cd',
    color: '#856404',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold',
  },
  actionsColumn: {
    padding: '15px',
    width: '80px',
  },
  actionButton: {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'teal',
    cursor: 'pointer',
    fontSize: '16px',
    padding: '5px',
  },
  disabledActionButton: {
    color: '#ccc',
    cursor: 'not-allowed',
  },
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 0',
  },
  paginationInfo: {
    fontSize: '14px',
    color: '#666',
  },
  paginationControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  paginationButton: {
    backgroundColor: 'white',
    color: 'teal',
    border: '2px solid teal',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  pageInfo: {
    fontSize: '14px',
    color: '#666',
    margin: '0 10px',
  },
  pageSizeSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  pageSizeSelect: {
    padding: '6px 10px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    backgroundColor: 'white',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '8px',
    width: '90%',
    maxWidth: '600px',
    maxHeight: '80vh',
    overflow: 'auto',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px',
    borderBottom: '1px solid #f0f0f0',
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    color: '#666',
    padding: '5px',
  },
  modalContent: {
    padding: '20px',
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '15px',
  },
  detailItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  detailLabel: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#666',
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: '14px',
    color: '#333',
    wordBreak: 'break-all',
  },
};

// Add CSS animation for spinning icons
if (!document.querySelector('#send-logs-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'send-logs-styles';
  styleSheet.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleSheet);
}

export default SendLogsScreen;