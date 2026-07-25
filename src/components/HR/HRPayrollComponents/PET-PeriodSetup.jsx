// components/HR/HRPayrollComponents/PET-PeriodSetup.jsx - Pay Period Setup Component
import React from 'react';
import { TavariStyles } from '../../../utils/TavariStyles';

const PETPeriodSetup = ({ 
  selectedPeriod, 
  setSelectedPeriod, 
  payrollRun, 
  loading, 
  onCreatePayrollRun,
  onCreatePayrollRunFromSchedule,
  onShowDraftLookup,
  saveMessage,
  error 
  }) => {
  const hasScheduleModule = typeof onCreatePayrollRunFromSchedule === 'function';

  const styles = {
    section: {
      marginBottom: TavariStyles.spacing?.lg || '16px',
      backgroundColor: TavariStyles.colors?.white || '#ffffff',
      padding: TavariStyles.spacing?.lg || '16px',
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      border: `1px solid ${TavariStyles.colors?.gray200 || '#e5e7eb'}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    },
    sectionTitle: {
      fontSize: TavariStyles.typography?.fontSize?.xl || '18px',
      fontWeight: TavariStyles.typography?.fontWeight?.bold || '700',
      marginBottom: TavariStyles.spacing?.md || '12px',
      color: TavariStyles.colors?.gray800 || '#1f2937',
      margin: '0 0 12px 0'
    },
    periodLayout: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing?.md || '12px',
      width: '100%'
    },
    dateRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: TavariStyles.spacing?.md || '12px',
      width: '100%',
      alignItems: 'end'
    },
    buttonRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: TavariStyles.spacing?.md || '12px',
      width: '100%',
      alignItems: 'stretch'
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing?.xs || '4px',
      minWidth: 0,
      width: '100%'
    },
    label: {
      fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
      fontWeight: TavariStyles.typography?.fontWeight?.medium || '500',
      color: TavariStyles.colors?.gray700 || '#374151'
    },
    input: {
      padding: '12px 16px',
      border: `1px solid ${TavariStyles.colors?.gray300 || '#d1d5db'}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
      transition: 'border-color 0.2s',
      fontFamily: 'inherit',
      backgroundColor: TavariStyles.colors?.white || '#ffffff',
      width: '100%',
      boxSizing: 'border-box'
    },
    inputDisabled: {
      backgroundColor: TavariStyles.colors?.gray100 || '#f3f4f6',
      cursor: 'not-allowed',
      opacity: 0.6
    },
    buttonCell: {
      minWidth: 0,
      display: 'flex'
    },
    tertiaryButton: {
      backgroundColor: TavariStyles.colors?.gray800 || '#1f2937',
      color: TavariStyles.colors?.white || '#ffffff',
      border: 'none'
    },
    button: {
      padding: '12px 16px',
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      border: 'none',
      fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
      fontWeight: TavariStyles.typography?.fontWeight?.semibold || '600',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      backgroundColor: TavariStyles.colors?.primary || '#008080',
      color: TavariStyles.colors?.white || '#ffffff',
      width: '100%',
      boxSizing: 'border-box',
      textAlign: 'center',
      lineHeight: 1.35
    },
    secondaryButton: {
      backgroundColor: TavariStyles.colors?.white || '#ffffff',
      color: TavariStyles.colors?.primary || '#008080',
      border: `1px solid ${TavariStyles.colors?.primary || '#008080'}`
    },
    disabledButton: {
      opacity: 0.6,
      cursor: 'not-allowed'
    },
    successBanner: {
      backgroundColor: (TavariStyles.colors?.success || '#10b981') + '20',
      color: TavariStyles.colors?.success || '#10b981',
      padding: TavariStyles.spacing?.md || '12px',
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginTop: TavariStyles.spacing?.md || '12px',
      whiteSpace: 'pre-line',
      border: `1px solid ${TavariStyles.colors?.success || '#10b981'}`
    },
    errorBanner: {
      backgroundColor: (TavariStyles.colors?.danger || '#ef4444') + '20',
      color: TavariStyles.colors?.danger || '#ef4444',
      padding: TavariStyles.spacing?.md || '12px',
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing?.md || '12px',
      border: `1px solid ${TavariStyles.colors?.danger || '#ef4444'}`
    }
  };

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Pay Period Setup</h3>
      
      {error && (
        <div style={styles.errorBanner}>
          {error}
        </div>
      )}

      <div style={styles.periodLayout}>
        <div style={styles.dateRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Start Date:</label>
            <input 
              type="date" 
              style={{
                ...styles.input,
                ...(payrollRun || loading ? styles.inputDisabled : {})
              }}
              value={selectedPeriod.start} 
              onChange={(e) => setSelectedPeriod(prev => ({ ...prev, start: e.target.value }))} 
              disabled={!!payrollRun || loading} 
            />
          </div>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>End Date:</label>
            <input 
              type="date" 
              style={{
                ...styles.input,
                ...(payrollRun || loading ? styles.inputDisabled : {})
              }}
              value={selectedPeriod.end} 
              onChange={(e) => setSelectedPeriod(prev => ({ ...prev, end: e.target.value }))} 
              disabled={!!payrollRun || loading} 
            />
          </div>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>Pay Date:</label>
            <input 
              type="date" 
              style={{
                ...styles.input,
                ...(payrollRun || loading ? styles.inputDisabled : {})
              }}
              value={selectedPeriod.payDate} 
              onChange={(e) => setSelectedPeriod(prev => ({ ...prev, payDate: e.target.value }))} 
              disabled={!!payrollRun || loading} 
            />
          </div>
        </div>

        <div
          style={{
            ...styles.buttonRow,
            gridTemplateColumns: hasScheduleModule
              ? 'repeat(3, minmax(0, 1fr))'
              : 'repeat(2, minmax(0, 1fr))'
          }}
        >
          <div style={styles.buttonCell}>
            <button 
              type="button"
              style={{ 
                ...styles.button, 
                ...(loading || payrollRun ? styles.disabledButton : {}) 
              }} 
              onClick={onCreatePayrollRun} 
              disabled={loading || !!payrollRun}
            >
              {loading ? 'Creating...' : payrollRun ? 'Payroll Run Created' : 'Create Payroll Run'}
            </button>
          </div>

          {hasScheduleModule && (
            <div style={styles.buttonCell}>
              <button
                type="button"
                style={{
                  ...styles.button,
                  ...styles.tertiaryButton,
                  ...(loading || payrollRun ? styles.disabledButton : {})
                }}
                onClick={onCreatePayrollRunFromSchedule}
                disabled={loading || !!payrollRun}
                title="Creates a draft payroll run and fills employee hours from completed time clock punches in this pay period (Scheduling / Timesheets)."
              >
                {loading ? 'Creating...' : payrollRun ? 'Payroll Run Created' : 'Create Payroll Run Using Schedule Module'}
              </button>
            </div>
          )}
          
          <div style={styles.buttonCell}>
            <button 
              type="button"
              style={{
                ...styles.button,
                ...styles.secondaryButton,
                ...(payrollRun ? styles.disabledButton : {})
              }}
              onClick={onShowDraftLookup}
              disabled={!!payrollRun}
            >
              Load Draft Payroll
            </button>
          </div>
        </div>
      </div>
      
      {saveMessage && (
        <div style={styles.successBanner}>{saveMessage}</div>
      )}
    </div>
  );
};

export default PETPeriodSetup;