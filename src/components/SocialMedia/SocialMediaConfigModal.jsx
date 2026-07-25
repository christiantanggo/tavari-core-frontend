// components/SocialMedia/SocialMediaConfigModal.jsx
// Modal for configuring social media platform settings
import React, { useState, useEffect } from 'react';
import { X, Save, Eye, EyeOff } from 'lucide-react';
import { ConfigService } from '../../services/socialMedia/ConfigService';
import { TikTokOAuthService } from '../../services/socialMedia/TikTokOAuthService';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import toast from 'react-hot-toast';

const SocialMediaConfigModal = ({
  isOpen,
  onClose,
  onSave,
  businessId,
  platform,
  existingConfig,
}) => {
  const [saving, setSaving] = useState(false);
  const [showTokens, setShowTokens] = useState({});
  const [formData, setFormData] = useState({
    isEnabled: true,
    postingEnabled: true,
    autoPostingEnabled: false,
    postingFrequencyHours: 4,
    maxPostsPerDay: 6,
    contentStyle: 'professional',
    includeHashtags: true,
    hashtagCount: 10,
    includeEmoji: true,
    accessToken: '',
    accessTokenSecret: '',
    apiKey: '',
    apiSecret: '',
    pageId: '',
    accountId: '',
    preferredPostingTimes: null,
  });

  useEffect(() => {
    if (existingConfig) {
      setFormData({
        isEnabled: existingConfig.isEnabled,
        postingEnabled: existingConfig.preferences.postingEnabled,
        autoPostingEnabled: existingConfig.preferences.autoPostingEnabled,
        postingFrequencyHours: existingConfig.preferences.postingFrequencyHours,
        maxPostsPerDay: existingConfig.preferences.maxPostsPerDay,
        contentStyle: existingConfig.preferences.contentStyle,
        includeHashtags: existingConfig.preferences.includeHashtags,
        hashtagCount: existingConfig.preferences.hashtagCount,
        includeEmoji: existingConfig.preferences.includeEmoji,
        accessToken: existingConfig.credentials?.accessToken || '',
        accessTokenSecret: existingConfig.credentials?.accessTokenSecret || '',
        apiKey: existingConfig.credentials?.apiKey || '',
        apiSecret: existingConfig.credentials?.apiSecret || '',
        pageId: existingConfig.credentials?.pageId || '',
        accountId: existingConfig.credentials?.accountId || '',
        preferredPostingTimes: existingConfig.preferences.preferredPostingTimes,
      });
    }
  }, [existingConfig]);

  const handleSave = async () => {
    if (!businessId || !platform) {
      toast.error('Missing business ID or platform');
      return;
    }

    setSaving(true);
    try {
      const configService = new ConfigService();
      await configService.saveBusinessConfig({
        businessId,
        platform,
        isEnabled: formData.isEnabled,
        credentials: {
          accessToken: formData.accessToken,
          accessTokenSecret: formData.accessTokenSecret,
          apiKey: formData.apiKey,
          apiSecret: formData.apiSecret,
          pageId: formData.pageId,
          accountId: formData.accountId,
        },
        preferences: {
          postingEnabled: formData.postingEnabled,
          autoPostingEnabled: formData.autoPostingEnabled,
          postingFrequencyHours: formData.postingFrequencyHours,
          maxPostsPerDay: formData.maxPostsPerDay,
          contentStyle: formData.contentStyle,
          includeHashtags: formData.includeHashtags,
          hashtagCount: formData.hashtagCount,
          includeEmoji: formData.includeEmoji,
          preferredPostingTimes: formData.preferredPostingTimes,
        },
      });

      toast.success(`${platform.charAt(0).toUpperCase() + platform.slice(1)} configuration saved`);
      if (onSave) onSave();
    } catch (error) {
      console.error('Error saving config:', error);
      toast.error('Failed to save configuration: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const toggleShowToken = (field) => {
    setShowTokens(prev => ({ ...prev, [field]: !prev[field] }));
  };

  if (!isOpen) return null;

  const platformLabels = {
    instagram: 'Instagram',
    facebook: 'Facebook',
    twitter: 'Twitter/X',
    tiktok: 'TikTok',
  };

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: TavariStyles.spacing.lg,
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      width: '100%',
      maxWidth: '700px',
      maxHeight: '90vh',
      overflowY: 'auto',
      boxShadow: TavariStyles.shadows?.xl || '0 20px 25px -5px rgba(0,0,0,0.1)',
    },
    header: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      color: TavariStyles.colors.gray600,
    },
    content: {
      padding: TavariStyles.spacing.xl,
    },
    section: {
      marginBottom: TavariStyles.spacing.xl,
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.md,
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.md,
    },
    label: {
      display: 'block',
      marginBottom: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
    },
    input: {
      width: '100%',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      boxSizing: 'border-box',
    },
    checkbox: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
    checkboxInput: {
      width: '18px',
      height: '18px',
      cursor: 'pointer',
    },
    passwordInput: {
      position: 'relative',
    },
    passwordToggle: {
      position: 'absolute',
      right: '12px',
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: TavariStyles.colors.gray600,
      padding: '4px',
    },
    footer: {
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'flex-end',
      gap: TavariStyles.spacing.md,
    },
    cancelButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    saveButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      cursor: saving ? 'not-allowed' : 'pointer',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      opacity: saving ? 0.6 : 1,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
    helpText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      marginTop: '4px',
    },
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            Configure {platformLabels[platform] || platform}
          </h2>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.content}>
          {/* Credentials Section */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>API Credentials</h3>
            
            {platform === 'instagram' || platform === 'facebook' ? (
              <>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Access Token *</label>
                  <div style={styles.passwordInput}>
                    <input
                      type={showTokens.accessToken ? 'text' : 'password'}
                      value={formData.accessToken}
                      onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
                      style={styles.input}
                      placeholder="Enter access token"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowToken('accessToken')}
                      style={styles.passwordToggle}
                    >
                      {showTokens.accessToken ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <div style={styles.helpText}>
                    Get your access token from Facebook Developer Console
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Page ID / Account ID *</label>
                  <input
                    type="text"
                    value={formData.pageId}
                    onChange={(e) => setFormData({ ...formData, pageId: e.target.value })}
                    style={styles.input}
                    placeholder="Enter page ID or account ID"
                  />
                </div>
              </>
            ) : platform === 'twitter' ? (
              <>
                <div style={styles.formGroup}>
                  <label style={styles.label}>API Key</label>
                  <div style={styles.passwordInput}>
                    <input
                      type={showTokens.apiKey ? 'text' : 'password'}
                      value={formData.apiKey}
                      onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                      style={styles.input}
                      placeholder="Enter API key"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowToken('apiKey')}
                      style={styles.passwordToggle}
                    >
                      {showTokens.apiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>API Secret</label>
                  <div style={styles.passwordInput}>
                    <input
                      type={showTokens.apiSecret ? 'text' : 'password'}
                      value={formData.apiSecret}
                      onChange={(e) => setFormData({ ...formData, apiSecret: e.target.value })}
                      style={styles.input}
                      placeholder="Enter API secret"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowToken('apiSecret')}
                      style={styles.passwordToggle}
                    >
                      {showTokens.apiSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Access Token</label>
                  <div style={styles.passwordInput}>
                    <input
                      type={showTokens.accessToken ? 'text' : 'password'}
                      value={formData.accessToken}
                      onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
                      style={styles.input}
                      placeholder="Enter access token"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowToken('accessToken')}
                      style={styles.passwordToggle}
                    >
                      {showTokens.accessToken ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Access Token Secret</label>
                  <div style={styles.passwordInput}>
                    <input
                      type={showTokens.accessTokenSecret ? 'text' : 'password'}
                      value={formData.accessTokenSecret}
                      onChange={(e) => setFormData({ ...formData, accessTokenSecret: e.target.value })}
                      style={styles.input}
                      placeholder="Enter access token secret"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowToken('accessTokenSecret')}
                      style={styles.passwordToggle}
                    >
                      {showTokens.accessTokenSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </>
            ) : platform === 'tiktok' ? (
              <>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Connection Method</label>
                  <div style={{ 
                    padding: '16px', 
                    backgroundColor: '#f9fafb', 
                    borderRadius: '8px',
                    marginBottom: '16px'
                  }}>
                    <p style={{ fontSize: '14px', color: '#374151', marginBottom: '12px' }}>
                      Connect your TikTok account using OAuth (recommended) or manually enter credentials.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          // Store business ID for OAuth callback
                          sessionStorage.setItem('tiktok_oauth_business_id', businessId);
                          
                          // Generate state token
                          const state = TikTokOAuthService.generateStateToken();
                          TikTokOAuthService.storeStateToken(state);
                          
                          // Get redirect URI
                          const redirectUri = `${window.location.origin}/auth/tiktok/callback`;
                          
                          // Generate TikTok OAuth URL
                          const authUrl = TikTokOAuthService.generateAuthUrl(
                            businessId,
                            redirectUri,
                            state
                          );
                          
                          // Redirect to TikTok OAuth
                          window.location.href = authUrl;
                        } catch (error) {
                          console.error('Error initiating TikTok OAuth:', error);
                          toast.error(`Failed to connect: ${error.message}`);
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '12px 24px',
                        backgroundColor: '#000000',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        marginBottom: '12px',
                      }}
                    >
                      Connect via TikTok OAuth
                    </button>
                    <div style={styles.helpText}>
                      Click to authorize Tavari to access your TikTok account. You'll be redirected to TikTok to sign in.
                    </div>
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Access Token (if connecting manually)</label>
                  <div style={styles.passwordInput}>
                    <input
                      type={showTokens.accessToken ? 'text' : 'password'}
                      value={formData.accessToken}
                      onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
                      style={styles.input}
                      placeholder="Enter TikTok access token (optional if using OAuth)"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowToken('accessToken')}
                      style={styles.passwordToggle}
                    >
                      {showTokens.accessToken ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <div style={styles.helpText}>
                    Only needed if not using OAuth. Get from TikTok Developer Portal.
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Account ID / Username</label>
                  <input
                    type="text"
                    value={formData.accountId || formData.pageId}
                    onChange={(e) => setFormData({ ...formData, accountId: e.target.value, pageId: e.target.value })}
                    style={styles.input}
                    placeholder="Enter TikTok username or account ID"
                  />
                  <div style={styles.helpText}>
                    Your TikTok username (without @) or account ID
                  </div>
                </div>
              </>
            ) : (
              <div style={styles.helpText}>
                Platform configuration not available.
              </div>
            )}
          </div>

          {/* Posting Preferences */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Posting Preferences</h3>

            <div style={styles.formGroup}>
              <TavariCheckbox
                checked={formData.postingEnabled}
                onChange={(checked) => setFormData({ ...formData, postingEnabled: checked })}
                label="Enable Posting"
                disabled={saving}
              />
            </div>

            <div style={styles.formGroup}>
              <TavariCheckbox
                checked={formData.autoPostingEnabled}
                onChange={(checked) => setFormData({ ...formData, autoPostingEnabled: checked })}
                label="Enable Auto-Posting"
                disabled={saving}
              />
              <div style={styles.helpText}>
                Automatically post content based on your schedule
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Posting Frequency (hours between posts)</label>
              <input
                type="number"
                min="1"
                max="24"
                value={formData.postingFrequencyHours}
                onChange={(e) => setFormData({ ...formData, postingFrequencyHours: parseInt(e.target.value) || 4 })}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Max Posts Per Day</label>
              <input
                type="number"
                min="1"
                max="20"
                value={formData.maxPostsPerDay}
                onChange={(e) => setFormData({ ...formData, maxPostsPerDay: parseInt(e.target.value) || 6 })}
                style={styles.input}
              />
            </div>
          </div>

          {/* Content Preferences */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Content Style</h3>

            <div style={styles.formGroup}>
              <label style={styles.label}>Content Style</label>
              <select
                value={formData.contentStyle}
                onChange={(e) => setFormData({ ...formData, contentStyle: e.target.value })}
                style={styles.input}
              >
                <option value="casual">Casual</option>
                <option value="professional">Professional</option>
                <option value="energetic">Energetic</option>
                <option value="friendly">Friendly</option>
              </select>
            </div>

            <div style={styles.formGroup}>
              <TavariCheckbox
                checked={formData.includeHashtags}
                onChange={(checked) => setFormData({ ...formData, includeHashtags: checked })}
                label="Include Hashtags"
                disabled={saving}
              />
            </div>

            {formData.includeHashtags && (
              <div style={styles.formGroup}>
                <label style={styles.label}>Number of Hashtags</label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={formData.hashtagCount}
                  onChange={(e) => setFormData({ ...formData, hashtagCount: parseInt(e.target.value) || 10 })}
                  style={styles.input}
                />
              </div>
            )}

            <div style={styles.formGroup}>
              <TavariCheckbox
                checked={formData.includeEmoji}
                onChange={(checked) => setFormData({ ...formData, includeEmoji: checked })}
                label="Include Emojis"
                disabled={saving}
              />
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelButton}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={styles.saveButton}>
            <Save size={18} />
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SocialMediaConfigModal;

