// components/VoiceAgent/AgentSystemHealth.jsx
// System health monitoring and configuration validation
import React, { useState, useEffect } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';

const AgentSystemHealth = ({ businessId, voiceAgentService }) => {
  const [healthStatus, setHealthStatus] = useState({
    loading: true,
    checks: [],
    overallStatus: 'unknown',
    lastChecked: null,
  });

  useEffect(() => {
    if (businessId) {
      checkSystemHealth();
      // Refresh every 60 seconds
      const interval = setInterval(checkSystemHealth, 60000);
      return () => clearInterval(interval);
    }
  }, [businessId]);

  const checkSystemHealth = async () => {
    try {
      setHealthStatus(prev => ({ ...prev, loading: true }));
      
      const checks = [];

      // Check 1: AWS SES Credentials
      const sesCheck = await checkSESCredentials();
      checks.push({
        id: 'ses_credentials',
        name: 'AWS SES Credentials',
        status: sesCheck.valid ? 'pass' : 'fail',
        message: sesCheck.message,
        details: sesCheck.details,
      });

      // Check 2: Notification Emails Configured
      const emailCheck = await checkNotificationEmails();
      checks.push({
        id: 'notification_emails',
        name: 'Notification Emails Configured',
        status: emailCheck.valid ? 'pass' : 'warn',
        message: emailCheck.message,
        details: emailCheck.details,
      });

      // Check 3: Recent Email Failures
      const failureCheck = await checkRecentFailures();
      checks.push({
        id: 'recent_failures',
        name: 'Recent Email Failures',
        status: failureCheck.valid ? 'pass' : 'fail',
        message: failureCheck.message,
        details: failureCheck.details,
      });

      // Check 4: Database Tables
      const tablesCheck = await checkDatabaseTables();
      checks.push({
        id: 'database_tables',
        name: 'Database Tables',
        status: tablesCheck.valid ? 'pass' : 'fail',
        message: tablesCheck.message,
        details: tablesCheck.details,
      });

      // Check 5: Active Agents
      const agentsCheck = await checkActiveAgents();
      checks.push({
        id: 'active_agents',
        name: 'Active Voice Agents',
        status: agentsCheck.valid ? 'pass' : 'warn',
        message: agentsCheck.message,
        details: agentsCheck.details,
      });

      // Determine overall status
      const hasFailures = checks.some(c => c.status === 'fail');
      const hasWarnings = checks.some(c => c.status === 'warn');
      const overallStatus = hasFailures ? 'fail' : hasWarnings ? 'warn' : 'pass';

      setHealthStatus({
        loading: false,
        checks,
        overallStatus,
        lastChecked: new Date().toISOString(),
      });

    } catch (error) {
      console.error('Error checking system health:', error);
      setHealthStatus(prev => ({
        ...prev,
        loading: false,
        checks: [{
          id: 'error',
          name: 'Health Check Error',
          status: 'fail',
          message: 'Failed to check system health',
          details: error.message,
        }],
        overallStatus: 'fail',
      }));
    }
  };

  const checkSESCredentials = async () => {
    // Note: We can't directly check Edge Function secrets from the frontend
    // But we can check if emails are working by looking at recent success/failure rates
    try {
      const { data: recentLogs } = await supabase
        .from('voice_agent_logs')
        .select('event_type, severity')
        .eq('business_id', businessId)
        .in('event_type', ['email_sent', 'email_failed'])
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(10);

      const failures = recentLogs?.filter(l => l.event_type === 'email_failed' || l.severity === 'error').length || 0;
      const total = recentLogs?.length || 0;

      if (total === 0) {
        return {
          valid: true,
          message: 'No recent email activity (system may not have been tested yet)',
          details: 'Check status will be more accurate after emails are attempted',
        };
      }

      const failureRate = failures / total;
      
      if (failureRate > 0.5) {
        return {
          valid: false,
          message: `High email failure rate: ${Math.round(failureRate * 100)}% of recent attempts failed`,
          details: 'Check AWS SES credentials in Supabase Edge Function secrets',
        };
      }

      return {
        valid: true,
        message: `Email system working: ${total - failures}/${total} successful in last 24h`,
        details: failureRate > 0 ? `${failures} failures detected` : 'All emails successful',
      };
    } catch (error) {
      return {
        valid: false,
        message: 'Cannot verify email system status',
        details: error.message,
      };
    }
  };

  const checkNotificationEmails = async () => {
    try {
      const { data: agents } = await supabase
        .from('voice_agents')
        .select('id, name, message_notification_email, issue_notification_email')
        .eq('business_id', businessId);

      const { data: business } = await supabase
        .from('businesses')
        .select('business_email')
        .eq('id', businessId)
        .single();

      const agentsWithoutEmail = agents?.filter(a => 
        !a.message_notification_email && !business?.business_email
      ) || [];

      if (agentsWithoutEmail.length > 0) {
        return {
          valid: false,
          message: `${agentsWithoutEmail.length} agent(s) without notification email configured`,
          details: agentsWithoutEmail.map(a => a.name).join(', '),
        };
      }

      const agentsWithoutIssueEmail = agents?.filter(a => 
        !a.issue_notification_email && !a.message_notification_email && !business?.business_email
      ) || [];

      if (agentsWithoutIssueEmail.length > 0) {
        return {
          valid: true,
          message: 'Notification emails configured, but some agents missing issue notification email',
          details: agentsWithoutIssueEmail.map(a => a.name).join(', '),
        };
      }

      return {
        valid: true,
        message: 'All agents have notification emails configured',
        details: `${agents?.length || 0} agent(s) configured`,
      };
    } catch (error) {
      return {
        valid: false,
        message: 'Cannot check notification email configuration',
        details: error.message,
      };
    }
  };

  const checkRecentFailures = async () => {
    try {
      const { data: failures } = await supabase
        .from('voice_agent_failed_emails')
        .select('id, email_type, error_message, retry_count, status')
        .eq('business_id', businessId)
        .in('status', ['pending', 'retrying', 'failed'])
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(10);

      if (!failures || failures.length === 0) {
        return {
          valid: true,
          message: 'No failed emails in the last 7 days',
          details: 'Email system is functioning properly',
        };
      }

      const pendingRetries = failures.filter(f => f.status === 'pending' || f.status === 'retrying').length;
      const permanentlyFailed = failures.filter(f => f.status === 'failed').length;

      if (permanentlyFailed > 0) {
        return {
          valid: false,
          message: `${permanentlyFailed} email(s) permanently failed (exceeded retry limit)`,
          details: `${pendingRetries} still pending retry. Check failed emails for details.`,
        };
      }

      return {
        valid: true,
        message: `${pendingRetries} email(s) pending retry`,
        details: 'System will automatically retry failed emails',
      };
    } catch (error) {
      // Table might not exist yet
      if (error.code === '42P01') {
        return {
          valid: true,
          message: 'Failed emails table not yet created',
          details: 'Run the voice_agent_create_failed_emails_table.sql migration',
        };
      }
      return {
        valid: false,
        message: 'Cannot check recent failures',
        details: error.message,
      };
    }
  };

  const checkDatabaseTables = async () => {
    const requiredTables = [
      'voice_agents',
      'voice_agent_calls',
      'voice_agent_messages',
      'voice_agent_bookings',
      'voice_agent_logs',
    ];

    const missingTables = [];
    
    for (const table of requiredTables) {
      try {
        const { error } = await supabase
          .from(table)
          .select('id')
          .limit(1);

        if (error && error.code === '42P01') {
          missingTables.push(table);
        }
      } catch (error) {
        if (error.code === '42P01') {
          missingTables.push(table);
        }
      }
    }

    if (missingTables.length > 0) {
      return {
        valid: false,
        message: `${missingTables.length} required table(s) missing`,
        details: missingTables.join(', '),
      };
    }

    return {
      valid: true,
      message: 'All required database tables exist',
      details: `${requiredTables.length} tables verified`,
    };
  };

  const checkActiveAgents = async () => {
    try {
      const { data: agents } = await supabase
        .from('voice_agents')
        .select('id, name, is_active, vapi_assistant_id')
        .eq('business_id', businessId);

      const activeAgents = agents?.filter(a => a.is_active) || [];
      const agentsWithoutVapi = activeAgents.filter(a => !a.vapi_assistant_id);

      if (agentsWithoutVapi.length > 0) {
        return {
          valid: false,
          message: `${agentsWithoutVapi.length} active agent(s) not connected to Vapi`,
          details: agentsWithoutVapi.map(a => a.name).join(', '),
        };
      }

      if (activeAgents.length === 0) {
        return {
          valid: false,
          message: 'No active voice agents configured',
          details: 'Create and activate at least one agent to receive calls',
        };
      }

      return {
        valid: true,
        message: `${activeAgents.length} active agent(s) configured`,
        details: agents?.map(a => a.name).join(', ') || '',
      };
    } catch (error) {
      return {
        valid: false,
        message: 'Cannot check active agents',
        details: error.message,
      };
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pass':
        return <CheckCircle size={20} color="#10b981" />;
      case 'warn':
        return <AlertTriangle size={20} color="#f59e0b" />;
      case 'fail':
        return <XCircle size={20} color="#ef4444" />;
      default:
        return <AlertCircle size={20} color="#6b7280" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pass':
        return { backgroundColor: '#d1fae5', borderColor: '#10b981', color: '#065f46' };
      case 'warn':
        return { backgroundColor: '#fef3c7', borderColor: '#f59e0b', color: '#92400e' };
      case 'fail':
        return { backgroundColor: '#fee2e2', borderColor: '#ef4444', color: '#991b1b' };
      default:
        return { backgroundColor: '#f3f4f6', borderColor: '#6b7280', color: '#374151' };
    }
  };

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
    },
    overallStatus: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.xl,
      fontWeight: '600',
    },
    checkItem: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.white,
    },
    checkDetails: {
      flex: 1,
    },
    checkName: {
      fontWeight: '600',
      marginBottom: '4px',
    },
    checkMessage: {
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: '4px',
    },
    checkDetailsText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
    },
    lastChecked: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      marginTop: TavariStyles.spacing.md,
      textAlign: 'center',
    },
  };

  if (healthStatus.loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600 }}>Checking system health...</div>
        </div>
      </div>
    );
  }

  const overallColors = getStatusColor(healthStatus.overallStatus);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={{ margin: 0, fontSize: TavariStyles.typography.fontSize.xl, fontWeight: 'bold' }}>
          System Health
        </h2>
        <button
          onClick={checkSystemHealth}
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

      <div style={{ ...styles.overallStatus, ...overallColors }}>
        {getStatusIcon(healthStatus.overallStatus)}
        <div>
          <div>Overall Status: {healthStatus.overallStatus.toUpperCase()}</div>
          <div style={{ fontSize: TavariStyles.typography.fontSize.sm, opacity: 0.8 }}>
            {healthStatus.checks.filter(c => c.status === 'pass').length} of {healthStatus.checks.length} checks passing
          </div>
        </div>
      </div>

      {healthStatus.checks.map(check => {
        const colors = getStatusColor(check.status);
        return (
          <div key={check.id} style={{ ...styles.checkItem, borderColor: colors.borderColor }}>
            {getStatusIcon(check.status)}
            <div style={styles.checkDetails}>
              <div style={{ ...styles.checkName, color: colors.color }}>{check.name}</div>
              <div style={styles.checkMessage}>{check.message}</div>
              {check.details && (
                <div style={styles.checkDetailsText}>{check.details}</div>
              )}
            </div>
          </div>
        );
      })}

      {healthStatus.lastChecked && (
        <div style={styles.lastChecked}>
          Last checked: {new Date(healthStatus.lastChecked).toLocaleString()}
        </div>
      )}
    </div>
  );
};

export default AgentSystemHealth;

