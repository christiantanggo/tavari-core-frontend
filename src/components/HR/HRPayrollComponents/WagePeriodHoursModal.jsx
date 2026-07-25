// components/HR/HRPayrollComponents/WagePeriodHoursModal.jsx
import React, { useState, useEffect } from 'react';
import { SecurityWrapper } from '../../../Security';
import { TavariStyles } from '../../../utils/TavariStyles';

const WagePeriodHoursModal = ({
  isOpen,
  onClose,
  employee,
  wagePeriods,
  initialHours,
  onSave
}) => {
  const [periodHours, setPeriodHours] = useState([]);

  useEffect(() => {
    if (isOpen && wagePeriods && wagePeriods.length > 0) {
      // Initialize with existing hours or zeros
      const initialized = wagePeriods.map((period, index) => ({
        wage: period.wage,
        period_label: `${period.startDate} to ${period.endDate}`,
        startDate: period.startDate,
        endDate: period.endDate,
        daysInPeriod: period.daysInPeriod,
        regular_hours: initialHours?.wage_period_hours?.[index]?.regular_hours || 0,
        overtime_hours: initialHours?.wage_period_hours?.[index]?.overtime_hours || 0
      }));
      setPeriodHours(initialized);
    }
  }, [isOpen, wagePeriods, initialHours]);

  const updatePeriodHours = (index, field, value) => {
    const sanitized = parseFloat(value) || 0;
    setPeriodHours(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        [field]: sanitized
      };
      return updated;
    });
  };

  const calculateTotals = () => {
    const totalRegular = periodHours.reduce((sum, period) => sum + (parseFloat(period.regular_hours) || 0), 0);
    const totalOvertime = periodHours.reduce((sum, period) => sum + (parseFloat(period.overtime_hours) || 0), 0);
    const totalHours = totalRegular + totalOvertime;
    
    return {
      total_hours: totalHours,
      overtime_hours: totalOvertime,
      regular_hours: totalRegular,
      wage_period_hours: periodHours
    };
  };

  const handleSave = () => {
    const totals = calculateTotals();
    onSave(totals);
    onClose();
  };

  const totals = calculateTotals();

  if (!isOpen) return null;

  return (
    <SecurityWrapper>
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.header}>
            <div>
              <h3 style={styles.title}>
                ⚠️ Wage Changed During Pay Period
              </h3>
              <p style={styles.subtitle}>
                {employee?.first_name} {employee?.last_name} - Enter hours at each wage rate
              </p>
            </div>
            <button onClick={onClose} style={styles.closeButton}>×</button>
          </div>

          <div style={styles.body}>
            <div style={styles.infoBox}>
              <strong>Important:</strong> This employee's wage changed during this pay period.
              Please enter the hours worked at each wage rate separately.
              The system will automatically calculate the correct pay for each period.
            </div>

            <div style={styles.periodsGrid}>
              {periodHours.map((period, index) => (
                <div key={index} style={styles.periodCard}>
                  <div style={styles.periodHeader}>
                    <div style={styles.periodLabel}>{period.period_label}</div>
                    <div style={styles.periodWage}>${period.wage.toFixed(2)}/hr</div>
                  </div>

                  <div style={styles.periodBody}>
                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Regular Hours</label>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        max="168"
                        style={styles.input}
                        value={period.regular_hours || ''}
                        onChange={(e) => updatePeriodHours(index, 'regular_hours', e.target.value)}
                        onFocus={(e) => e.target.select()}
                        placeholder="0.00"
                        autoFocus={index === 0}
                      />
                    </div>

                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Overtime Hours</label>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        max="80"
                        style={styles.input}
                        value={period.overtime_hours || ''}
                        onChange={(e) => updatePeriodHours(index, 'overtime_hours', e.target.value)}
                        onFocus={(e) => e.target.select()}
                        placeholder="0.00"
                      />
                    </div>

                    <div style={styles.periodSummary}>
                      <div style={styles.summaryLabel}>Period Total:</div>
                      <div style={styles.summaryValue}>
                        {((period.regular_hours || 0) + (period.overtime_hours || 0)).toFixed(2)} hrs
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={styles.totalsSection}>
              <h4 style={styles.totalsTitle}>Pay Period Totals</h4>
              <div style={styles.totalsGrid}>
                <div style={styles.totalItem}>
                  <span style={styles.totalLabel}>Total Regular Hours:</span>
                  <span style={styles.totalValue}>{totals.regular_hours.toFixed(2)} hrs</span>
                </div>
                <div style={styles.totalItem}>
                  <span style={styles.totalLabel}>Total Overtime Hours:</span>
                  <span style={styles.totalValue}>{totals.overtime_hours.toFixed(2)} hrs</span>
                </div>
                <div style={{...styles.totalItem, ...styles.totalItemFinal}}>
                  <span style={styles.totalLabel}><strong>TOTAL HOURS WORKED:</strong></span>
                  <span style={{...styles.totalValue, fontSize: '20px', color: '#14b8a6'}}>
                    <strong>{totals.total_hours.toFixed(2)} hrs</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div style={styles.footer}>
            <button onClick={onClose} style={styles.cancelButton}>
              Cancel
            </button>
            <button 
              onClick={handleSave} 
              style={styles.saveButton}
              disabled={totals.total_hours === 0}
            >
              Save Hours
            </button>
          </div>
        </div>
      </div>
    </SecurityWrapper>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    zIndex: 2000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  },
  modal: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '1000px',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
    border: '3px solid #f59e0b'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '24px',
    borderBottom: '2px solid #f59e0b',
    backgroundColor: '#fffbeb'
  },
  title: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#92400e',
    margin: 0,
    marginBottom: '4px'
  },
  subtitle: {
    fontSize: '14px',
    color: '#92400e',
    margin: 0,
    fontWeight: '500'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '28px',
    color: '#92400e',
    cursor: 'pointer',
    padding: '0',
    lineHeight: '1',
    fontWeight: 'bold'
  },
  body: {
    flex: 1,
    padding: '24px',
    overflowY: 'auto'
  },
  infoBox: {
    padding: '16px',
    backgroundColor: '#fef3c7',
    border: '2px solid #f59e0b',
    borderRadius: '8px',
    marginBottom: '24px',
    fontSize: '14px',
    color: '#92400e',
    lineHeight: '1.5'
  },
  periodsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '20px',
    marginBottom: '24px'
  },
  periodCard: {
    backgroundColor: '#f0fdfa',
    border: '2px solid #14b8a6',
    borderRadius: '8px',
    overflow: 'hidden'
  },
  periodHeader: {
    padding: '16px',
    backgroundColor: '#14b8a6',
    color: '#ffffff'
  },
  periodLabel: {
    fontSize: '14px',
    fontWeight: '600',
    marginBottom: '4px'
  },
  periodWage: {
    fontSize: '24px',
    fontWeight: '700'
  },
  periodBody: {
    padding: '16px'
  },
  inputGroup: {
    marginBottom: '16px'
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '6px'
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '16px',
    fontFamily: 'inherit',
    transition: 'border-color 0.2s'
  },
  periodSummary: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    backgroundColor: '#ffffff',
    border: '1px solid #14b8a6',
    borderRadius: '6px',
    marginTop: '8px'
  },
  summaryLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#115e59'
  },
  summaryValue: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#14b8a6'
  },
  totalsSection: {
    padding: '20px',
    backgroundColor: '#f9fafb',
    border: '2px solid #e5e7eb',
    borderRadius: '8px'
  },
  totalsTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#374151',
    margin: 0,
    marginBottom: '16px',
    paddingBottom: '12px',
    borderBottom: '2px solid #e5e7eb'
  },
  totalsGrid: {
    display: 'grid',
    gap: '12px'
  },
  totalItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 0',
    fontSize: '14px'
  },
  totalItemFinal: {
    borderTop: '2px solid #14b8a6',
    paddingTop: '16px',
    marginTop: '8px'
  },
  totalLabel: {
    color: '#374151',
    fontWeight: '500'
  },
  totalValue: {
    color: '#1f2937',
    fontWeight: '600',
    fontSize: '16px'
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '20px 24px',
    borderTop: '2px solid #f59e0b',
    backgroundColor: '#fffbeb'
  },
  cancelButton: {
    padding: '12px 24px',
    backgroundColor: '#ffffff',
    border: '2px solid #d1d5db',
    color: '#374151',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  saveButton: {
    padding: '12px 24px',
    backgroundColor: '#14b8a6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  }
};

export default WagePeriodHoursModal;