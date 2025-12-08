// components/POS/POSRegisterComponents/RegisterHeader.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { TavariStyles } from '../../../utils/TavariStyles';

const RegisterHeader = ({
  businessName,
  employeeName,
  currentUnlockingUser,
  authUser,
  time,
  isTabMode,
  cartItems = [],
  isLocked,
  registerLocked,
  onSaveCart,
  onDrawerManager,
  onNavigateToRefunds,
  onNavigateToSavedCarts,
  onNavigateToTabs
}) => {
  const navigate = useNavigate();

  const styles = {
    header: {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: 999,
      backgroundColor: TavariStyles.colors.white,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      boxShadow: TavariStyles.shadows.sm
    },
    
    headerTitle: {
      margin: 0,
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    
    headerSubtitle: {
      margin: 0,
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600
    },
    
    headerActions: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.lg
    },
    
    actionButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.md,
      whiteSpace: 'nowrap'
    },

    saveCartButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.md,
      whiteSpace: 'nowrap'
    },
    
    refundsButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.md,
      whiteSpace: 'nowrap'
    },
    
    clock: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    }
  };

  return (
    <div style={styles.header}>
      <div>
        <h2 style={styles.headerTitle}>{businessName}</h2>
        <p style={styles.headerSubtitle}>
          Logged in as: {employeeName}
          {currentUnlockingUser && currentUnlockingUser.id !== authUser?.id && (
            <span style={{ marginLeft: '10px', color: TavariStyles.colors.warning }}>
              (Register unlocked by: {currentUnlockingUser.name || currentUnlockingUser.full_name || currentUnlockingUser.email})
            </span>
          )}
        </p>
      </div>
      <div style={styles.headerActions}>
        {!isTabMode && cartItems.length > 0 && (
          <button
            style={styles.saveCartButton}
            onClick={onSaveCart}
            disabled={isLocked || registerLocked}
            title="Save current cart for later"
          >
            Save Cart
          </button>
        )}
        <button
          style={styles.actionButton}
          onClick={onDrawerManager}
          disabled={isLocked || registerLocked}
          title="Manage cash drawer"
        >
          Drawer
        </button>
        <button
          style={styles.refundsButton}
          onClick={onNavigateToRefunds}
          disabled={isLocked || registerLocked}
        >
          Refunds
        </button>
        <button
          style={styles.actionButton}
          onClick={onNavigateToSavedCarts}
          disabled={isLocked || registerLocked}
        >
          Saved Carts
        </button>
        <button
          style={styles.actionButton}
          onClick={onNavigateToTabs}
          disabled={isLocked || registerLocked}
        >
          Tabs
        </button>
        <div style={styles.clock}>{time}</div>
      </div>
    </div>
  );
};

export default RegisterHeader;