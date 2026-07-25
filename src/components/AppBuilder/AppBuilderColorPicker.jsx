// Step 86: Create AppBuilderColorPicker component
// Color picker for branding colors with accessibility check
import React, { useState } from 'react';
import { getContrastColor, validateColorAccessibility } from '../../utils/appBuilderColorUtils';
import { TavariStyles } from '../../utils/TavariStyles';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles?.spacing?.md || '12px'
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles?.spacing?.md || '12px'
  },
  colorInput: {
    width: '64px',
    height: '64px',
    borderRadius: TavariStyles?.borderRadius?.md || '6px',
    cursor: 'pointer',
    border: 'none',
    padding: 0
  },
  colorInputDisabled: {
    cursor: 'not-allowed',
    opacity: 0.5
  },
  hexInput: {
    flex: 1,
    padding: '12px 16px',
    border: `2px solid ${TavariStyles?.colors?.primary || '#008080'}`,
    borderRadius: TavariStyles?.borderRadius?.md || '6px',
    fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
    fontFamily: 'monospace',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease',
    outline: 'none'
  },
  hexInputDisabled: {
    backgroundColor: TavariStyles?.colors?.gray100 || '#f3f4f6',
    cursor: 'not-allowed',
    borderColor: TavariStyles?.colors?.gray300 || '#d1d5db'
  }
};

const AppBuilderColorPicker = ({ color, onChange, disabled = false }) => {
  const [showPicker, setShowPicker] = useState(false);
  const [hexValue, setHexValue] = useState(color || '#3B82F6');

  React.useEffect(() => {
    setHexValue(color || '#3B82F6');
  }, [color]);

  const handleHexChange = (e) => {
    const value = e.target.value;
    setHexValue(value);
    if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(value)) {
      onChange(value);
    }
  };

  const handleColorInputChange = (e) => {
    const value = e.target.value;
    onChange(value);
    setHexValue(value);
  };

  const accessibilityCheck = validateColorAccessibility(hexValue, '#ffffff');

  return (
    <div style={styles.container}>
      {/* Color Input */}
      <div style={styles.inputRow}>
        <div>
          <input
            type="color"
            value={hexValue}
            onChange={handleColorInputChange}
            disabled={disabled}
            style={{
              ...styles.colorInput,
              ...(disabled ? styles.colorInputDisabled : {})
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <input
            type="text"
            value={hexValue}
            onChange={handleHexChange}
            disabled={disabled}
            placeholder="#3B82F6"
            style={{
              ...styles.hexInput,
              ...(disabled ? styles.hexInputDisabled : {})
            }}
          />
        </div>
      </div>

      {/* Accessibility Check */}
      {accessibilityCheck && (
        <div style={{
          padding: TavariStyles?.spacing?.sm || '8px',
          borderRadius: TavariStyles?.borderRadius?.md || '6px',
          fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
          backgroundColor: accessibilityCheck.accessible
            ? TavariStyles?.colors?.successBg || '#dcfce7'
            : TavariStyles?.colors?.warningBg || '#fef3c7',
          color: accessibilityCheck.accessible
            ? TavariStyles?.colors?.successText || '#16a34a'
            : TavariStyles?.colors?.warningText || '#d97706'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span>
              Contrast Ratio: {accessibilityCheck.ratio}:1
            </span>
            <span style={{
              fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500'
            }}>
              {accessibilityCheck.level}
            </span>
          </div>
          {!accessibilityCheck.accessible && (
            <p style={{
              margin: 0,
              marginTop: TavariStyles?.spacing?.xs || '4px',
              fontSize: TavariStyles?.typography?.fontSize?.xs || '12px'
            }}>
              Consider using a darker color for better accessibility
            </p>
          )}
        </div>
      )}

    </div>
  );
};

export default AppBuilderColorPicker;

