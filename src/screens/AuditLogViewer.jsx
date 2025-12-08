// src/screens/AuditLogViewer.jsx - WITH PERMISSION SYSTEM
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useBusiness } from '../contexts/BusinessContext';
import { TavariStyles } from '../utils/TavariStyles';
import POSAuthWrapper from '../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../hooks/usePOSAuth';
import { usePermissions } from '../hooks/usePermissions';
import { SecurityWrapper, useSecurityContext } from '../Security';
import PermissionGate from '../components/Auth/PermissionGate';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';

const AuditLogViewer = () => {
  const [logs, setLogs] = useState([]);
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [exporting, setExporting] = useState(false);
  
  // Business context
  const { business } = useBusiness();
  const selectedBiz = business?.id || '';

  // Security context for sensitive audit log access
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'AuditLogViewer',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AuditLogViewer'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    isOwner,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canViewAuditLogs = hasAnyPermission([
    'settings.security.view_logs',
    'reports.audit.view'
  ]) || hasElevatedPrivileges();

  const canExportAuditLogs = hasPermission('settings.security.export_logs') || isOwner();
  const canViewAllUsers = hasPermission('hr.employees.view') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewAuditLogs) {
      toast.error('You do not have permission to view audit logs');
      // Could redirect here if needed
    }
  }, [permissionsLoading, canViewAuditLogs]);

  useEffect(() => {
    if (auth.isReady && selectedBiz && !permissionsLoading && canViewAuditLogs) {
      loadUsers();
      loadLogs();
    }
  }, [selectedBiz, auth.isReady, permissionsLoading, canViewAuditLogs]);

  const loadUsers = async () => {
    if (!selectedBiz || !canViewAllUsers) return;

    try {
      await recordAction('audit_log_users_load', selectedBiz, true);

      const { data } = await supabase
        .from('user_roles')
        .select('user_id, users(email)')
        .eq('business_id', selectedBiz)
        .eq('active', true);

      if (data) {
        const mapped = data.map(entry => ({
          id: entry.user_id,
          email: entry.users?.email || ''
        }));
        setUsers(mapped);
      }
    } catch (err) {
      await logSecurityEvent('audit_log_users_load_error', {
        error: err.message,
        business_id: selectedBiz
      }, 'medium');
      setError('Failed to load users');
    }
  };

  const loadLogs = async () => {
    if (!selectedBiz || !canViewAuditLogs) return;

    // Rate limit check
    const rateLimitOk = await checkRateLimit('audit_log_view', 10, 60000);
    if (!rateLimitOk) {
      toast.error('Too many requests. Please wait a moment.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await recordAction('audit_log_view', selectedBiz, true);
      await logSecurityEvent('audit_logs_accessed', {
        business_id: selectedBiz,
        filters: {
          event_type: eventTypeFilter || 'all',
          user_filter: userFilter || 'all',
          start_date: startDate || 'none',
          end_date: endDate || 'none'
        }
      }, 'medium');
      
      let query = supabase
        .from('audit_logs')
        .select('*')
        .eq('business_id', selectedBiz)
        .order('created_at', { ascending: false })
        .limit(200);

      if (eventTypeFilter) {
        query = query.eq('event_type', eventTypeFilter);
      }
      if (userFilter) {
        query = query.eq('user_id', userFilter);
      }
      if (startDate) {
        query = query.gte('created_at', startDate);
      }
      if (endDate) {
        query = query.lte('created_at', endDate + 'T23:59:59');
      }

      const { data, error } = await query;
      
      if (error) throw error;
      
      setLogs(data || []);
    } catch (err) {
      await logSecurityEvent('audit_log_load_error', {
        error: err.message,
        business_id: selectedBiz
      }, 'high');
      setError(`Failed to load audit logs: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = async () => {
    if (!canExportAuditLogs) {
      toast.error('You do not have permission to export audit logs');
      return;
    }

    if (!selectedBiz) {
      toast.error('No business selected for export');
      return;
    }

    // Rate limit check for exports
    const rateLimitOk = await checkRateLimit('audit_log_export', 3, 300000);
    if (!rateLimitOk) {
      toast.error('Export rate limit exceeded. Please wait 5 minutes.');
      return;
    }

    setExporting(true);
    
    try {
      await recordAction('audit_log_export', selectedBiz, true);

      let query = supabase
        .from('audit_logs')
        .select('*')
        .eq('business_id', selectedBiz)
        .order('created_at', { ascending: false });

      if (eventTypeFilter) {
        query = query.eq('event_type', eventTypeFilter);
      }
      if (userFilter) {
        query = query.eq('user_id', userFilter);
      }
      if (startDate) {
        query = query.gte('created_at', startDate);
      }
      if (endDate) {
        query = query.lte('created_at', endDate + 'T23:59:59');
      }

      const { data: exportLogs, error } = await query;
      
      if (error) throw error;

      if (!exportLogs || exportLogs.length === 0) {
        toast.error('No audit logs found to export with current filters');
        return;
      }

      const csvContent = generateCSV(exportLogs);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        
        let filename = `audit_logs_${dateStr}_${timeStr}`;
        if (eventTypeFilter) filename += `_${eventTypeFilter}`;
        if (userFilter) {
          const user = users.find(u => u.id === userFilter);
          if (user) filename += `_${user.email.split('@')[0]}`;
        }
        filename += '.csv';
        
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        await logSecurityEvent('audit_logs_exported', {
          business_id: selectedBiz,
          exported_count: exportLogs.length,
          filters: {
            event_type: eventTypeFilter || 'all',
            user_filter: userFilter || 'all',
            start_date: startDate || 'none',
            end_date: endDate || 'none'
          },
          filename: filename
        }, 'high');

        await supabase.from('audit_logs').insert({
          business_id: selectedBiz,
          user_id: auth.authUser.id,
          event_type: 'audit_logs_exported',
          details: {
            exported_count: exportLogs.length,
            filters: {
              event_type: eventTypeFilter || 'all',
              user_filter: userFilter || 'all',
              start_date: startDate || 'none',
              end_date: endDate || 'none'
            },
            filename: filename
          }
        });

        toast.success(`Successfully exported ${exportLogs.length} audit logs`);
      }
      
    } catch (err) {
      await logSecurityEvent('audit_log_export_error', {
        error: err.message,
        business_id: selectedBiz
      }, 'high');
      toast.error('Failed to export CSV: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const generateCSV = (logsData) => {
    const headers = [
      'Date',
      'Time',
      'Event Type',
      'User Email',
      'User ID',
      'Business ID',
      'Details'
    ];

    const rows = logsData.map(log => {
      const date = new Date(log.created_at);
      const userEmail = formatUserEmail(log.user_id);
      
      let detailsStr = '';
      if (log.details && typeof log.details === 'object') {
        try {
          const keyDetails = extractKeyDetails(log.details);
          if (Object.keys(keyDetails).length > 0) {
            detailsStr = Object.entries(keyDetails)
              .map(([key, value]) => `${key}=${value}`)
              .join('; ');
          } else {
            detailsStr = JSON.stringify(log.details);
          }
        } catch (err) {
          detailsStr = String(log.details);
        }
      }

      return [
        date.toLocaleDateString('en-CA'),
        date.toLocaleTimeString('en-CA', { hour12: false }),
        log.event_type || '',
        userEmail,
        log.user_id || '',
        log.business_id || '',
        escapeCSVField(detailsStr)
      ];
    });

    const csvLines = [headers, ...rows];
    
    return csvLines.map(row => 
      row.map(field => escapeCSVField(String(field))).join(',')
    ).join('\n');
  };

  const escapeCSVField = (field) => {
    if (!field) return '""';
    
    const str = String(field);
    
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    
    return str;
  };

  const formatUserEmail = (userId) => {
    const user = users.find(u => u.id === userId);
    return user ? user.email : userId;
  };

  const extractKeyDetails = (details) => {
    if (!details || typeof details !== 'object') return {};
    
    const keyFields = {};
    
    if (details.original_event_type) keyFields.action = details.original_event_type;
    if (details.url) keyFields.page = details.url.split('/').pop() || details.url;
    if (details.to_tab) keyFields.tab = details.to_tab;
    if (details.from_tab) keyFields.from_tab = details.from_tab;
    if (details.setting_name) keyFields.setting = details.setting_name;
    if (details.old_value) keyFields.old_value = details.old_value;
    if (details.new_value) keyFields.new_value = details.new_value;
    if (details.user_agent) {
      const ua = details.user_agent;
      if (ua.includes('Chrome')) keyFields.browser = 'Chrome';
      else if (ua.includes('Firefox')) keyFields.browser = 'Firefox';
      else if (ua.includes('Safari')) keyFields.browser = 'Safari';
      else if (ua.includes('Edge')) keyFields.browser = 'Edge';
      else keyFields.browser = 'Other';
    }
    
    return keyFields;
  };

  const styles = {
    container: {
      ...TavariStyles.layout.container,
      maxWidth: '1400px',
      margin: '0 auto'
    },
    
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing['2xl'],
      paddingBottom: TavariStyles.spacing.lg,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    
    businessInfo: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      fontStyle: 'italic'
    },

    headerActions: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      alignItems: 'center'
    },

    exportButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.md,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },

    exportButtonDisabled: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.md,
      opacity: 0.5,
      cursor: 'not-allowed',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    
    filtersCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl
    },
    
    filtersGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.lg
    },
    
    filterGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    
    label: {
      ...TavariStyles.components.form.label,
      margin: 0
    },
    
    select: {
      ...TavariStyles.components.form.select
    },
    
    input: {
      ...TavariStyles.components.form.input
    },
    
    refreshButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.md,
      alignSelf: 'flex-end'
    },
    
    tableContainer: {
      ...TavariStyles.components.table.container,
      overflowX: 'auto'
    },
    
    table: {
      ...TavariStyles.components.table.table,
      minWidth: '1200px'
    },
    
    headerRow: {
      ...TavariStyles.components.table.headerRow
    },
    
    th: {
      ...TavariStyles.components.table.th,
      whiteSpace: 'nowrap'
    },
    
    row: {
      ...TavariStyles.components.table.row,
      cursor: 'pointer'
    },
    
    expandedRow: {
      ...TavariStyles.components.table.row,
      backgroundColor: TavariStyles.colors.gray50,
      cursor: 'pointer'
    },
    
    suspiciousRow: {
      ...TavariStyles.components.table.row,
      backgroundColor: TavariStyles.colors.errorBg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer'
    },
    
    td: {
      ...TavariStyles.components.table.td,
      verticalAlign: 'top'
    },
    
    dateCell: {
      ...TavariStyles.components.table.td,
      minWidth: '140px',
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    eventTypeCell: {
      ...TavariStyles.components.table.td,
      minWidth: '160px'
    },
    
    userCell: {
      ...TavariStyles.components.table.td,
      minWidth: '200px',
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    detailsCell: {
      ...TavariStyles.components.table.td,
      maxWidth: '300px',
      minWidth: '250px'
    },
    
    keyDetail: {
      display: 'inline-block',
      backgroundColor: TavariStyles.colors.gray100,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      marginRight: TavariStyles.spacing.xs,
      marginBottom: TavariStyles.spacing.xs,
      border: `1px solid ${TavariStyles.colors.gray300}`
    },
    
    keyDetailLabel: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700
    },
    
    keyDetailValue: {
      color: TavariStyles.colors.gray600,
      marginLeft: TavariStyles.spacing.xs
    },
    
    expandButton: {
      background: 'none',
      border: 'none',
      color: TavariStyles.colors.primary,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      padding: TavariStyles.spacing.xs,
      borderRadius: TavariStyles.borderRadius.sm,
      marginTop: TavariStyles.spacing.xs
    },
    
    rawDetails: {
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontFamily: TavariStyles.typography.fontFamilyMono,
      whiteSpace: 'pre-wrap',
      maxHeight: '200px',
      overflow: 'auto',
      marginTop: TavariStyles.spacing.sm,
      border: `1px solid ${TavariStyles.colors.gray300}`
    },
    
    suspiciousIcon: {
      color: TavariStyles.colors.danger,
      marginLeft: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.lg
    },
    
    loadingContainer: {
      ...TavariStyles.layout.flexCenter,
      height: '300px',
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    
    errorContainer: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      textAlign: 'center'
    },
    
    emptyState: {
      ...TavariStyles.layout.flexCenter,
      height: '300px',
      flexDirection: 'column',
      color: TavariStyles.colors.gray500
    },
    
    emptyStateText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      marginBottom: TavariStyles.spacing.md
    },
    
    originalEventType: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      display: 'inline-block'
    },

    noPermissionContainer: {
      ...TavariStyles.layout.flexCenter,
      height: '400px',
      flexDirection: 'column',
      color: TavariStyles.colors.gray600
    },

    noPermissionText: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.md
    }
  };

  const renderContent = () => {
    if (loading || permissionsLoading) {
      return (
        <div style={styles.loadingContainer}>
          Loading audit logs...
        </div>
      );
    }

    if (!canViewAuditLogs) {
      return (
        <div style={styles.noPermissionContainer}>
          <div style={styles.noPermissionText}>
            Access Denied
          </div>
          <div>
            You do not have permission to view audit logs
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div style={styles.errorContainer}>
          {error}
        </div>
      );
    }

    if (logs.length === 0) {
      return (
        <div style={styles.emptyState}>
          <div style={styles.emptyStateText}>
            No audit logs found
          </div>
          <div>
            Try adjusting your filters or date range
          </div>
          <div style={{ marginTop: TavariStyles.spacing.md, fontSize: TavariStyles.typography.fontSize.sm }}>
            Searching for business: {selectedBiz}
          </div>
        </div>
      );
    }

    return (
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.headerRow}>
              <th style={styles.th}>Date & Time</th>
              <th style={styles.th}>Event Type</th>
              <th style={styles.th}>User</th>
              <th style={styles.th}>Key Details</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => {
              const isSuspicious = log.event_type === 'suspicious_activity';
              const isExpanded = expandedRow === log.id;
              const originalEventType = log.details?.original_event_type;
              const keyDetails = extractKeyDetails(log.details);
              
              return (
                <React.Fragment key={log.id}>
                  <tr
                    style={isSuspicious ? styles.suspiciousRow : (isExpanded ? styles.expandedRow : styles.row)}
                    onClick={() => setExpandedRow(isExpanded ? null : log.id)}
                  >
                    <td style={styles.dateCell}>
                      {new Date(log.created_at).toLocaleDateString('en-CA')}
                      <br />
                      <span style={{ color: TavariStyles.colors.gray500 }}>
                        {new Date(log.created_at).toLocaleTimeString('en-CA', { 
                          hour12: false, 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </span>
                    </td>
                    <td style={styles.eventTypeCell}>
                      <div>
                        {log.event_type}
                        {isSuspicious && (
                          <span style={styles.suspiciousIcon}>🚨</span>
                        )}
                      </div>
                      {originalEventType && (
                        <div style={{ marginTop: TavariStyles.spacing.xs }}>
                          <span style={styles.originalEventType}>
                            {originalEventType}
                          </span>
                        </div>
                      )}
                    </td>
                    <td style={styles.userCell}>
                      {formatUserEmail(log.user_id)}
                    </td>
                    <td style={styles.detailsCell}>
                      {Object.entries(keyDetails).map(([key, value]) => (
                        <div key={key} style={styles.keyDetail}>
                          <span style={styles.keyDetailLabel}>{key}:</span>
                          <span style={styles.keyDetailValue}>
                            {String(value).length > 30 ? String(value).substring(0, 30) + '...' : String(value)}
                          </span>
                        </div>
                      ))}
                    </td>
                    <td style={styles.td}>
                      <button 
                        style={styles.expandButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedRow(isExpanded ? null : log.id);
                        }}
                      >
                        {isExpanded ? 'Hide Details' : 'Show Details'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan="5" style={styles.td}>
                        <div style={styles.rawDetails}>
                          {JSON.stringify(log.details, null, 2)}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin']}
      requireBusiness={true}
      componentName="AuditLogViewer"
    >
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Audit Logs</h1>
            {business && (
              <div style={styles.businessInfo}>
                Viewing logs for: {business.name} ({selectedBiz})
              </div>
            )}
          </div>
          
          <PermissionGate
            permissions={['settings.security.export_logs']}
            requireAny
            fallback={null}
          >
            <div style={styles.headerActions}>
              <button
                style={exporting ? styles.exportButtonDisabled : styles.exportButton}
                onClick={exportToCSV}
                disabled={exporting || loading || logs.length === 0}
                title="Export current filtered logs to CSV"
              >
                <Download size={16} />
                {exporting ? 'Exporting...' : 'Export CSV'}
              </button>
            </div>
          </PermissionGate>
        </div>

        <div style={styles.filtersCard}>
          <div style={styles.filtersGrid}>
            <div style={styles.filterGroup}>
              <label style={styles.label}>Event Type</label>
              <select 
                style={styles.select}
                value={eventTypeFilter} 
                onChange={e => setEventTypeFilter(e.target.value)}
              >
                <option value="">All Events</option>
                <option value="login">Login</option>
                <option value="failed_login">Failed Login</option>
                <option value="logout">Logout</option>
                <option value="timeout_logout">Timeout Logout</option>
                <option value="user_created">User Created</option>
                <option value="pin_change">PIN Change</option>
                <option value="user_profile_access">Profile Access</option>
                <option value="suspicious_activity">Suspicious Activity</option>
              </select>
            </div>

            <PermissionGate
              permissions={['hr.employees.view']}
              requireAny
              fallback={null}
            >
              <div style={styles.filterGroup}>
                <label style={styles.label}>User</label>
                <select 
                  style={styles.select}
                  value={userFilter} 
                  onChange={e => setUserFilter(e.target.value)}
                >
                  <option value="">All Users</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.email}</option>
                  ))}
                </select>
              </div>
            </PermissionGate>

            <div style={styles.filterGroup}>
              <label style={styles.label}>Start Date</label>
              <input 
                type="date" 
                style={styles.input}
                value={startDate} 
                onChange={e => setStartDate(e.target.value)} 
              />
            </div>

            <div style={styles.filterGroup}>
              <label style={styles.label}>End Date</label>
              <input 
                type="date" 
                style={styles.input}
                value={endDate} 
                onChange={e => setEndDate(e.target.value)} 
              />
            </div>
          </div>

          <button 
            onClick={loadLogs} 
            style={styles.refreshButton}
            disabled={loading || permissionsLoading}
          >
            {loading ? 'Loading...' : 'Refresh Logs'}
          </button>
        </div>

        {renderContent()}
      </div>
    </POSAuthWrapper>
  );
};

export default AuditLogViewer;