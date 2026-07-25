// components/UI/TavariCheckbox.jsx - Fixed Reusable Checkbox Component
import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * Reusable checkbox component with consistent Tavari styling
 * 
 * @param {Object} props
 * @param {boolean} props.checked - Whether checkbox is checked
 * @param {Function} props.onChange - Change handler function
 * @param {string} props.label - Label text for checkbox
 * @param {string} props.size - Size variant: 'sm', 'md', 'lg' (default: 'md')
 * @param {boolean} props.disabled - Whether checkbox is disabled
 * @param {string} props.id - Unique ID for the checkbox
 * @param {string} props.name - Name attribute for the checkbox
 * @param {Object} props.style - Additional styles for container
 * @param {Object} props.labelStyle - Additional styles for label
 * @param {string} props.checkIcon - Custom check icon (default: '✓')
 * @param {string} props.testId - Test ID for testing
 * @param {'custom'|'native'} props.appearance - 'native' = OS-visible checkbox (recommended where custom box is hard to see)
 * @returns {React.ReactNode} Checkbox component
 */
const TavariCheckbox = ({
  checked = false,
  onChange = () => {},
  label = '',
  size = 'md',
  disabled = false,
  id,
  name,
  style = {},
  labelStyle = {},
  checkIcon = '✓',
  testId,
  children,
  appearance = 'custom',
  ...restProps
}) => {
  // Don't forward children to input (void element); prevents stray content from rendering
  const inputProps = { ...restProps };
  if (children !== undefined) delete inputProps.children;
  // Define size configurations directly since TavariStyles doesn't have checkbox.sizes
  const sizeConfigs = {
    sm: {
      checkboxSize: '16px',
      fontSize: TavariStyles.typography.fontSize.xs,
      gap: TavariStyles.spacing.xs
    },
    md: {
      checkboxSize: '20px',
      fontSize: TavariStyles.typography.fontSize.sm,
      gap: TavariStyles.spacing.sm
    },
    lg: {
      checkboxSize: '24px',
      fontSize: TavariStyles.typography.fontSize.base,
      gap: TavariStyles.spacing.md
    }
  };
  
  const sizeConfig = sizeConfigs[size] || sizeConfigs.md;

  const nativeCheckboxPx =
    size === 'lg' ? 22 : size === 'sm' ? 16 : 18;
  
  const handleChange = (e) => {
    if (!disabled) {
      onChange(e.target.checked, e);
    }
  };

  const handleContainerClick = (e) => {
    // Controlled checkbox inside <label>: browser default toggles the native input and fights
    // React’s `checked` prop — second tap often never delivers a reliable uncheck. We own the toggle.
    e.preventDefault();
    if (!disabled) {
      onChange(!checked, { target: { checked: !checked, name, id } });
    }
  };

  if (appearance === 'native') {
    const nativeStyles = {
      container: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: sizeConfig.gap,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        userSelect: 'none',
        color: TavariStyles.colors.gray800,
        ...style
      },
      nativeInput: {
        width: `${nativeCheckboxPx}px`,
        height: `${nativeCheckboxPx}px`,
        minWidth: `${nativeCheckboxPx}px`,
        minHeight: `${nativeCheckboxPx}px`,
        flexShrink: 0,
        display: 'inline-block',
        margin: 0,
        marginTop: '2px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: 1,
        appearance: 'auto',
        WebkitAppearance: 'checkbox',
        MozAppearance: 'auto',
        accentColor: TavariStyles.colors.primary
      },
      label: {
        fontSize: sizeConfig.fontSize,
        color: disabled ? TavariStyles.colors.gray400 : TavariStyles.colors.gray700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: TavariStyles.typography.fontWeight.medium,
        lineHeight: TavariStyles.typography.lineHeight.normal,
        ...labelStyle
      }
    };

    return (
      <label
        htmlFor={id}
        style={nativeStyles.container}
        data-testid={testId}
      >
        <input
          type="checkbox"
          id={id}
          name={name}
          checked={checked}
          onChange={handleChange}
          disabled={disabled}
          style={nativeStyles.nativeInput}
          {...inputProps}
        />
        {label ? <span style={nativeStyles.label}>{label}</span> : null}
      </label>
    );
  }

  const styles = {
    container: {
      display: 'flex',
      alignItems: 'center',
      gap: sizeConfig.gap,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      userSelect: 'none',
      color: TavariStyles.colors.gray800,
      ...style
    },
    
    checkboxWrapper: {
      position: 'relative',
      display: 'inline-block',
      flexShrink: 0,
      flexGrow: 0,
      lineHeight: 0
    },
    
    hiddenInput: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0,
      margin: 0,
      padding: 0,
      pointerEvents: 'none'
    },
    
    customBox: {
      width: sizeConfig.checkboxSize,
      height: sizeConfig.checkboxSize,
      minWidth: sizeConfig.checkboxSize,
      minHeight: sizeConfig.checkboxSize,
      boxSizing: 'border-box',
      border: `2px solid ${checked ? TavariStyles.colors.primary : TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.sm,
      backgroundColor: checked ? TavariStyles.colors.primary : TavariStyles.colors.white,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      transition: `all ${TavariStyles.transitions.normal}`,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: size === 'sm' ? '10px' : size === 'lg' ? '14px' : '12px',
      color: TavariStyles.colors.white,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    
    label: {
      fontSize: sizeConfig.fontSize,
      color: disabled ? TavariStyles.colors.gray400 : TavariStyles.colors.gray700,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontWeight: TavariStyles.typography.fontWeight.medium,
      lineHeight: TavariStyles.typography.lineHeight.normal,
      ...labelStyle
    }
  };

  return (
    <label 
      style={styles.container}
      onClick={handleContainerClick}
      data-testid={testId}
    >
      <div style={styles.checkboxWrapper}>
        <input
          type="checkbox"
          checked={checked}
          onChange={handleChange}
          disabled={disabled}
          style={styles.hiddenInput}
          id={id}
          name={name}
          {...inputProps}
        />
        
        <div style={styles.customBox}>
          {checked && checkIcon}
        </div>
      </div>
      
      {label && (
        <span style={styles.label}>
          {label}
        </span>
      )}
    </label>
  );
};

export default TavariCheckbox;