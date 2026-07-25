// Step 84: Create AppBuilderBrandingTab component
// Branding configuration tab (colors, logos, icons, splash screens)
import React from 'react';
import AppBuilderColorPicker from './AppBuilderColorPicker';
import { TavariStyles } from '../../utils/TavariStyles';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles?.spacing?.xl || '20px'
  },
  formGroup: {
    marginBottom: TavariStyles?.spacing?.lg || '16px'
  },
  label: {
    display: 'block',
    fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
    fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
    color: TavariStyles?.colors?.gray700 || '#374151',
    marginBottom: TavariStyles?.spacing?.xs || '4px'
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    border: `2px solid ${TavariStyles?.colors?.primary || '#008080'}`,
    borderRadius: TavariStyles?.borderRadius?.md || '6px',
    fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease',
    outline: 'none'
  },
  inputDisabled: {
    backgroundColor: TavariStyles?.colors?.gray100 || '#f3f4f6',
    cursor: 'not-allowed',
    borderColor: TavariStyles?.colors?.gray300 || '#d1d5db'
  }
};

const AppBuilderBrandingTab = ({ brandingData, setBrandingData, canEdit }) => {
  return (
    <div style={styles.container}>
      {/* App Name */}
      <div style={styles.formGroup}>
        <label style={styles.label}>
          App Name
        </label>
        <input
          type="text"
          value={brandingData.app_name}
          onChange={(e) => setBrandingData(prev => ({ ...prev, app_name: e.target.value }))}
          disabled={!canEdit}
          placeholder="My App"
          style={{
            ...styles.input,
            ...(!canEdit ? styles.inputDisabled : {})
          }}
        />
      </div>

      {/* Primary Color */}
      <div style={styles.formGroup}>
        <label style={styles.label}>
          Primary Color
        </label>
        <AppBuilderColorPicker
          color={brandingData.primary_color}
          onChange={(color) => setBrandingData(prev => ({ ...prev, primary_color: color }))}
          disabled={!canEdit}
        />
      </div>

      {/* Secondary Color */}
      <div style={styles.formGroup}>
        <label style={styles.label}>
          Secondary Color
        </label>
        <AppBuilderColorPicker
          color={brandingData.secondary_color}
          onChange={(color) => setBrandingData(prev => ({ ...prev, secondary_color: color }))}
          disabled={!canEdit}
        />
      </div>

      {/* Accent Color */}
      <div style={styles.formGroup}>
        <label style={styles.label}>
          Accent Color
        </label>
        <AppBuilderColorPicker
          color={brandingData.accent_color}
          onChange={(color) => setBrandingData(prev => ({ ...prev, accent_color: color }))}
          disabled={!canEdit}
        />
      </div>

      {/* Color Preview */}
      <div style={styles.formGroup}>
        <label style={styles.label}>
          Color Preview
        </label>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: TavariStyles?.spacing?.md || '12px'
        }}>
          <div style={{
            border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
            borderRadius: TavariStyles?.borderRadius?.lg || '8px',
            overflow: 'hidden'
          }}>
            <div
              style={{
                height: '80px',
                backgroundColor: brandingData.primary_color || '#3B82F6'
              }}
            />
            <div style={{
              padding: TavariStyles?.spacing?.sm || '8px',
              backgroundColor: TavariStyles?.colors?.white || '#ffffff'
            }}>
              <p style={{
                fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
                fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500',
                color: TavariStyles?.colors?.gray900 || '#111827',
                margin: 0,
                marginBottom: TavariStyles?.spacing?.xs || '4px'
              }}>Primary</p>
              <p style={{
                fontSize: TavariStyles?.typography?.fontSize?.xs || '12px',
                color: TavariStyles?.colors?.gray600 || '#4b5563',
                margin: 0
              }}>{brandingData.primary_color || '#3B82F6'}</p>
            </div>
          </div>
          <div style={{
            border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
            borderRadius: TavariStyles?.borderRadius?.lg || '8px',
            overflow: 'hidden'
          }}>
            <div
              style={{
                height: '80px',
                backgroundColor: brandingData.secondary_color || '#1E40AF'
              }}
            />
            <div style={{
              padding: TavariStyles?.spacing?.sm || '8px',
              backgroundColor: TavariStyles?.colors?.white || '#ffffff'
            }}>
              <p style={{
                fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
                fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500',
                color: TavariStyles?.colors?.gray900 || '#111827',
                margin: 0,
                marginBottom: TavariStyles?.spacing?.xs || '4px'
              }}>Secondary</p>
              <p style={{
                fontSize: TavariStyles?.typography?.fontSize?.xs || '12px',
                color: TavariStyles?.colors?.gray600 || '#4b5563',
                margin: 0
              }}>{brandingData.secondary_color || '#1E40AF'}</p>
            </div>
          </div>
          <div style={{
            border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
            borderRadius: TavariStyles?.borderRadius?.lg || '8px',
            overflow: 'hidden'
          }}>
            <div
              style={{
                height: '80px',
                backgroundColor: brandingData.accent_color || '#60A5FA'
              }}
            />
            <div style={{
              padding: TavariStyles?.spacing?.sm || '8px',
              backgroundColor: TavariStyles?.colors?.white || '#ffffff'
            }}>
              <p style={{
                fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
                fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500',
                color: TavariStyles?.colors?.gray900 || '#111827',
                margin: 0,
                marginBottom: TavariStyles?.spacing?.xs || '4px'
              }}>Accent</p>
              <p style={{
                fontSize: TavariStyles?.typography?.fontSize?.xs || '12px',
                color: TavariStyles?.colors?.gray600 || '#4b5563',
                margin: 0
              }}>{brandingData.accent_color || '#60A5FA'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppBuilderBrandingTab;

