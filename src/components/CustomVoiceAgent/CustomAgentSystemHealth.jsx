// components/CustomVoiceAgent/CustomAgentSystemHealth.jsx
// System health monitoring for custom voice agents
import React, { useState, useEffect } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';

const CustomAgentSystemHealth = ({ businessId, customVoiceAgentService }) => {
  const [healthStatus, setHealthStatus] = useState({
    loading: true,
    checks: [],
    overallStatus: 'unknown',
    lastChecked: null,
  });

  useEffect(() => {
    if (businessId) {
      checkSystemHealth();
      const interval = setInterval(checkSystemHealth, 60000);
      return () => clearInterval(interval);
    }
  }, [businessId]);

  const checkSystemHealth = async () => {
    try {
      setHealthStatus(prev => ({ ...prev, loading: true }));
      
      const checks = [];

      // Check 1: Configuration exists
      const configCheck = await checkConfiguration();
      checks.push({
        id: 'configuration',
        name: 'Configuration',
        status: configCheck.valid ? 'pass' : 'fail',
        message: configCheck.message,
        details: configCheck.details,
      });

      // Check 2: Active Agents
      const agentsCheck = await checkActiveAgents();
      checks.push({
        id: 'active_agents',
        name: 'Active Custom Voice Agents',
        status: agentsCheck.valid ? 'pass' : 'warn',
        message: agentsCheck.message,
        details: agentsCheck.details,
      });

      // Check 3: Recent Call Activity
      const callsCheck = await checkRecentCalls();
      checks.push({
        id: 'recent_calls',
        name: 'Recent Call Activity',
        status: callsCheck.valid ? 'pass' : 'warn',
        message: callsCheck.message,
        details: callsCheck.details,
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

  const checkConfiguration = async () => {
    try {
      const { data, error } = await supabase
        .from('custom_voice_agent_configurations')
        .select('id, telnyx_api_key_encrypted, openai_api_key_encrypted, webhook_url')
        .eq('business_id', businessId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (!data) {
        return {
          valid: false,
          message: 'Configuration not found',
          details: 'Please configure API keys and webhook URL in settings',
        };
      }

      const hasTelnyx = !!data.telnyx_api_key_encrypted;
      const hasOpenAI = !!data.openai_api_key_encrypted;
      const hasWebhook = !!data.webhook_url;

      if (!hasTelnyx || !hasOpenAI) {
        return {
          valid: false,
          message: 'Missing API keys',
          details: `Telnyx: ${hasTelnyx ? '✓' : '✗'}, OpenAI: ${hasOpenAI ? '✓' : '✗'}`,
        };
      }

      return {
        valid: true,
        message: 'Configuration complete',
        details: `Webhook: ${hasWebhook ? 'Configured' : 'Not configured'}`,
      };
    } catch (error) {
      return {
        valid: false,
        message: 'Cannot verify configuration',
        details: error.message,
      };
    }
  };

  const checkActiveAgents = async () => {
    try {
      const { data, error } = await supabase
        .from('custom_voice_agents')
        .select('id, name, is_active')
        .eq('business_id', businessId);

      if (error) throw error;

      const activeCount = data?.filter(a => a.is_active).length || 0;
      const totalCount = data?.length || 0;

      if (totalCount === 0) {
        return {
          valid: false,
          message: 'No custom voice agents created',
          details: 'Create at least one agent to get started',
        };
      }

      if (activeCount === 0) {
        return {
          valid: false,
          message: 'No active agents',
          details: `${totalCount} agent(s) created but none are active`,
        };
      }

      return {
        valid: true,
        message: `${activeCount} active agent(s)`,
        details: `${totalCount} total agent(s)`,
      };
    } catch (error) {
      return {
        valid: false,
        message: 'Cannot verify agents',
        details: error.message,
      };
    }
  };

  const checkRecentCalls = async () => {
    try {
      const { data, error } = await supabase
        .from('custom_voice_agent_calls')
        .select('id, status')
        .eq('business_id', businessId)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(10);

      if (error) throw error;

      const callCount = data?.length || 0;
      const successCount = data?.filter(c => c.status === 'completed').length || 0;

      if (callCount === 0) {
        return {
          valid: true,
          message: 'No recent calls',
          details: 'System ready but not tested yet',
        };
      }

      return {
        valid: true,
        message: `${callCount} call(s) in last 24h`,
        details: `${successCount} completed successfully`,
      };
    } catch (error) {
      return {
        valid: false,
        message: 'Cannot verify call activity',
        details: error.message,
      };
    }
  };

  const checkDatabaseTables = async () => {
    try {
      // Try to query each table
      const tables = [
        'custom_voice_agents',
        'custom_voice_agent_calls',
        'custom_voice_agent_bookings',
        'custom_voice_agent_messages',
        'custom_voice_agent_configurations',
      ];

      const results = await Promise.all(
        tables.map(async (table) => {
          const { error } = await supabase.from(table).select('id').limit(1);
          return { table, exists: !error };
        })
      );

      const missing = results.filter(r => !r.exists).map(r => r.table);

      if (missing.length > 0) {
        return {
          valid: false,
          message: 'Missing database tables',
          details: missing.join(', '),
        };
      }

      return {
        valid: true,
        message: 'All database tables exist',
        details: `${tables.length} tables verified`,
      };
    } catch (error) {
      return {
        valid: false,
        message: 'Cannot verify database tables',
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
        return <AlertCircle size={20} color="#ef4444" />;
      default:
        return <AlertCircle size={20} color="#6b7280" />;
    }
  };

  if (healthStatus.loading) {
    return (
      <div style={{ textAlign: 'center', padding: '48px' }}>
        <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600 }}>Checking system health...</div>
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
    },
    checkItem: {
      padding: TavariStyles.spacing.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.md,
      display: 'flex',
      gap: TavariStyles.spacing.md,
      alignItems: 'flex-start',
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={{ fontSize: TavariStyles.typography.fontSize.xl, fontWeight: 'bold' }}>
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

      {healthStatus.checks.map(check => (
        <div key={check.id} style={styles.checkItem}>
          {getStatusIcon(check.status)}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>{check.name}</div>
            <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
              {check.message}
            </div>
            {check.details && (
              <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray500, marginTop: '4px' }}>
                {check.details}
              </div>
            )}
          </div>
        </div>
      ))}

      {healthStatus.lastChecked && (
        <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray500, marginTop: TavariStyles.spacing.md, textAlign: 'right' }}>
          Last checked: {new Date(healthStatus.lastChecked).toLocaleString()}
        </div>
      )}
    </div>
  );
};

export default CustomAgentSystemHealth;

