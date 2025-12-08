// components/POS/POSCartItem.jsx
import React from 'react';
import { Plus, Minus, Trash2 } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';

const POSCartItem = ({ 
  item, 
  onUpdateQuantity, 
  onRemove, 
  sessionLocked 
}) => {
  const basePrice = parseFloat(item.price) || 0;
  const modifierCost = (item.modifiers || []).reduce((sum, modifier) => {
    return sum + (parseFloat(modifier.price) || 0);
      }, 0);
  const itemTotal = (basePrice + modifierCost) * (parseInt(item.quantity) || 1);
  
  // Check if item is paid or partially paid
  const paidAmount = parseFloat(item.paid_amount || 0);
  const isFullyPaid = paidAmount >= itemTotal - 0.01;
  const isPartiallyPaid = paidAmount > 0 && !isFullyPaid;
  const remainingBalance = Math.max(0, itemTotal - paidAmount);

  return (
    <div style={{
      ...styles.cartItem,
      ...(isFullyPaid ? styles.cartItemPaid : {}),
      ...(isPartiallyPaid ? styles.cartItemPartiallyPaid : {})
    }}>
      <div style={styles.itemInfo}>
        <div style={styles.itemName}>
          {item.name}
          {isFullyPaid && <span style={styles.paidBadge}> ✓ Paid</span>}
          {isPartiallyPaid && <span style={styles.partialPaidBadge}> ⚠ Partially Paid</span>}
        </div>
        <div style={styles.itemPrice}>
          ${basePrice.toFixed(2)} each
          {modifierCost > 0 && (
            <span> (+${modifierCost.toFixed(2)} mods)</span>
          )}
        </div>
        {isPartiallyPaid && (
          <div style={styles.paymentStatus}>
            Paid: ${paidAmount.toFixed(2)} | Remaining: ${remainingBalance.toFixed(2)}
          </div>
        )}
        <div style={styles.itemTotal}>
          {isPartiallyPaid ? `$${remainingBalance.toFixed(2)}` : `$${itemTotal.toFixed(2)}`}
        </div>
      </div>
      
      {!isFullyPaid && (
        <div style={styles.quantityControls}>
          <button
            onClick={() => onUpdateQuantity(item.id, Math.max(1, item.quantity - 1))}
            disabled={sessionLocked || item.quantity <= 1}
            style={{
              ...styles.quantityButton,
              opacity: (sessionLocked || item.quantity <= 1) ? 0.5 : 1
            }}
          >
            <Minus size={10} />
          </button>
          
          <div style={styles.quantity}>{item.quantity}</div>
          
          <button
            onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
            disabled={sessionLocked}
            style={{
              ...styles.quantityButton,
              opacity: sessionLocked ? 0.5 : 1
            }}
          >
            <Plus size={10} />
          </button>
          
          <button
            onClick={() => onRemove(item.id)}
            disabled={sessionLocked}
            style={{
              ...styles.removeButton,
              opacity: sessionLocked ? 0.5 : 1
            }}
          >
            <Trash2 size={10} />
          </button>
        </div>
      )}
      
      {/* Modifiers list */}
      {item.modifiers && item.modifiers.length > 0 && (
        <div style={styles.modifiersList}>
          {item.modifiers.map((modifier, modIndex) => (
            <div key={modIndex} style={styles.modifier}>
              <span style={styles.modifierName}>
                • {modifier.name}
              </span>
              {parseFloat(modifier.price) > 0 && (
                <span style={styles.modifierPrice}>
                  +${parseFloat(modifier.price).toFixed(2)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
  };

  const styles = {
  cartItem: {
      display: 'flex',
      flexDirection: 'column',
      padding: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.xs,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.sm,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      minHeight: '50px'
    },
    
    itemInfo: {
      flex: 1,
    marginBottom: TavariStyles.spacing.xs
    },
    
    itemName: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: '2px'
    },
    
    itemPrice: {
      fontSize: '10px',
      color: TavariStyles.colors.gray600
    },
    
    itemTotal: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.success
    },
    
    quantityControls: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px'
    },
    
    quantityButton: {
      ...TavariStyles.components.button.base,
      backgroundColor: TavariStyles.colors.gray200,
      color: TavariStyles.colors.gray700,
      minWidth: '24px',
      height: '24px',
      padding: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '12px'
    },
    
    quantity: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      minWidth: '16px',
      textAlign: 'center'
    },
    
    removeButton: {
      ...TavariStyles.components.button.base,
      backgroundColor: TavariStyles.colors.danger,
      color: TavariStyles.colors.white,
      padding: '2px',
      marginLeft: '4px',
      minWidth: '24px',
      height: '24px',
      fontSize: '12px'
    },
    
    modifiersList: {
      paddingLeft: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.xs,
      borderLeft: `2px solid ${TavariStyles.colors.gray300}`
    },
    
    modifier: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginBottom: '2px',
      paddingLeft: TavariStyles.spacing.xs
    },
    
    modifierName: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600
    },
    
    modifierPrice: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray700,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    cartItemPaid: {
      backgroundColor: TavariStyles.colors.success + '20',
      borderColor: TavariStyles.colors.success,
      opacity: 0.7
    },
    cartItemPartiallyPaid: {
      backgroundColor: TavariStyles.colors.warning + '20',
      borderColor: TavariStyles.colors.warning
    },
    paidBadge: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.success,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginLeft: TavariStyles.spacing.xs
    },
    partialPaidBadge: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.warning,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginLeft: TavariStyles.spacing.xs
    },
    paymentStatus: {
      fontSize: '10px',
      color: TavariStyles.colors.gray600,
      marginTop: '2px',
      fontStyle: 'italic'
    }
  };

export default POSCartItem;