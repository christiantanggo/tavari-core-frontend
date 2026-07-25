// components/VoiceAgent/PhoneCallDiagnostic.jsx
// Diagnostic tool to check why real phone calls aren't working
import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, XCircle, Phone, RefreshCw } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const PhoneCallDiagnostic = ({ agentId, businessId }) => {
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState([]);
  const [recentCalls, setRecentCalls] = useState([]);
  const [webhookLogs, setWebhookLogs] = useState([]);

  useEffect(() => {
    if (agentId && businessId) {
      loadDiagnostics();
    }
  }, [agentId, businessId]);

  const loadDiagnostics = async () => {
    setLoading(true);
    try {
      // Load agent
      const { data: agentData } = await supabase
        .from('voice_agents')
        .select('*')
        .eq('id', agentId)
        .single();
      
      setAgent(agentData);

      // Load recent calls
      const { data: calls } = await supabase
        .from('voice_agent_calls')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(10);
      
      setRecentCalls(calls || []);

      // Load recent webhook logs
      const { data: logs } = await supabase
        .from('voice_agent_logs')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(20);
      
      setWebhookLogs(logs || []);

      // Run checks
      runChecks(agentData, calls || [], logs || []);
    } catch (error) {
      console.error('Error loading diagnostics:', error);
      toast.error('Failed to load diagnostics');
    } finally {
      setLoading(false);
    }
  };

  const runChecks = (agentData, calls, logs) => {
    const newChecks = [];

    // Check 1: Agent exists and has Vapi assistant ID
    newChecks.push({
      id: 'agent_exists',
      name: 'Agent Configuration',
      status: agentData?.vapi_assistant_id ? 'pass' : 'fail',
      message: agentData?.vapi_assistant_id
        ? `✅ Agent has Vapi Assistant ID: ${agentData.vapi_assistant_id}`
        : '❌ Agent missing Vapi Assistant ID - assistant not created in Vapi',
      critical: true,
    });

    // Check 2: Phone number configured
    newChecks.push({
      id: 'phone_number',
      name: 'Phone Number',
      status: agentData?.phone_number ? 'pass' : 'fail',
      message: agentData?.phone_number
        ? `✅ Phone number: ${agentData.phone_number}`
        : '❌ No phone number configured',
      critical: true,
    });

    // Check 3: Recent calls exist
    newChecks.push({
      id: 'recent_calls',
      name: 'Call Activity',
      status: calls.length > 0 ? 'pass' : 'warning',
      message: calls.length > 0
        ? `✅ Found ${calls.length} recent call(s) in database`
        : '⚠️ No calls found in database - either no calls made or webhook not receiving them',
      critical: false,
    });

    // Check 4: Webhook logs exist
    newChecks.push({
      id: 'webhook_logs',
      name: 'Webhook Activity',
      status: logs.length > 0 ? 'pass' : 'fail',
      message: logs.length > 0
        ? `✅ Found ${logs.length} webhook log(s) - webhook is being called`
        : '❌ No webhook logs found - webhook is NOT being called by Vapi',
      critical: true,
    });

    // Check 5: Recent webhook activity (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentLogs = logs.filter(log => new Date(log.created_at) > oneHourAgo);
    newChecks.push({
      id: 'recent_webhook',
      name: 'Recent Webhook Activity',
      status: recentLogs.length > 0 ? 'pass' : 'warning',
      message: recentLogs.length > 0
        ? `✅ ${recentLogs.length} webhook call(s) in last hour`
        : '⚠️ No webhook calls in last hour - check if you made a test call',
      critical: false,
    });

    // Check 6: Call status analysis
    if (calls.length > 0) {
      const endedCalls = calls.filter(c => c.status === 'ended');
      const failedCalls = calls.filter(c => c.status === 'failed' || c.was_answered === false);
      
      newChecks.push({
        id: 'call_status',
        name: 'Call Status Analysis',
        status: failedCalls.length === 0 ? 'pass' : 'warning',
        message: `📊 ${endedCalls.length} ended, ${failedCalls.length} failed/not answered`,
        critical: false,
      });
    }

    // Check 7: Webhook URL format
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const expectedWebhookUrl = `${supabaseUrl}/functions/v1/voice-agent-webhook`;
    newChecks.push({
      id: 'webhook_url',
      name: 'Webhook URL Configuration',
      status: supabaseUrl ? 'info' : 'fail',
      message: supabaseUrl
        ? `ℹ️ Expected webhook URL: ${expectedWebhookUrl}\n⚠️ Verify this is set in Vapi dashboard!`
        : '❌ SUPABASE_URL not configured',
      critical: false,
      action: 'manual_check',
    });

    setChecks(newChecks);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pass':
        return <CheckCircle size={20} color="#10b981" />;
      case 'fail':
        return <XCircle size={20} color="#ef4444" />;
      case 'warning':
        return <AlertTriangle size={20} color="#f59e0b" />;
      default:
        return <AlertTriangle size={20} color="#6b7280" />;
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
      paddingBottom: TavariStyles.spacing.md,
      borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
    checkItem: {
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      marginBottom: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.gray50,
    },
    checkHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.xs,
    },
    checkName: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
    },
    checkMessage: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      whiteSpace: 'pre-line',
      marginLeft: '28px',
    },
    criticalBadge: {
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '10px',
      fontWeight: 'bold',
      backgroundColor: '#ef4444',
      color: 'white',
      marginLeft: '8px',
    },
    refreshButton: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
    },
    summary: {
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.lg,
      backgroundColor: '#fee2e2',
      border: '1px solid #ef4444',
    },
    actionBox: {
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginTop: TavariStyles.spacing.md,
      backgroundColor: '#fef3c7',
      border: '1px solid #f59e0b',
    },
  };

  if (loading) {
    return <div>Loading diagnostics...</div>;
  }

  const criticalFailures = checks.filter(c => c.status === 'fail' && c.critical);
  const allPassed = checks.every(c => c.status === 'pass' || c.status === 'info');

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>
          <Phone size={24} />
          Phone Call Diagnostic
        </h2>
        <button onClick={loadDiagnostics} style={styles.refreshButton}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {criticalFailures.length > 0 && (
        <div style={styles.summary}>
          <strong>🚨 Critical Issues Found:</strong>
          <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
            {criticalFailures.map(check => (
              <li key={check.id}>{check.message}</li>
            ))}
          </ul>
        </div>
      )}

      {checks.map((check) => (
        <div key={check.id} style={styles.checkItem}>
          <div style={styles.checkHeader}>
            {getStatusIcon(check.status)}
            <span style={styles.checkName}>
              {check.name}
              {check.critical && <span style={styles.criticalBadge}>CRITICAL</span>}
            </span>
          </div>
          <div style={styles.checkMessage}>{check.message}</div>
          {check.action === 'manual_check' && (
            <div style={styles.actionBox}>
              <strong>⚠️ Manual Check Required:</strong>
              <ol style={{ marginTop: '8px', paddingLeft: '20px' }}>
                <li>Go to Vapi Dashboard (https://dashboard.vapi.ai)</li>
                <li>Find your assistant (ID: {agent?.vapi_assistant_id || 'N/A'})</li>
                <li>Check if "Server URL" is set to: <code>{import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-agent-webhook</code></li>
                <li>If empty or wrong, update it!</li>
              </ol>
            </div>
          )}
        </div>
      ))}

      {recentCalls.length > 0 && (
        <div style={{ marginTop: TavariStyles.spacing.xl }}>
          <h3 style={{ marginBottom: TavariStyles.spacing.md }}>Recent Calls ({recentCalls.length})</h3>
          {recentCalls.slice(0, 5).map((call) => (
            <div key={call.id} style={styles.checkItem}>
              <div><strong>Call ID:</strong> {call.vapi_call_id || 'N/A'}</div>
              <div><strong>Status:</strong> {call.status || 'unknown'}</div>
              <div><strong>Phone:</strong> {call.phone_number || 'N/A'}</div>
              <div><strong>Time:</strong> {new Date(call.created_at).toLocaleString()}</div>
              {call.was_answered === false && (
                <div style={{ color: '#ef4444', marginTop: '4px' }}>
                  ⚠️ Call was not answered
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!allPassed && (
        <div style={styles.actionBox}>
          <strong>🔧 Next Steps:</strong>
          <ol style={{ marginTop: '8px', paddingLeft: '20px' }}>
            {criticalFailures.some(c => c.id === 'agent_exists') && (
              <li>Agent is missing Vapi Assistant ID - recreate the assistant</li>
            )}
            {criticalFailures.some(c => c.id === 'phone_number') && (
              <li>Configure a phone number for this agent</li>
            )}
            {criticalFailures.some(c => c.id === 'webhook_logs') && (
              <>
                <li>Check Vapi Dashboard - verify webhook URL is set correctly</li>
                <li>Make a test call and check Supabase Edge Function logs</li>
                <li>Verify the webhook endpoint is deployed and accessible</li>
              </>
            )}
          </ol>
        </div>
      )}
    </div>
  );
};

export default PhoneCallDiagnostic;

