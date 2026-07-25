// components/HR/HRPayrollComponents/YTDComponents/YTDPeriodAccordion.jsx - SIMPLIFIED
import React from 'react';
import { TavariStyles } from '../../../../utils/TavariStyles';
import { ChevronDown, ChevronUp } from 'lucide-react';
import TavariCheckbox from '../../../UI/TavariCheckbox';

// Helper to format YYYY-MM-DD strings without timezone conversion
const formatDateString = (dateStr) => {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
};

const YTDPeriodAccordion = ({
  period,
  isExpanded,
  onToggle,
  onUpdate,
  formatTaxAmount,
  styles
}) => {
  const periodTotal = parseFloat(period.grossEarnings) || 0;

  return (
    <div style={styles.accordionItem}>
      <div
        style={styles.accordionHeader}
        onClick={onToggle}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = TavariStyles.colors.gray100}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = TavariStyles.colors.gray50}
      >
        <div style={styles.accordionTitle}>
          Period {period.periodNumber}: {formatDateString(period.startDate)} - {formatDateString(period.endDate)}
        </div>
        <div style={styles.accordionSubtitle}>
          Pay Date: {formatDateString(period.payDate)}
        </div>
        <div style={styles.accordionSubtitle}>
          {period.totalHours ? `${period.totalHours} hrs` : 'No hours'} | ${formatTaxAmount(periodTotal)}
        </div>
        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </div>

      {isExpanded && (
        <div style={styles.accordionContent}>
          <div style={styles.periodGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Period Start Date:</label>
              <input
                type="date"
                style={styles.input}
                value={period.startDate}
                onChange={(e) => onUpdate('startDate', e.target.value)}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Period End Date:</label>
              <input
                type="date"
                style={styles.input}
                value={period.endDate}
                onChange={(e) => onUpdate('endDate', e.target.value)}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Pay Date:</label>
              <input
                type="date"
                style={styles.input}
                value={period.payDate}
                onChange={(e) => onUpdate('payDate', e.target.value)}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Total Hours (for this period):</label>
              <input
                type="number"
                step="0.01"
                min="0"
                style={styles.input}
                value={period.totalHours}
                onChange={(e) => onUpdate('totalHours', e.target.value)}
                placeholder="0.00"
              />
              <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px', fontStyle: 'italic' }}>
                Total insurable hours worked in this period
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Total Gross Earnings:</label>
              <input
                type="number"
                step="0.01"
                min="0"
                style={styles.input}
                value={period.grossEarnings}
                onChange={(e) => onUpdate('grossEarnings', e.target.value)}
                placeholder="0.00"
              />
              <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px', fontStyle: 'italic' }}>
                Total earnings before deductions
              </div>
            </div>
          </div>

          <div style={{ marginTop: TavariStyles.spacing.md }}>
            <TavariCheckbox
              checked={period.vacationPayIncluded}
              onChange={(checked) => onUpdate('vacationPayIncluded', checked)}
              label="Vacation Pay Included This Period"
              size="md"
            />
            <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px', marginLeft: '28px', fontStyle: 'italic' }}>
              Check if vacation pay was included in this pay period (for ROE reporting)
            </div>
          </div>

          <div style={styles.periodTotal}>
            <span style={styles.totalLabel}>Period Total:</span>
            <span style={styles.totalValue}>${formatTaxAmount(periodTotal)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default YTDPeriodAccordion;