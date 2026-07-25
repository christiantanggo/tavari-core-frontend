// components/CustomVoiceAgent/CustomAgentLogs.jsx
// Logs viewer for custom voice agent activity
import React, { useState, useEffect } from 'react';
import { AlertCircle, Info, AlertTriangle, RefreshCw, Filter, Search } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';

const CustomAgentLogs = ({ businessId, customVoiceAgentService }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logLevelFilter, setLogLevelFilter] = useState('all');
  const [logTypeFilter, setLogTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [agents, setAgents] = useState([]);
  const [agentFilter, setAgentFilter] = useState('all');

  useEffect(() => {
    if (businessId) {
      loadAgents();
      loadLogs();
      
      // Refresh logs every 30 seconds
      const interval = setInterval(loadLogs, 30000);
      return () => clearInterval(interval);
    }
  }, [businessId, logLevelFilter, logTypeFilter, agentFilter]);

  const loadAgents = async () => {
    try {
      const agentsData = await customVoiceAgentService.getAgents();
      setAgents(agentsData || []);
    } catch (error) {
      console.error('Error loading agents:', error);
    }
  };

  const loadLogs = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('custom_voice_agent_logs')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(500);

      if (logLevelFilter !== 'all') {
        query = query.eq('log_level', logLevelFilter);
      }

      if (logTypeFilter !== 'all') {
        query = query.eq('log_type', logTypeFilter);
      }

      if (agentFilter !== 'all') {
        query = query.eq('agent_id', agentFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      // Filter by search term client-side
      let filteredLogs = data || [];
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filteredLogs = filteredLogs.filter(log => 
          log.message?.toLowerCase().includes(term) ||
          log.log_type?.toLowerCase().includes(term) ||
          JSON.stringify(log.details)?.toLowerCase().includes(term)
        );
      }
      
      setLogs(filteredLogs);
    } catch (error) {
      console.error('Error loading logs:', error);
      toast.error('Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  const getLogLevelIcon = (level) => {
    switch (level) {
      case 'error':
        return <AlertCircle size={16} color="#ef4444" />;
      case 'warning':
        return <AlertTriangle size={16} color="#f59e0b" />;
      default:
        return <Info size={16} color="#3b82f6" />;
    }
  };

  const getLogLevelBadgeColor = (level) => {
    switch (level) {
      case 'error':
        return { backgroundColor: '#fee2e2', color: '#991b1b', borderColor: '#ef4444' };
      case 'warning':
        return { backgroundColor: '#fef3c7', color: '#92400e', borderColor: '#f59e0b' };
      default:
        return { backgroundColor: '#dbeafe', color: '#1e40af', borderColor: '#3b82f6' };
    }
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  if (loading && logs.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px' }}>
        <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600 }}>Loading logs...</div>
      </div>
    );
  }

  const styles = {
    container: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      border: `1px solid ${TavariStyles.colors.gray200}`,
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xl,
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.md,
    },
    filters: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    filterGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
    },
    select: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.sm,
    },
    searchInput: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.sm,
      width: '250px',
    },
    logEntry: {
      padding: TavariStyles.spacing.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.white,
    },
    logHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: TavariStyles.spacing.xs,
    },
    logMeta: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      alignItems: 'center',
      flexWrap: 'wrap',
    },
    levelBadge: {
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '11px',
      fontWeight: '600',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    },
    logMessage: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray900,
      marginTop: TavariStyles.spacing.xs,
      wordBreak: 'break-word',
    },
    logDetails: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs,
      fontFamily: 'monospace',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius?.sm || '6px',
      maxHeight: '200px',
      overflow: 'auto',
    },
    emptyState: {
      textAlign: 'center',
      padding: '48px',
      color: TavariStyles.colors.gray600,
    },
  };

  const uniqueLogTypes = [...new Set(logs.map(log => log.log_type))].filter(Boolean);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={{ margin: 0, fontSize: TavariStyles.typography.fontSize.xl, fontWeight: 'bold' }}>
          Custom Voice Agent Logs
        </h2>
        <button
          onClick={loadLogs}
          style={{
            padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
            border: `1px solid ${TavariStyles.colors.gray300}`,
            borderRadius: TavariStyles.borderRadius?.md || '8px',
            backgroundColor: TavariStyles.colors.white,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div style={styles.filters}>
        <div style={styles.filterGroup}>
          <label style={styles.label}>Log Level</label>
          <select
            style={styles.select}
            value={logLevelFilter}
            onChange={(e) => setLogLevelFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.label}>Log Type</label>
          <select
            style={styles.select}
            value={logTypeFilter}
            onChange={(e) => setLogTypeFilter(e.target.value)}
          >
            <option value="all">All</option>
            {uniqueLogTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.label}>Agent</label>
          <select
            style={styles.select}
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
          >
            <option value="all">All Agents</option>
            {agents.map(agent => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.label}>Search</label>
          <input
            type="text"
            style={styles.searchInput}
            placeholder="Search logs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {logs.length === 0 ? (
        <div style={styles.emptyState}>
          <Info size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
          <div>No logs found</div>
        </div>
      ) : (
        <div>
          {logs.map(log => {
            const levelColors = getLogLevelBadgeColor(log.log_level);
            const details = log.details || {};
            
            return (
              <div key={log.id} style={styles.logEntry}>
                <div style={styles.logHeader}>
                  <div style={styles.logMeta}>
                    {getLogLevelIcon(log.log_level)}
                    <span style={{
                      ...styles.levelBadge,
                      ...levelColors,
                      border: `1px solid ${levelColors.borderColor}`,
                    }}>
                      {log.log_level || 'info'}
                    </span>
                    <span style={{ fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                      {log.log_type || 'unknown'}
                    </span>
                    <span style={{ color: TavariStyles.colors.gray500, fontSize: TavariStyles.typography.fontSize.sm }}>
                      {formatDate(log.created_at)}
                    </span>
                  </div>
                </div>
                <div style={styles.logMessage}>
                  {log.message}
                </div>
                {details && Object.keys(details).length > 0 && (
                  <details style={{ marginTop: TavariStyles.spacing.xs }}>
                    <summary style={{ cursor: 'pointer', color: TavariStyles.colors.gray600, fontSize: TavariStyles.typography.fontSize.xs }}>
                      View Details
                    </summary>
                    <pre style={styles.logDetails}>
                      {JSON.stringify(details, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CustomAgentLogs;

