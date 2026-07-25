// components/HR/HRPayrollComponents/EETRT-DataPreview.jsx
import React from 'react';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';

const EETRT_DataPreview = ({ calculatedData, generating, onGenerateReport, onGenerateDeductionsReport }) => {
  const { formatTaxAmount } = useTaxCalculations();
  
  const PAYMENT_FREQUENCIES = {
    'weekly': { label: 'Weekly (52 periods/year)', periods: 52 },
    'bi_weekly': { label: 'Bi-Weekly (26 periods/year)', periods: 26 },
    'semi_monthly': { label: 'Semi-Monthly (24 periods/year)', periods: 24 },
    'monthly': { label: 'Monthly (12 periods/year)', periods: 12 }
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
    button: {
      padding: '14px 28px',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: '6px',
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      transition: 'all 0.2s ease'
    },
    disabledButton: {
      opacity: 0.6,
      cursor: 'not-allowed'
    }
  };

  if (!calculatedData) return null;

  return (
    <div style={styles.section}>
      <h4 style={styles.sectionTitle}>Report Preview</h4>
      <div style={{ backgroundColor: TavariStyles.colors.primary + '08', padding: TavariStyles.spacing.lg, borderRadius: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: TavariStyles.spacing.sm }}>
          <span>Employee:</span>
          <span style={{ fontWeight: TavariStyles.typography.fontWeight.semibold }}>
            {calculatedData.employee.fullName}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: TavariStyles.spacing.sm }}>
          <span>Payment Frequency:</span>
          <span style={{ fontWeight: TavariStyles.typography.fontWeight.semibold }}>
            {PAYMENT_FREQUENCIES[calculatedData.paymentFrequency.effective]?.label}
            {calculatedData.paymentFrequency.isOverridden && (
              <span style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.warning }}>
                {' '}(Override)
              </span>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: TavariStyles.spacing.sm }}>
          <span>Report Period:</span>
          <span style={{ fontWeight: TavariStyles.typography.fontWeight.semibold }}>
            {calculatedData.calculationPeriod.startDate} to {calculatedData.calculationPeriod.endDate}
          </span>
        </div>
        {calculatedData.roeData && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: TavariStyles.spacing.sm }}>
              <span>ROE Insurable Earnings:</span>
              <span style={{ fontWeight: TavariStyles.typography.fontWeight.semibold, backgroundColor: TavariStyles.colors.warning + '30', padding: '2px 6px', borderRadius: '4px' }}>
                ${formatTaxAmount ? formatTaxAmount(calculatedData.roeData.totalInsurableEarnings) : calculatedData.roeData.totalInsurableEarnings.toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: TavariStyles.spacing.sm }}>
              <span>Average Weekly Earnings:</span>
              <span style={{ fontWeight: TavariStyles.typography.fontWeight.semibold }}>
                ${formatTaxAmount ? formatTaxAmount(calculatedData.roeData.averageWeeklyEarnings) : calculatedData.roeData.averageWeeklyEarnings.toFixed(2)}
              </span>
            </div>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: TavariStyles.spacing.sm }}>
          <span>T4 Employment Income:</span>
          <span style={{ fontWeight: TavariStyles.typography.fontWeight.semibold, backgroundColor: TavariStyles.colors.warning + '30', padding: '2px 6px', borderRadius: '4px' }}>
            ${formatTaxAmount ? formatTaxAmount(calculatedData.t4Data.box14_employmentIncome) : calculatedData.t4Data.box14_employmentIncome.toFixed(2)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: TavariStyles.spacing.sm }}>
          <span>Total Tax Deducted:</span>
          <span style={{ fontWeight: TavariStyles.typography.fontWeight.semibold }}>
            ${formatTaxAmount ? formatTaxAmount(calculatedData.t4Data.box22_incomeTax) : calculatedData.t4Data.box22_incomeTax.toFixed(2)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: TavariStyles.spacing.sm }}>
          <span>Pay Periods Included:</span>
          <span style={{ fontWeight: TavariStyles.typography.fontWeight.semibold }}>
            {calculatedData.payPeriodBreakdown.length} periods processed
          </span>
        </div>
      </div>

      <div style={{ marginTop: TavariStyles.spacing.lg, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          style={{
            ...styles.button,
            ...(generating || !calculatedData ? styles.disabledButton : {})
          }}
          onClick={onGenerateReport}
          disabled={generating || !calculatedData}
        >
          {generating ? 'Generating...' : 'Generate Comprehensive Report'}
        </button>
        {onGenerateDeductionsReport && (
          <button
            style={{
              ...styles.button,
              backgroundColor: TavariStyles.colors.gray700 || '#374151',
              ...(generating || !calculatedData ? styles.disabledButton : {})
            }}
            onClick={onGenerateDeductionsReport}
            disabled={generating || !calculatedData}
          >
            {generating ? 'Generating...' : 'Generate Deductions Report'}
          </button>
        )}
      </div>
      {onGenerateDeductionsReport && (
        <p style={{ fontSize: 10, color: TavariStyles.colors.gray600 || '#6b7280', marginTop: 8 }}>
          Deductions report shows federal tax, provincial tax, CPP, EI, and additional tax by pay period (same data as pay statements; separate from T4).
        </p>
      )}
    </div>
  );
};

export default EETRT_DataPreview;