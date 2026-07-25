import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatDateTimeForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';

const AccountingActivity = ({ embedded = false }) => {
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();
  const { authLoading } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingActivity'
  });
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const businessTimezone = getBusinessTimezone(selectedBusiness);

  const loadLogs = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    setLoadError('');
    try {
      const { data, error } = await supabase
        .from('accounting_audit_logs')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setLogs(data || []);
    } catch (error) {
      console.error('Failed to load accounting activity:', error);
      setLogs([]);
      setLoadError(error?.message || 'Failed to load accounting activity.');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  if (authLoading || !selectedBusinessId) return <div style={{ padding: 48, textAlign: 'center' }}>Loading...</div>;

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 100 }}>
      <h1 style={{ fontSize: embedded ? '1.25rem' : '1.5rem', marginBottom: 8 }}>Accounting Activity</h1>
      <p style={{ color: TavariStyles?.colors?.gray600, marginBottom: 16, fontSize: 14 }}>
        Recent accounting actions from Tavari, including settings changes, posting, reversals, exports, and workflow actions.
      </p>
      {loading ? (
        <p style={{ color: TavariStyles?.colors?.gray600 }}>Loading...</p>
      ) : loadError ? (
        <div style={styles.errorBox}>
          <p style={{ margin: 0, color: '#991b1b' }}>
            Failed to load accounting activity. The audit log may be incomplete until this is resolved.
          </p>
          <p style={{ margin: '8px 0 0', color: '#7f1d1d', fontSize: 13 }}>{loadError}</p>
          <button type="button" style={styles.retryButton} onClick={loadLogs}>Retry</button>
        </div>
      ) : logs.length === 0 ? (
        <p style={{ color: TavariStyles?.colors?.gray600 }}>No accounting activity yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={styles.th}>When</th>
                <th style={styles.th}>Action</th>
                <th style={styles.th}>Entity</th>
                <th style={styles.th}>Entity ID</th>
                <th style={styles.th}>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={styles.td}>{formatDateTimeForBusiness(log.created_at, businessTimezone)}</td>
                  <td style={styles.td}>{log.action}</td>
                  <td style={styles.td}>{log.entity_type}</td>
                  <td style={styles.td}>{log.entity_id || '—'}</td>
                  <td style={styles.td}>
                    <pre style={styles.pre}>{JSON.stringify(log.details || {}, null, 2)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const styles = {
  th: { textAlign: 'left', padding: 8, fontWeight: 600 },
  td: { padding: 8, verticalAlign: 'top' },
  errorBox: {
    border: '1px solid #fecaca',
    background: '#fef2f2',
    borderRadius: 8,
    padding: 12
  },
  retryButton: {
    marginTop: 12,
    padding: '8px 12px',
    borderRadius: 6,
    border: 'none',
    background: TavariStyles?.colors?.primary || '#008080',
    color: '#fff',
    cursor: 'pointer'
  },
  pre: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 13,
    color: TavariStyles?.colors?.gray700 || '#374151'
  }
};

export default AccountingActivity;
