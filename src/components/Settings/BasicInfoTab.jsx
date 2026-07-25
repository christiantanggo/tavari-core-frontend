// src/components/Settings/BasicInfoTab.jsx
import React from 'react';
import { Upload } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';

const BasicInfoTab = ({ businessData, handleChange, styles, brandingData, setBrandingData, handleUploadAsset }) => {
  const uploadStyles = {
    uploadRow: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: TavariStyles?.spacing?.xl || '20px',
      marginTop: TavariStyles?.spacing?.xl || '20px'
    },
    uploadSection: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles?.spacing?.md || '12px'
    },
    uploadHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles?.spacing?.sm || '8px',
      marginBottom: TavariStyles?.spacing?.xs || '4px'
    },
    uploadTitle: {
      fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
      fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
      color: TavariStyles?.colors?.gray700 || '#374151',
      margin: 0
    },
    sizeHint: {
      fontSize: TavariStyles?.typography?.fontSize?.xs || '12px',
      color: TavariStyles?.colors?.gray500 || '#6b7280',
      fontWeight: TavariStyles?.typography?.fontWeight?.normal || '400'
    },
    uploadArea: {
      border: `2px dashed ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
      borderRadius: TavariStyles?.borderRadius?.md || '6px',
      padding: TavariStyles?.spacing?.xl || '20px',
      textAlign: 'center',
      backgroundColor: TavariStyles?.colors?.gray50 || '#f9fafb'
    },
    imagePreview: {
      maxWidth: '200px',
      maxHeight: '100px',
      margin: '0 auto',
      marginBottom: TavariStyles?.spacing?.md || '12px',
      borderRadius: TavariStyles?.borderRadius?.md || '6px'
    },
    faviconPreview: {
      width: '64px',
      height: '64px',
      margin: '0 auto',
      marginBottom: TavariStyles?.spacing?.md || '12px',
      borderRadius: TavariStyles?.borderRadius?.md || '6px'
    },
    uploadButton: {
      padding: `${TavariStyles?.spacing?.sm || '8px'} ${TavariStyles?.spacing?.md || '12px'}`,
      backgroundColor: TavariStyles?.colors?.primary || '#008080',
      color: TavariStyles?.colors?.white || '#ffffff',
      border: 'none',
      borderRadius: TavariStyles?.borderRadius?.md || '6px',
      fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
      fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles?.spacing?.xs || '4px',
      transition: 'all 0.2s ease'
    }
  };

  return (
    <>
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Basic Information</h3>
        
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Business Name *</label>
            <input
              type="text"
              name="name"
              value={businessData?.name || ''}
              onChange={handleChange}
              style={styles.input}
              placeholder="Enter your business name"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Business Email</label>
            <input
              type="email"
              name="business_email"
              value={businessData?.business_email || ''}
              onChange={handleChange}
              style={styles.input}
              placeholder="info@yourbusiness.com"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Business Phone</label>
            <input
              type="tel"
              name="business_phone"
              value={businessData?.business_phone || ''}
              onChange={handleChange}
              style={styles.input}
              placeholder="(519) 555-0123"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Website</label>
            <input
              type="url"
              name="business_website"
              value={businessData?.business_website || ''}
              onChange={handleChange}
              style={styles.input}
              placeholder="www.yourbusiness.com"
            />
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Business Address</h3>
        
        <div style={styles.formGrid}>
          <div style={{...styles.formGroup, gridColumn: '1 / -1'}}>
            <label style={styles.label}>Street Address</label>
            <input
              type="text"
              name="business_address"
              value={businessData?.business_address || ''}
              onChange={handleChange}
              style={styles.input}
              placeholder="123 Main Street"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>City</label>
            <input
              type="text"
              name="business_city"
              value={businessData?.business_city || ''}
              onChange={handleChange}
              style={styles.input}
              placeholder="Your City"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Province/State</label>
            <select
              name="business_state"
              value={businessData?.business_state || 'ON'}
              onChange={handleChange}
              style={styles.select}
            >
              <option value="ON">Ontario</option>
              <option value="BC">British Columbia</option>
              <option value="AB">Alberta</option>
              <option value="SK">Saskatchewan</option>
              <option value="MB">Manitoba</option>
              <option value="QC">Quebec</option>
              <option value="NB">New Brunswick</option>
              <option value="NS">Nova Scotia</option>
              <option value="PE">Prince Edward Island</option>
              <option value="NL">Newfoundland and Labrador</option>
              <option value="YT">Yukon</option>
              <option value="NT">Northwest Territories</option>
              <option value="NU">Nunavut</option>
            </select>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Postal Code</label>
            <input
              type="text"
              name="business_postal"
              value={businessData?.business_postal || ''}
              onChange={handleChange}
              style={styles.input}
              placeholder="N1A 1A1"
            />
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Tax Information</h3>
        
        <div style={styles.formGroup}>
          <label style={styles.label}>Tax Number (HST/GST)</label>
          <input
            type="text"
            name="tax_number"
            value={businessData?.tax_number || ''}
            onChange={handleChange}
            style={styles.input}
            placeholder="HST# 123456789RT0001"
          />
          <div style={styles.helpText}>
            This will appear on receipts and invoices for tax compliance
          </div>
        </div>
      </div>

      {/* Logo and Favicon Upload Section */}
      {handleUploadAsset && (
        <div style={styles.section}>
          <div style={uploadStyles.uploadRow}>
            {/* Logo Upload */}
            <div style={uploadStyles.uploadSection}>
              <div style={uploadStyles.uploadHeader}>
                <h3 style={uploadStyles.uploadTitle}>Logo</h3>
                <span style={uploadStyles.sizeHint}>
                  (PNG, JPEG, WebP, GIF, or SVG — TIFF not supported. Recommended: 512×512px)
                </span>
              </div>
              <div style={uploadStyles.uploadArea}>
                {brandingData?.logo_url ? (
                  <div>
                    <img
                      src={brandingData.logo_url}
                      alt="Logo"
                      style={uploadStyles.imagePreview}
                    />
                    <button
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept =
                          'image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml';
                        input.onchange = (e) => {
                          if (e.target.files[0]) {
                            handleUploadAsset(e.target.files[0], 'logo');
                          }
                        };
                        input.click();
                      }}
                      style={uploadStyles.uploadButton}
                    >
                      <Upload size={16} />
                      Replace Logo
                    </button>
                  </div>
                ) : (
                  <div>
                    <Upload size={48} style={{ color: TavariStyles?.colors?.gray400 || '#9ca3af', margin: '0 auto', marginBottom: TavariStyles?.spacing?.md || '12px' }} />
                    <button
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept =
                          'image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml';
                        input.onchange = (e) => {
                          if (e.target.files[0]) {
                            handleUploadAsset(e.target.files[0], 'logo');
                          }
                        };
                        input.click();
                      }}
                      style={uploadStyles.uploadButton}
                    >
                      <Upload size={16} />
                      Upload Logo
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Favicon Upload */}
            <div style={uploadStyles.uploadSection}>
              <div style={uploadStyles.uploadHeader}>
                <h3 style={uploadStyles.uploadTitle}>Favicon</h3>
                <span style={uploadStyles.sizeHint}>(Recommended: 32x32px or 64x64px)</span>
              </div>
              <div style={uploadStyles.uploadArea}>
                {brandingData?.favicon_url ? (
                  <div>
                    <img
                      src={brandingData.favicon_url}
                      alt="Favicon"
                      style={uploadStyles.faviconPreview}
                    />
                    <button
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/x-icon,image/png';
                        input.onchange = (e) => {
                          if (e.target.files[0]) {
                            handleUploadAsset(e.target.files[0], 'favicon');
                          }
                        };
                        input.click();
                      }}
                      style={uploadStyles.uploadButton}
                    >
                      <Upload size={16} />
                      Replace Favicon
                    </button>
                  </div>
                ) : (
                  <div>
                    <Upload size={48} style={{ color: TavariStyles?.colors?.gray400 || '#9ca3af', margin: '0 auto', marginBottom: TavariStyles?.spacing?.md || '12px' }} />
                    <button
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept =
                          'image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon';
                        input.onchange = (e) => {
                          if (e.target.files[0]) {
                            handleUploadAsset(e.target.files[0], 'favicon');
                          }
                        };
                        input.click();
                      }}
                      style={uploadStyles.uploadButton}
                    >
                      <Upload size={16} />
                      Upload Favicon
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BasicInfoTab;