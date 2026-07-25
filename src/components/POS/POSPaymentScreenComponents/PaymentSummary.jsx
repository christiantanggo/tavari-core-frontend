// components/POS/POSPaymentScreenComponents/PaymentSummary.jsx
import React from 'react';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';

const PaymentSummary = ({
  saleSubtotal,
  discountAmount,
  loyaltyRedemption,
  taxableAmount,
  taxCalculation,
  finalTaxAmount,
  tipAmount,
  displayTotal,
  totalPaid,
  remainingBalance,
  saleData,
  loyaltySettings,
  loyaltyPointsToEarn,
  loyaltyCreditsToEarn,
  getBalanceDisplay,
  /** When true, fills parent flex column (equal height with adjacent payment methods panel) */
  fillColumn = false
}) => {
  const taxCalc = useTaxCalculations();

  const styles = {
    section: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      ...(fillColumn
        ? {
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            boxSizing: 'border-box'
          }
        : {})
    },
    
    sectionTitle: {
      margin: 0,
      marginBottom: TavariStyles.spacing.lg,
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`,
      paddingBottom: TavariStyles.spacing.sm,
      ...(fillColumn ? { flexShrink: 0 } : {})
    },
    
    summaryGrid: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm,
      ...(fillColumn
        ? {
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch'
          }
        : {})
    },
    
    summaryItem: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray800
    },
    
    summaryItemDiscount: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.danger,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    summaryItemTotal: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      paddingTop: TavariStyles.spacing.sm,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    summaryItemRemaining: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    
    summaryItemLoyalty: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.success,
      backgroundColor: TavariStyles.colors.successBg,
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius.sm
    },
    
    summaryItemEarn: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.warning,
      backgroundColor: TavariStyles.colors.warningBg,
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius.sm
    },
    
    taxBreakdownSection: {
      ...TavariStyles.pos.tax.section
    },
    
    rebateBreakdownSection: {
      backgroundColor: TavariStyles.colors.successBg,
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius.sm,
      border: `1px solid ${TavariStyles.colors.success}`
    },
    
    summaryItemTax: {
      ...TavariStyles.pos.tax.row
    },
    
    summaryItemRebate: {
      ...TavariStyles.pos.tax.rebate
    }
  };

  return (
    <div
      className={fillColumn ? 'payment-screen-summary-fill' : undefined}
      style={styles.section}
    >
      <h3 style={styles.sectionTitle}>Payment Summary</h3>
      <div
        className={fillColumn ? 'payment-screen-summary-grid' : undefined}
        style={styles.summaryGrid}
      >
        <div style={styles.summaryItem}>
          <span>Subtotal:</span>
          <span>${saleSubtotal.toFixed(2)}</span>
        </div>
        
        {discountAmount > 0 && (
          <div style={styles.summaryItemDiscount}>
            <span>{saleData?.discount_name || 'Discount'}:</span>
            <span>-${discountAmount.toFixed(2)}</span>
          </div>
        )}
        
        {loyaltyRedemption > 0 && (
          <div style={styles.summaryItemLoyalty}>
            <span>Loyalty Redemption:</span>
            <span>-${loyaltyRedemption.toFixed(2)}</span>
          </div>
        )}
        
        <div style={styles.summaryItem}>
          <span>Taxable Amount:</span>
          <span>${taxableAmount.toFixed(2)}</span>
        </div>

        {Object.keys(taxCalculation.aggregatedTaxes || {}).length > 0 && (
          <div style={styles.taxBreakdownSection}>
            {Object.entries(taxCalculation.aggregatedTaxes).map(([taxName, amount]) => (
              <div key={taxName} style={styles.summaryItemTax}>
                <span>{taxName}:</span>
                <span>${taxCalc.formatTaxAmount(amount)}</span>
              </div>
            ))}
          </div>
        )}

        {Object.keys(taxCalculation.aggregatedRebates || {}).length > 0 && (
          <div style={styles.rebateBreakdownSection}>
            {Object.entries(taxCalculation.aggregatedRebates).map(([rebateName, amount]) => (
              <div key={rebateName} style={styles.summaryItemRebate}>
                <span>{rebateName}:</span>
                <span>-${taxCalc.formatTaxAmount(amount)}</span>
              </div>
            ))}
          </div>
        )}
        
        <div style={styles.summaryItem}>
          <span>Total Tax:</span>
          <span>${taxCalc.formatTaxAmount(finalTaxAmount)}</span>
        </div>
        
        {tipAmount > 0 && (
          <div style={styles.summaryItem}>
            <span>Tip:</span>
            <span>${tipAmount.toFixed(2)}</span>
          </div>
        )}
        
        <div style={styles.summaryItemTotal}>
          <span>Final Total:</span>
          <span>${displayTotal.toFixed(2)}</span>
        </div>
        <div style={styles.summaryItem}>
          <span>Total Paid:</span>
          <span>${totalPaid.toFixed(2)}</span>
        </div>
        <div style={{
          ...styles.summaryItemRemaining,
          color: remainingBalance > 0 ? TavariStyles.colors.danger : TavariStyles.colors.success
        }}>
          <span>Remaining:</span>
          <span>${remainingBalance.toFixed(2)}</span>
        </div>
        
        {/* Loyalty earning preview */}
        {saleData.loyaltyCustomer && loyaltySettings?.is_active && loyaltyPointsToEarn > 0 && (
          <div style={styles.summaryItemEarn}>
            <span>Points to Earn:</span>
            <span>{getBalanceDisplay(loyaltyCreditsToEarn)} (available tomorrow)</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PaymentSummary;