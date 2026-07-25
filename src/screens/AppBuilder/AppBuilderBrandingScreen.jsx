// Step 82: Create AppBuilderBrandingScreen.jsx
// Complete branding configuration interface - Tavari Standards
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Palette, Upload, Eye, Save, AlertCircle } from 'lucide-react';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useAppBuilderBranding } from '../../hooks/useAppBuilderBranding';
import SecurityWrapper from '../../Security/SecurityWrapper.jsx';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePermissions } from '../../hooks/usePermissions';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import AppBuilderBrandingTab from '../../components/AppBuilder/AppBuilderBrandingTab';
import AppBuilderPWASettings from '../../components/AppBuilder/AppBuilderPWASettings';
import { TavariStyles } from '../../utils/TavariStyles';
import { getContainerStyles, getCenteredContentStyles } from '../../utils/tavariLayoutUtils';
import EmployeeFullWidthButton from '../../components/UI/EmployeeFullWidthButton';

// Get styles function
const getStyles = () => {
  try {
    return {
      container: {
        minHeight: '100vh',
        backgroundColor: TavariStyles?.colors?.gray50 || TavariStyles?.colors?.background || '#f9fafb',
        padding: TavariStyles?.spacing?.xl || '20px',
        paddingTop: '120px' // Account for fixed header
      },
      loadingContainer: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: TavariStyles?.colors?.gray50 || '#f9fafb'
      },
      loadingContent: {
        textAlign: 'center'
      },
      spinner: {
        width: '48px',
        height: '48px',
        border: `3px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
        borderTop: `3px solid ${TavariStyles?.colors?.primary || '#008080'}`,
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        margin: '0 auto'
      },
      loadingText: {
        marginTop: TavariStyles?.spacing?.lg || '16px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px'
      },
      content: {
        ...getCenteredContentStyles('1200px')
      },
      header: {
        marginBottom: TavariStyles?.spacing?.xl || '20px',
        textAlign: 'center'
      },
      title: {
        fontSize: TavariStyles?.typography?.fontSize?.['3xl'] || '24px',
        fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        marginBottom: TavariStyles?.spacing?.sm || '8px',
        margin: 0
      },
      subtitle: {
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        margin: 0
      },
      errorContainer: {
        backgroundColor: TavariStyles?.colors?.errorBg || '#fee2e2',
        border: `1px solid ${TavariStyles?.colors?.danger || '#ef4444'}`,
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        padding: TavariStyles?.spacing?.md || '12px',
        marginBottom: TavariStyles?.spacing?.xl || '20px',
        display: 'flex',
        alignItems: 'center',
        gap: TavariStyles?.spacing?.md || '12px'
      },
      errorText: {
        color: TavariStyles?.colors?.errorText || '#dc2626',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        margin: 0
      },
      tabContainer: {
        backgroundColor: TavariStyles?.colors?.white || '#ffffff',
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        boxShadow: TavariStyles?.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
        marginBottom: TavariStyles?.spacing?.xl || '20px',
        padding: `${TavariStyles?.spacing?.xl || '20px'} ${TavariStyles?.spacing?.xl || '20px'} ${TavariStyles?.spacing?.xl || '20px'} ${TavariStyles?.spacing?.xl || '20px'}`
      },
      tabNav: {
        display: 'flex',
        gap: '2px',
        marginBottom: '30px',
        backgroundColor: '#e5e7eb',
        borderRadius: '8px',
        padding: '4px',
        overflowX: 'auto'
      },
      tabButton: {
        flex: 1,
        padding: '12px 20px',
        backgroundColor: 'transparent',
        color: '#6b7280',
        border: 'none',
        borderRadius: '6px',
        fontSize: '14px',
        fontWeight: 'bold',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        whiteSpace: 'nowrap',
        minWidth: 'fit-content'
      },
      tabButtonActive: {
        backgroundColor: 'white',
        color: '#008080',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      },
      tabContent: {
        paddingTop: TavariStyles?.spacing?.xl || '20px'
      },
      sectionTitle: {
        fontSize: TavariStyles?.typography?.fontSize?.lg || '18px',
        fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        marginBottom: TavariStyles?.spacing?.md || '12px',
        margin: 0
      },
      uploadArea: {
        border: `2px dashed ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        padding: TavariStyles?.spacing?.xl || '20px',
        textAlign: 'center'
      },
      uploadButton: {
        color: TavariStyles?.colors?.primary || '#008080',
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
        backgroundColor: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: TavariStyles?.spacing?.xs || '4px',
        transition: 'all 0.2s ease'
      },
      fieldGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: TavariStyles?.spacing?.lg || '16px',
        marginBottom: TavariStyles?.spacing?.xl || '20px'
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
      },
      textarea: {
        width: '100%',
        padding: '12px 16px',
        border: `2px solid ${TavariStyles?.colors?.primary || '#008080'}`,
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        fontFamily: 'inherit',
        resize: 'vertical',
        outline: 'none',
        boxSizing: 'border-box',
        transition: 'border-color 0.2s ease'
      },
      buttonGroup: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: TavariStyles?.spacing?.md || '12px',
        marginTop: TavariStyles?.spacing?.xl || '20px'
      },
      cancelButton: {
        padding: `${TavariStyles?.spacing?.sm || '8px'} ${TavariStyles?.spacing?.xl || '20px'}`,
        border: `2px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        color: TavariStyles?.colors?.gray700 || '#374151',
        backgroundColor: TavariStyles?.colors?.white || '#ffffff',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      },
      saveButton: {
        padding: `${TavariStyles?.spacing?.sm || '8px'} ${TavariStyles?.spacing?.xl || '20px'}`,
        backgroundColor: TavariStyles?.colors?.primary || '#008080',
        color: TavariStyles?.colors?.white || '#ffffff',
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        border: 'none',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: TavariStyles?.spacing?.sm || '8px',
        transition: 'all 0.2s ease'
      },
      saveButtonDisabled: {
        opacity: 0.5,
        cursor: 'not-allowed'
      },
      imagePreview: {
        maxWidth: '300px',
        margin: '0 auto',
        marginBottom: TavariStyles?.spacing?.md || '12px'
      },
      faviconPreview: {
        width: '64px',
        height: '64px',
        margin: '0 auto',
        marginBottom: TavariStyles?.spacing?.md || '12px'
      }
    };
  } catch (e) {
    console.error('Error in getStyles:', e);
    return {};
  }
};

const AppBuilderBrandingScreen = () => {
  const navigate = useNavigate();
  const styles = useMemo(() => getStyles(), []);

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'AppBuilderBrandingScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  // Branding hook
  const { branding, loading, error, updateBranding, uploadAsset, generateManifest } = useAppBuilderBranding();

  // Local state
  const [activeTab, setActiveTab] = useState('colors');
  const [brandingData, setBrandingData] = useState({
    app_name: '',
    primary_color: '#3B82F6',
    secondary_color: '#1E40AF',
    accent_color: '#60A5FA',
    logo_url: '',
    favicon_url: '',
    support_email: '',
    privacy_url: '',
    footer_text: ''
  });
  const [saving, setSaving] = useState(false);

  // Fetch business email for auto-filling support_email
  const [businessEmail, setBusinessEmail] = useState('');

  React.useEffect(() => {
    const fetchBusinessEmail = async () => {
      if (!auth.selectedBusinessId) return;
      
      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('business_email')
          .eq('id', auth.selectedBusinessId)
          .single();

        if (!error && data?.business_email) {
          setBusinessEmail(data.business_email);
        }
      } catch (err) {
        console.error('Error fetching business email:', err);
      }
    };

    fetchBusinessEmail();
  }, [auth.selectedBusinessId]);

  React.useEffect(() => {
    if (branding) {
      // Auto-fill support_email with business_email if support_email is empty/null
      // Only auto-fill if support_email is not already set (null, undefined, or empty string)
      const supportEmail = (branding.support_email && branding.support_email.trim() !== '') 
        ? branding.support_email 
        : (businessEmail || '');
      
      setBrandingData({
        app_name: branding.app_name || '',
        primary_color: branding.primary_color || '#3B82F6',
        secondary_color: branding.secondary_color || '#1E40AF',
        accent_color: branding.accent_color || '#60A5FA',
        logo_url: branding.logo_url || '',
        favicon_url: branding.favicon_url || '',
        support_email: supportEmail,
        privacy_url: branding.privacy_url || '',
        footer_text: branding.footer_text || ''
      });
    } else if (businessEmail) {
      // If no branding exists yet, set the support_email default from business_email
      setBrandingData(prev => ({
        ...prev,
        support_email: (prev.support_email && prev.support_email.trim() !== '') 
          ? prev.support_email 
          : businessEmail
      }));
    }
  }, [branding, businessEmail]);

  const canEdit = hasPermission('appbuilder.branding.edit') || hasElevatedPrivileges();

  const handleSave = async () => {
    if (!canEdit) {
      toast.error('You do not have permission to edit branding');
      return;
    }

    try {
      setSaving(true);
      await updateBranding(brandingData);
      toast.success('Branding updated successfully');
    } catch (error) {
      console.error('Error saving branding:', error);
      toast.error('Failed to save branding');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadAsset = async (file, assetType) => {
    try {
      const result = await uploadAsset(file, assetType);
      if (assetType === 'logo') {
        setBrandingData(prev => ({ ...prev, logo_url: result.url }));
      } else if (assetType === 'favicon') {
        setBrandingData(prev => ({ ...prev, favicon_url: result.url }));
      }
      toast.success(`${assetType} uploaded successfully`);
    } catch (error) {
      console.error('Error uploading asset:', error);
      toast.error(`Failed to upload ${assetType}`);
    }
  };

  const tabs = [
    { id: 'colors', label: 'Colors', icon: Palette },
    { id: 'logo', label: 'Logo & Icons', icon: Upload },
    { id: 'pwa', label: 'PWA Settings', icon: Eye },
    { id: 'legal', label: 'Legal', icon: AlertCircle }
  ];

  if (auth.authLoading || loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingContent}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>Loading branding...</p>
        </div>
      </div>
    );
  }

  return (
    <SecurityWrapper>
      <div style={styles.container}>
        <div style={styles.content}>
          {/* Header */}
          <div style={styles.header}>
            <h1 style={styles.title}>Branding Configuration</h1>
            <p style={styles.subtitle}>Customize your app's appearance and branding</p>
          </div>

          {/* Error Message */}
          {error && (
            <div style={styles.errorContainer}>
              <AlertCircle size={20} style={{ color: TavariStyles?.colors?.danger || '#ef4444' }} />
              <p style={styles.errorText}>{error}</p>
            </div>
          )}

          {/* Tabs */}
          <div style={styles.tabContainer}>
            <div style={styles.tabNav}>
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      ...styles.tabButton,
                      ...(activeTab === tab.id ? styles.tabButtonActive : {})
                    }}
                  >
                    <Icon size={18} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Tab Content */}
            <div style={styles.tabContent}>
              {activeTab === 'colors' && (
                <AppBuilderBrandingTab
                  brandingData={brandingData}
                  setBrandingData={setBrandingData}
                  canEdit={canEdit}
                />
              )}

              {activeTab === 'logo' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: TavariStyles?.spacing?.xl || '20px' }}>
                  <PermissionGate permission="appbuilder.branding.edit">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: TavariStyles?.spacing?.sm || '8px', marginBottom: TavariStyles?.spacing?.md || '12px' }}>
                        <h3 style={styles.sectionTitle}>Logo</h3>
                        <span style={{ fontSize: TavariStyles?.typography?.fontSize?.xs || '12px', color: TavariStyles?.colors?.gray500 || '#6b7280', fontWeight: TavariStyles?.typography?.fontWeight?.normal || '400' }}>
                          (Recommended: 512x512px)
                        </span>
                      </div>
                      <div style={styles.uploadArea}>
                        {brandingData.logo_url ? (
                          <div>
                            <img
                              src={brandingData.logo_url}
                              alt="Logo"
                              style={styles.imagePreview}
                            />
                            <button
                              onClick={() => {
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.accept = 'image/*';
                                input.onchange = (e) => {
                                  if (e.target.files[0]) {
                                    handleUploadAsset(e.target.files[0], 'logo');
                                  }
                                };
                                input.click();
                              }}
                              style={styles.uploadButton}
                            >
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
                                input.accept = 'image/*';
                                input.onchange = (e) => {
                                  if (e.target.files[0]) {
                                    handleUploadAsset(e.target.files[0], 'logo');
                                  }
                                };
                                input.click();
                              }}
                              style={styles.uploadButton}
                            >
                              Upload Logo
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </PermissionGate>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: TavariStyles?.spacing?.sm || '8px', marginBottom: TavariStyles?.spacing?.md || '12px' }}>
                      <h3 style={styles.sectionTitle}>Favicon</h3>
                      <span style={{ fontSize: TavariStyles?.typography?.fontSize?.xs || '12px', color: TavariStyles?.colors?.gray500 || '#6b7280', fontWeight: TavariStyles?.typography?.fontWeight?.normal || '400' }}>
                        (Recommended: 32x32px or 64x64px)
                      </span>
                    </div>
                    <div style={styles.uploadArea}>
                      {brandingData.favicon_url ? (
                        <div>
                          <img
                            src={brandingData.favicon_url}
                            alt="Favicon"
                            style={styles.faviconPreview}
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
                            style={styles.uploadButton}
                          >
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
                              input.accept = 'image/x-icon,image/png';
                              input.onchange = (e) => {
                                if (e.target.files[0]) {
                                  handleUploadAsset(e.target.files[0], 'favicon');
                                }
                              };
                              input.click();
                            }}
                            style={styles.uploadButton}
                          >
                            Upload Favicon
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'pwa' && (
                <AppBuilderPWASettings
                  branding={brandingData}
                  onUpdate={setBrandingData}
                  canEdit={canEdit}
                  onGenerateManifest={generateManifest}
                />
              )}

              {activeTab === 'legal' && (
                <div>
                  <div style={styles.fieldGrid}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>
                        Support Email
                      </label>
                      <input
                        type="email"
                        value={brandingData.support_email}
                        onChange={(e) => setBrandingData(prev => ({ ...prev, support_email: e.target.value }))}
                        disabled={!canEdit}
                        placeholder="Enter support email"
                        style={{
                          ...styles.input,
                          ...(!canEdit ? styles.inputDisabled : {})
                        }}
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>
                        Privacy Policy URL
                      </label>
                      <input
                        type="url"
                        value={brandingData.privacy_url}
                        onChange={(e) => setBrandingData(prev => ({ ...prev, privacy_url: e.target.value }))}
                        disabled={!canEdit}
                        placeholder="Enter privacy policy URL"
                        style={{
                          ...styles.input,
                          ...(!canEdit ? styles.inputDisabled : {})
                        }}
                      />
                    </div>
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>
                      Footer Text
                    </label>
                    <textarea
                      value={brandingData.footer_text}
                      onChange={(e) => setBrandingData(prev => ({ ...prev, footer_text: e.target.value }))}
                      disabled={!canEdit}
                      rows={4}
                      placeholder="Enter footer text"
                      style={{
                        ...styles.textarea,
                        ...(!canEdit ? styles.inputDisabled : {})
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Save Button */}
          <PermissionGate permission="appbuilder.branding.edit">
            <div style={styles.buttonGroup}>
              <button
                onClick={() => navigate('/appbuilder')}
                style={styles.cancelButton}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  ...styles.saveButton,
                  ...(saving ? styles.saveButtonDisabled : {})
                }}
              >
                {saving ? (
                  <>
                    <div style={{ ...styles.spinner, width: '16px', height: '16px', borderWidth: '2px' }}></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <Save size={20} />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </PermissionGate>
        </div>
      </div>
    </SecurityWrapper>
  );
};

// Add CSS animation for spinner
if (typeof document !== 'undefined') {
  const existingStyle = document.querySelector('#branding-spinner-animation');
  if (!existingStyle) {
    const style = document.createElement('style');
    style.id = 'branding-spinner-animation';
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

export default AppBuilderBrandingScreen;
