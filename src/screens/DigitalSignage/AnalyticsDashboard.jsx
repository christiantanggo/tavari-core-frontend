// src/screens/DigitalSignage/AnalyticsDashboard.jsx
import React, { useState, useEffect } from 'react';
import { FiBarChart2, FiMonitor, FiPlay, FiClock, FiTrendingUp } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import useDigitalSignage from '../../hooks/useDigitalSignage';

const AnalyticsDashboard = ({ embedded = false }) => {
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'AnalyticsDashboard'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  const {
    screens,
    content,
    schedules,
    loading
  } = useDigitalSignage();

  useEffect(() => {
    if (auth.selectedBusinessId) {
      // Load analytics data
    }
  }, [auth.selectedBusinessId, dateRange]);

  const canViewAnalytics = hasPermission('digital_signage.analytics.view') || hasElevatedPrivileges();

  const styles = {
    container: {
      ...TavariStyles.layouts.container,
      padding: embedded ? 0 : TavariStyles.spacing.xl,
      paddingTop: embedded ? 0 : undefined
    },
    header: {
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      ...TavariStyles.typography.heading.h1
    },
    dateRange: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg
    },
    dateInput: {
      ...TavariStyles.components.input,
      padding: TavariStyles.spacing.sm
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl
    },
    statCard: {
      ...TavariStyles.components.card,
      padding: TavariStyles.spacing.lg
    },
    statValue: {
      ...TavariStyles.typography.heading.h2,
      marginBottom: TavariStyles.spacing.xs
    },
    statLabel: {
      ...TavariStyles.typography.body,
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    comingSoon: {
      textAlign: 'center',
      padding: TavariStyles.spacing['4xl'],
      color: TavariStyles.colors.gray600
    }
  };

  const contentView = (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>
          <FiBarChart2 style={{ marginRight: TavariStyles.spacing.sm, verticalAlign: 'middle' }} />
          Analytics
        </h1>
      </div>

      <div style={styles.dateRange}>
        <input
          type="date"
          style={styles.dateInput}
          value={dateRange.start}
          onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
        />
        <span style={{ alignSelf: 'center' }}>to</span>
        <input
          type="date"
          style={styles.dateInput}
          value={dateRange.end}
          onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
        />
      </div>

      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{screens.length}</div>
          <div style={styles.statLabel}>Active Screens</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{content.length}</div>
          <div style={styles.statLabel}>Total Content</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{schedules.length}</div>
          <div style={styles.statLabel}>Active Schedules</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>0</div>
          <div style={styles.statLabel}>Total Playbacks</div>
        </div>
      </div>

      <div style={styles.comingSoon}>
        <FiBarChart2 size={64} style={{ marginBottom: TavariStyles.spacing.lg, opacity: 0.3 }} />
        <h3>Analytics Dashboard</h3>
        <p>Detailed analytics and reporting coming soon</p>
      </div>
    </div>
  );

  if (embedded) {
    return contentView;
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper>
        <PermissionGate permission="digital_signage.analytics.view">
          {contentView}
        </PermissionGate>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default AnalyticsDashboard;



