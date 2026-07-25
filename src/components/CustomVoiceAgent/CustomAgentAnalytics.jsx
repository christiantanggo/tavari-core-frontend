// components/CustomVoiceAgent/CustomAgentAnalytics.jsx
// Analytics dashboard for custom voice agents
import React, { useState, useEffect } from 'react';
import { BarChart3, Phone, Clock, TrendingUp, Users } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const CustomAgentAnalytics = ({ businessId, customVoiceAgentService }) => {
  const [analytics, setAnalytics] = useState(null);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    loadAnalytics();
  }, [businessId, dateRange]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const [analyticsData, callsData] = await Promise.all([
        customVoiceAgentService.getAnalytics(null, dateRange),
        customVoiceAgentService.getCalls(null, { ...dateRange, limit: 50 }),
      ]);
      setAnalytics(analyticsData);
      setCalls(callsData);
    } catch (error) {
      console.error('Error loading analytics:', error);
      toast.error('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '48px' }}>
        <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600 }}>Loading analytics...</div>
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
    dateRange: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.xl,
      alignItems: 'center',
    },
    input: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
    },
    callsList: {
      marginTop: TavariStyles.spacing.xl,
    },
    callItem: {
      padding: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.dateRange}>
        <label style={{ fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '600' }}>
          Date Range:
        </label>
        <input
          type="date"
          value={dateRange.start}
          onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
          style={styles.input}
        />
        <span>to</span>
        <input
          type="date"
          value={dateRange.end}
          onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
          style={styles.input}
        />
      </div>

      <div style={styles.callsList}>
        <h3 style={{
          fontSize: TavariStyles.typography.fontSize.lg,
          fontWeight: TavariStyles.typography.fontWeight.semibold,
          marginBottom: TavariStyles.spacing.md,
        }}>
          Recent Calls
        </h3>
        {calls.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: TavariStyles.colors.gray600 }}>
            No calls in this date range
          </div>
        ) : (
          calls.map(call => (
            <div key={call.id} style={styles.callItem}>
              <div>
                <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                  {call.phone_number || 'Unknown'}
                </div>
                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                  {new Date(call.created_at).toLocaleString()}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                  {call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}:${String(call.duration_seconds % 60).padStart(2, '0')}` : 'N/A'}
                </div>
                <div style={{
                  fontSize: '13px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: call.was_answered ? '#d1fae5' : '#fee2e2',
                  color: call.was_answered ? '#065f46' : '#991b1b',
                  display: 'inline-block',
                }}>
                  {call.status || 'unknown'}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CustomAgentAnalytics;

