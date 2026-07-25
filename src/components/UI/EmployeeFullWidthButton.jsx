// Comp-EmployeeFullWidthButton.jsx
// Standardized full-width button for employee interfaces
// Tavari Standards: Solid teal fill with white bold text
import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

const EmployeeFullWidthButton = ({ 
  label, 
  onClick, 
  disabled = false,
  icon: Icon,
  variant = 'primary' // primary, success, warning, danger
}) => {
  const handleClick = () => {
    if (!disabled && onClick) {
      try {
        onClick();
      } catch (error) {
        console.error('Error in EmployeeFullWidthButton onClick:', error);
        // Log error but don't break the UI
      }
    }
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'success':
        return {
          backgroundColor: TavariStyles.colors.success,
          color: TavariStyles.colors.white
        };
      case 'warning':
        return {
          backgroundColor: TavariStyles.colors.warning,
          color: TavariStyles.colors.white
        };
      case 'danger':
        return {
          backgroundColor: TavariStyles.colors.danger,
          color: TavariStyles.colors.white
        };
      default:
        return {
          backgroundColor: TavariStyles.colors.primary,
          color: TavariStyles.colors.white
        };
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      style={{
        ...styles.button,
        ...getVariantStyles(),
        ...(disabled ? styles.buttonDisabled : {}),
        ...(onClick && !disabled ? styles.buttonHover : {})
      }}
      onMouseEnter={(e) => {
        if (!disabled && onClick) {
          e.currentTarget.style.opacity = '0.9';
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled && onClick) {
          e.currentTarget.style.opacity = '1';
        }
      }}
    >
      {Icon && (
        <Icon size={20} style={styles.icon} />
      )}
      <span style={styles.label}>{label}</span>
    </button>
  );
};

const styles = {
  button: {
    width: '100%',
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: TavariStyles.spacing.sm,
    transition: 'all 0.2s ease',
    textAlign: 'center'
  },
  buttonDisabled: {
    backgroundColor: TavariStyles.colors.gray300,
    color: TavariStyles.colors.gray600,
    cursor: 'not-allowed',
    opacity: 0.6
  },
  buttonHover: {
    // Hover styles applied via onMouseEnter/Leave
  },
  icon: {
    flexShrink: 0
  },
  label: {
    fontWeight: TavariStyles.typography.fontWeight.bold
  }
};

export default EmployeeFullWidthButton;




