// components/VoiceAgent/AgentLogs.jsx
// Logs viewer for voice agent activity (webhook logs, email logs, etc.)
import React, { useState, useEffect } from 'react';
import { AlertCircle, Info, AlertTriangle, RefreshCw, Filter, Search } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';

const AgentLogs = ({ businessId, voiceAgentService }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
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
  }, [businessId, severityFilter, eventTypeFilter, agentFilter]);

  const loadAgents = async () => {
    try {
      const agentsData = await voiceAgentService.getAgents();
      setAgents(agentsData || []);
    } catch (error) {
      console.error('Error loading agents:', error);
    }
  };

  const loadLogs = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('voice_agent_logs')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(500);

      if (severityFilter !== 'all') {
        query = query.eq('severity', severityFilter);
      }

      if (eventTypeFilter !== 'all') {
        query = query.eq('event_type', eventTypeFilter);
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
          log.event_type?.toLowerCase().includes(term) ||
          log.details?.toLowerCase().includes(term)
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

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'error':
        return <AlertCircle size={16} color="#ef4444" />;
      case 'warning':
        return <AlertTriangle size={16} color="#f59e0b" />;
      default:
        return <Info size={16} color="#3b82f6" />;
    }
  };

  const getSeverityBadgeColor = (severity) => {
    switch (severity) {
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

  const parseDetails = (details) => {
    try {
      return typeof details === 'string' ? JSON.parse(details) : details;
    } catch {
      return details;
    }
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
    severityBadge: {
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

  const uniqueEventTypes = [...new Set(logs.map(log => log.event_type))].filter(Boolean);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={{ margin: 0, fontSize: TavariStyles.typography.fontSize.xl, fontWeight: 'bold' }}>
          Voice Agent Logs
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
          <label style={styles.label}>Severity</label>
          <select
            style={styles.select}
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.label}>Event Type</label>
          <select
            style={styles.select}
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value)}
          >
            <option value="all">All</option>
            {uniqueEventTypes.map(type => (
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
            const severityColors = getSeverityBadgeColor(log.severity);
            const details = parseDetails(log.details);
            
            return (
              <div key={log.id} style={styles.logEntry}>
                <div style={styles.logHeader}>
                  <div style={styles.logMeta}>
                    {getSeverityIcon(log.severity)}
                    <span style={{
                      ...styles.severityBadge,
                      ...severityColors,
                      border: `1px solid ${severityColors.borderColor}`,
                    }}>
                      {log.severity || 'info'}
                    </span>
                    <span style={{ fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                      {log.event_type}
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

export default AgentLogs;

