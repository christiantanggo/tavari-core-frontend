// components/HR/HRPayrollComponents/YTDComponents/YTDTotalsCard.jsx - SIMPLIFIED
import React from 'react';
import { TavariStyles } from '../../../../utils/TavariStyles';

const YTDTotalsCard = ({ totals, formatTaxAmount, styles, showDeductions = true }) => {
  return (
    <div style={styles.totalsCard}>
      {/* Show hours if available */}
      {totals.totalHours !== undefined && (
        <div style={styles.totalRow}>
          <span style={styles.totalLabel}>Total Hours:</span>
          <span style={styles.totalValue}>{formatTaxAmount(totals.totalHours)} hours</span>
        </div>
      )}

      {/* YTD Summary Tab - Detailed breakdown */}
      {showDeductions && (
        <>
          {totals.totalRegularHours !== undefined && (
            <div style={styles.totalRow}>
              <span style={styles.totalLabel}>Total Regular Hours:</span>
              <span style={styles.totalValue}>{formatTaxAmount(totals.totalRegularHours)} hours</span>
            </div>
          )}

          {totals.totalOvertimeHours !== undefined && (
            <div style={styles.totalRow}>
              <span style={styles.totalLabel}>Total Overtime Hours:</span>
              <span style={styles.totalValue}>{formatTaxAmount(totals.totalOvertimeHours)} hours</span>
            </div>
          )}

          {totals.totalRegular !== undefined && (
            <div style={styles.totalRow}>
              <span style={styles.totalLabel}>Total Regular Earnings:</span>
              <span style={styles.totalValue}>${formatTaxAmount(totals.totalRegular)}</span>
            </div>
          )}

          {totals.totalOvertime !== undefined && (
            <div style={styles.totalRow}>
              <span style={styles.totalLabel}>Total Overtime Earnings:</span>
              <span style={styles.totalValue}>${formatTaxAmount(totals.totalOvertime)}</span>
            </div>
          )}

          {totals.totalVacation !== undefined && (
            <div style={styles.totalRow}>
              <span style={styles.totalLabel}>Total Vacation Pay:</span>
              <span style={styles.totalValue}>${formatTaxAmount(totals.totalVacation)}</span>
            </div>
          )}
        </>
      )}

      {/* Total Income/Earnings */}
      <div style={styles.totalRow}>
        <span style={styles.totalLabel}>
          {showDeductions ? 'Total Income:' : 'Total Earnings:'}
        </span>
        <span style={{...styles.totalValue, fontSize: TavariStyles.typography.fontSize.xl}}>
          ${formatTaxAmount(totals.totalIncome || totals.totalEarnings || totals.grandTotal)}
        </span>
      </div>
      
      {/* Deductions - Only for YTD Summary */}
      {showDeductions && totals.totalDeductions !== undefined && (
        <div style={styles.totalRow}>
          <span style={styles.totalLabel}>Total Deductions:</span>
          <span style={{...styles.totalValue, color: TavariStyles.colors.danger}}>
            ${formatTaxAmount(totals.totalDeductions)}
          </span>
        </div>
      )}
      
      {/* Net Income - YTD Summary */}
      {showDeductions && totals.netIncome !== undefined && (
        <div style={{...styles.totalRow, borderBottom: 'none', borderTop: `2px solid ${TavariStyles.colors.primary}`}}>
          <span style={{...styles.totalLabel, fontWeight: TavariStyles.typography.fontWeight.bold}}>
            Net Income:
          </span>
          <span style={{...styles.totalValue, fontSize: TavariStyles.typography.fontSize['2xl']}}>
            ${formatTaxAmount(totals.netIncome)}
          </span>
        </div>
      )}

      {/* Grand Total - Period-by-Period (no deductions) */}
      {!showDeductions && (totals.totalEarnings !== undefined || totals.grandTotal !== undefined) && (
        <div style={{...styles.totalRow, borderBottom: 'none', borderTop: `2px solid ${TavariStyles.colors.primary}`}}>
          <span style={{...styles.totalLabel, fontWeight: TavariStyles.typography.fontWeight.bold}}>
            Grand Total:
          </span>
          <span style={{...styles.totalValue, fontSize: TavariStyles.typography.fontSize['2xl']}}>
            ${formatTaxAmount(totals.totalEarnings || totals.grandTotal)}
          </span>
        </div>
      )}
    </div>
  );
};

export default YTDTotalsCard;