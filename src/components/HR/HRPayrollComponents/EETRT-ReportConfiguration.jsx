// components/HR/HRPayrollComponents/EETRT-ReportConfiguration.jsx
import React from 'react';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const EETRT_ReportConfiguration = ({ selectedEmployee, reportConfig, setReportConfig }) => {
  const ROE_REASONS = {
    'A': 'Shortage of work (layoff)',
    'B': 'Strike or lockout',
    'C': 'Return to school',
    'D': 'Disease or injury',
    'E': 'Quit',
    'F': 'Other',
    'G': 'Retirement',
    'H': 'Work sharing',
    'I': 'Compassionate care benefits',
    'J': 'Parental benefits',
    'K': 'Dismissal',
    'L': 'Leave of absence',
    'M': 'Maternity benefits',
    'N': 'End of contract or term employment'
  };

  const styles = {
    section: {
      marginBottom: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.lg,
      borderRadius: '12px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.md,
      color: TavariStyles.colors.gray800
    },
    configGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: TavariStyles.spacing.md
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs,
      marginBottom: TavariStyles.spacing.md
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    input: {
      padding: '12px 16px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: '6px',
      fontSize: TavariStyles.typography.fontSize.sm
    },
    select: {
      padding: '12px 16px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      backgroundColor: TavariStyles.colors.white
    }
  };

  if (!selectedEmployee) return null;

  return (
    <div style={styles.section}>
      <h4 style={styles.sectionTitle}>Report Configuration</h4>
      <div style={styles.configGrid}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Report Type:</label>
          <TavariCheckbox
            checked={reportConfig.isT4Report}
            onChange={(checked) => setReportConfig(prev => ({ 
              ...prev, 
              isT4Report: checked,
              separationReason: checked ? '' : prev.separationReason,
              expectedReturnDate: checked ? '' : prev.expectedReturnDate
            }))}
            label="This is a T4 tax report (hides separation/ROE fields)"
            size="md"
          />
          <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.xs }}>
            Check this for year-end T4 reports. Uncheck for ROE/separation reports.
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Date Range:</label>
          <select
            style={styles.select}
            value={reportConfig.dateRangeType}
            onChange={(e) => setReportConfig(prev => ({ ...prev, dateRangeType: e.target.value }))}
          >
            <option value="rolling_12_months">Rolling 12 Months from Last Day</option>
            <option value="calendar_year">Current Calendar Year</option>
            <option value="previous_year">Previous Calendar Year (T4)</option>
            <option value="employment_period">Full Employment Period</option>
            <option value="custom">Custom Date Range</option>
          </select>
        </div>

        {!reportConfig.isT4Report && (
          <div style={styles.formGroup}>
            <label style={styles.label}>Last Day Worked:</label>
            <input
              type="date"
              style={styles.input}
              value={reportConfig.lastDayWorked}
              onChange={(e) => setReportConfig(prev => ({ ...prev, lastDayWorked: e.target.value }))}
            />
          </div>
        )}

        {!reportConfig.isT4Report && (
          <div style={styles.formGroup}>
            <label style={styles.label}>Separation Reason:</label>
            <select
              style={styles.select}
              value={reportConfig.separationReason}
              onChange={(e) => setReportConfig(prev => ({ ...prev, separationReason: e.target.value }))}
            >
              <option value="">Select reason...</option>
              {Object.entries(ROE_REASONS).map(([code, description]) => (
                <option key={code} value={`${code} - ${description}`}>
                  {code} - {description}
                </option>
              ))}
            </select>
          </div>
        )}

        {!reportConfig.isT4Report && (
          <div style={styles.formGroup}>
            <label style={styles.label}>Expected Return Date (if applicable):</label>
            <input
              type="date"
              style={styles.input}
              value={reportConfig.expectedReturnDate}
              onChange={(e) => setReportConfig(prev => ({ ...prev, expectedReturnDate: e.target.value }))}
            />
          </div>
        )}

        {reportConfig.dateRangeType === 'custom' && (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                {reportConfig.isT4Report ? 'Payroll Period Start:' : 'Custom Start Date:'}
              </label>
              <input
                type="date"
                style={styles.input}
                value={reportConfig.customStartDate}
                onChange={(e) => setReportConfig(prev => ({ ...prev, customStartDate: e.target.value }))}
              />
              {reportConfig.isT4Report && (
                <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.xs }}>
                  First day of the pay period to include (not pay date).
                </div>
              )}
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                {reportConfig.isT4Report ? 'Payroll Period End:' : 'Custom End Date:'}
              </label>
              <input
                type="date"
                style={styles.input}
                value={reportConfig.customEndDate}
                onChange={(e) => setReportConfig(prev => ({ ...prev, customEndDate: e.target.value }))}
              />
              {reportConfig.isT4Report && (
                <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.xs }}>
                  Last day of the pay period to include (not pay date).
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default EETRT_ReportConfiguration;