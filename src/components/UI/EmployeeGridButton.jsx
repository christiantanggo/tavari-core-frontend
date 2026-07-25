// Comp-EmployeeGridButton.jsx
// Standardized 3x grid button component for employee interfaces
// Tavari Standards: White button with teal border, bold text, dark grey text
import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

const EmployeeGridButton = ({ 
  icon: Icon, 
  label, 
  description, 
  onClick, 
  disabled = false,
  iconSize = 32 
}) => {
  const handleClick = () => {
    if (!disabled && onClick) {
      try {
        onClick();
      } catch (error) {
        console.error('Error in EmployeeGridButton onClick:', error);
        // Log error but don't break the UI
      }
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      style={{
        ...styles.button,
        ...(disabled ? styles.buttonDisabled : {}),
        ...(onClick && !disabled ? styles.buttonHover : {})
      }}
      onMouseEnter={(e) => {
        if (!disabled && onClick) {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 128, 128, 0.15)';
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled && onClick) {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }
      }}
    >
      {Icon && (
        <div style={styles.iconContainer}>
          <Icon size={iconSize} style={styles.icon} />
        </div>
      )}
      <h3 style={styles.label}>{label}</h3>
      {description && (
        <p style={styles.description}>{description}</p>
      )}
      {disabled && (
        <p style={styles.disabledText}>Permission Required</p>
      )}
    </button>
  );
};

const styles = {
  button: {
    backgroundColor: TavariStyles.colors.white,
    border: `2px solid ${TavariStyles.colors.primary}`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.xl,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: TavariStyles.spacing.sm,
    transition: 'all 0.2s ease',
    minHeight: '120px',
    position: 'relative',
    width: '100%',
    textAlign: 'center'
  },
  buttonDisabled: {
    backgroundColor: TavariStyles.colors.gray100,
    borderColor: TavariStyles.colors.gray300,
    cursor: 'not-allowed',
    opacity: 0.7
  },
  buttonHover: {
    // Hover styles applied via onMouseEnter/Leave
  },
  iconContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: TavariStyles.spacing.xs
  },
  icon: {
    color: TavariStyles.colors.primary
  },
  label: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray700,
    margin: 0,
    textAlign: 'center'
  },
  description: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: 0,
    textAlign: 'center',
    lineHeight: TavariStyles.typography.lineHeight.normal
  },
  disabledText: {
    position: 'absolute',
    bottom: TavariStyles.spacing.sm,
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500,
    fontStyle: 'italic',
    margin: 0
  }
};

export default EmployeeGridButton;




