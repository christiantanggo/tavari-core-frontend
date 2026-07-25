// components/POS/POSRegisterComponents/RegisterHeader.jsx
import React from 'react';
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
  onNavigateToWaivers,
  onNavigateToRefunds,
  onNavigateToSavedCarts,
  onNavigateToTabs,
  onSwitchUser,
  showWaiverButton = false,
  canAccessDrawer = true,
  canSaveCart = true,
  canViewRefunds = true,
  canManageTabs = true,
}) => {
  const styles = {
    header: {
      position: 'fixed',
      top: '60px',
      left: '240px',
      right: '0',
      zIndex: 998,
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
      color: TavariStyles.colors.gray600,
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '8px',
    },

    switchUserButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm,
      marginLeft: '4px',
      whiteSpace: 'nowrap',
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
    <div className="pos-register-header" style={styles.header}>
      <div>
        <h2 style={styles.headerTitle}>{businessName}</h2>
        <p style={styles.headerSubtitle}>
          Logged in as: {employeeName}
          {currentUnlockingUser && (
            <span style={{ marginLeft: '10px', color: TavariStyles.colors.warning }}>
              (Register unlocked by:{' '}
              {currentUnlockingUser.name ||
                currentUnlockingUser.full_name ||
                currentUnlockingUser.email}
              )
            </span>
          )}
          {!isLocked && !registerLocked && typeof onSwitchUser === 'function' ? (
            <button
              type="button"
              style={styles.switchUserButton}
              onClick={onSwitchUser}
              title="Enter a staff PIN to switch who is running the register"
            >
              Switch user
            </button>
          ) : null}
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
        {showWaiverButton && (
          <button
            style={styles.actionButton}
            onClick={onNavigateToWaivers}
            disabled={isLocked || registerLocked}
            title="Open waiver module overview"
          >
            Waiver
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