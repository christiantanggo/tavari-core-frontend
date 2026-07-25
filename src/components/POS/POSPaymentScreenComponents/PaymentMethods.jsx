// components/POS/POSPaymentScreenComponents/PaymentMethods.jsx - Fixed
import React from 'react';
import { TavariStyles } from '../../../utils/TavariStyles';

const PaymentMethods = ({
  currentPayment,
  setCurrentPayment,
  loyaltySettings,
  availableLoyaltyCredit,
  remainingBalance,
  /** Balance from exact (unrounded) sale total — use for card/terminal/loyalty prefills, not cash rounding. */
  exactRemainingBalance = null,
  cashRemainingBalance,
  getBalanceDisplay,
  showCustomMethod,
  setShowCustomMethod,
  customMethodName,
  setCustomMethodName,
  /** 'grid' = horizontal tiles; 'stacked' = full-width column (e.g. beside summary on wide POS) */
  variant = 'grid',
  /** With variant stacked: grow to match payment summary column height */
  fillColumn = false
}) => {
  const paymentMethods = [
    { id: 'cash', name: 'Cash', icon: '💵' },
    { id: 'helcim_terminal', name: 'Helcim Terminal', icon: '💳' },
    { id: 'gift_card', name: 'Gift Card', icon: '🎁' },
    { id: 'loyalty_credit', name: 'Loyalty Credit', icon: '⭐' },
    { id: 'custom', name: 'Custom Method', icon: '⚙️' }
  ];

  const handleMethodSelect = (method) => {
    console.log('Payment method selected:', {
      payment_method: method.id,
      previous_method: currentPayment.method
    });

    const electronicBalance =
      exactRemainingBalance != null && Number.isFinite(exactRemainingBalance)
        ? exactRemainingBalance
        : remainingBalance;

    setCurrentPayment({ 
      method: method.id, 
      amount: method.id === 'loyalty_credit' ? 
        Math.min(availableLoyaltyCredit, electronicBalance).toFixed(2) :
        method.id === 'cash'
          ? (cashRemainingBalance > 0 ? cashRemainingBalance.toFixed(2) : '')
          : (electronicBalance > 0 ? electronicBalance.toFixed(2) : '')
    });
    setShowCustomMethod(method.id === 'custom');
  };

  const handleCustomMethodChange = (e) => {
    setCustomMethodName(e.target.value);
    console.log('Custom payment method entered:', {
      method_name: e.target.value
    });
  };

  const isStacked = variant === 'stacked';
  const stretchColumn = isStacked && fillColumn;

  const styles = {
    methodsContainer: {
      marginBottom: isStacked ? 0 : TavariStyles.spacing.lg,
      width: '100%',
      ...(stretchColumn
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

    panelTitle: {
      margin: 0,
      marginBottom: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`,
      paddingBottom: TavariStyles.spacing.sm,
      ...(stretchColumn ? { flexShrink: 0 } : {})
    },

    methodsBody: {
      ...(stretchColumn
        ? {
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column'
          }
        : {})
    },
    
    paymentMethods: {
      display: isStacked ? 'flex' : 'grid',
      flexDirection: isStacked ? 'column' : undefined,
      gridTemplateColumns: isStacked ? undefined : 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: isStacked ? TavariStyles.spacing.sm : TavariStyles.spacing.md,
      marginBottom: stretchColumn ? 0 : TavariStyles.spacing.md,
      width: '100%',
      ...(stretchColumn ? { flexShrink: 0 } : {})
    },

    methodsFiller: {
      ...(stretchColumn
        ? {
            flex: 1,
            minHeight: TavariStyles.spacing.sm
          }
        : {})
    },
    
    methodButton: {
      display: 'flex',
      flexDirection: isStacked ? 'row' : 'column',
      alignItems: 'center',
      padding: isStacked ? `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}` : TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      border: `2px solid ${TavariStyles.colors.primary}`,
      borderRadius: TavariStyles.borderRadius.lg,
      cursor: 'pointer',
      fontSize: isStacked ? TavariStyles.typography.fontSize.base : TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      transition: TavariStyles.transitions.normal,
      minHeight: isStacked ? '52px' : '80px',
      justifyContent: isStacked ? 'flex-start' : 'center',
      width: isStacked ? '100%' : undefined,
      textAlign: isStacked ? 'left' : 'center',
      boxSizing: 'border-box'
    },
    
    methodButtonActive: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    
    methodIcon: {
      fontSize: isStacked ? TavariStyles.typography.fontSize.xl : TavariStyles.typography.fontSize['2xl'],
      marginBottom: isStacked ? 0 : TavariStyles.spacing.xs,
      marginRight: isStacked ? TavariStyles.spacing.md : 0,
      flexShrink: 0,
      width: isStacked ? '28px' : undefined,
      textAlign: 'center'
    },
    
    customMethodInput: {
      marginTop: TavariStyles.spacing.md,
      ...(stretchColumn ? { flexShrink: 0 } : {})
    },
    
    loyaltyInfo: {
      fontSize: TavariStyles.typography.fontSize.xs,
      opacity: 0.8,
      marginTop: isStacked ? 0 : TavariStyles.spacing.xs,
      marginLeft: isStacked ? TavariStyles.spacing.sm : 0,
      textAlign: isStacked ? 'left' : 'center',
      flex: isStacked ? 1 : undefined
    },

    methodLabelWrap: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: isStacked ? 'flex-start' : 'center',
      gap: isStacked ? 2 : undefined,
      flex: isStacked ? 1 : undefined,
      minWidth: 0,
      textAlign: isStacked ? 'left' : 'center'
    }
  };

  return (
    <div
      className={stretchColumn ? 'payment-screen-methods-fill' : undefined}
      style={styles.methodsContainer}
    >
      {isStacked && <h3 style={styles.panelTitle}>Payment method</h3>}
      <div style={styles.methodsBody}>
        <div style={styles.paymentMethods}>
        {paymentMethods.map(method => {
          // Hide loyalty credit if no loyalty system or no available credit
          if (method.id === 'loyalty_credit' && (!loyaltySettings?.is_active || availableLoyaltyCredit <= 0)) {
            return null;
          }
          
          const isActive = currentPayment.method === method.id;
          
          return (
            <button
              key={method.id}
              type="button"
              style={{
                ...styles.methodButton,
                ...(isActive ? styles.methodButtonActive : {})
              }}
              onClick={() => handleMethodSelect(method)}
            >
              <span style={styles.methodIcon}>{method.icon}</span>
              <span style={styles.methodLabelWrap}>
                <span>{method.name}</span>
                {method.id === 'loyalty_credit' && getBalanceDisplay && (
                  <span style={styles.loyaltyInfo}>
                    {getBalanceDisplay(availableLoyaltyCredit)} available
                  </span>
                )}
              </span>
            </button>
          );
        })}
        </div>
        {stretchColumn && <div style={styles.methodsFiller} aria-hidden="true" />}
      </div>

      {showCustomMethod && (
        <div style={styles.customMethodInput}>
          <input
            type="text"
            value={customMethodName}
            onChange={handleCustomMethodChange}
            placeholder="Enter payment method name"
            style={TavariStyles.components.form.input}
            autoFocus
          />
        </div>
      )}
    </div>
  );
};

export default PaymentMethods;