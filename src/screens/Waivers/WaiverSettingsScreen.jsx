// Step 88: Create WaiverSettingsScreen.jsx
// Global waiver settings configuration
import React, { useState, useEffect } from 'react';
import { FiSettings, FiSave } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useWaiversShell, useWaiversShellStyle } from '../../contexts/WaiversShellContext';
import WaiverSettingsService from '../../services/Waivers/WaiverSettingsService';
import LegacyImportSettingsPanel from '../../components/Waivers/LegacyImportSettingsPanel';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import toast from 'react-hot-toast';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';

const DEFAULT_PARTICIPANT_FIELDS_CONFIG = {
  participantFields: {
    phoneNumber: true,
    emailAddress: true,
    firstName: true,
    lastName: true,
    birthdate: true,
    address: true,
    city: true,
    postalCode: true
  },
  minorFields: {}
};

const FIELD_KEY_ALIASES = {
  streetAddress: 'address',
  street_address: 'address'
};

const normalizeParticipantFieldsConfig = (value) => {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rootParticipantFields = {};

  ['firstName', 'lastName', 'birthdate', 'phoneNumber', 'emailAddress', 'address', 'city', 'postalCode'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      rootParticipantFields[key] = config[key];
    }
  });

  Object.keys(FIELD_KEY_ALIASES).forEach((legacyKey) => {
    if (Object.prototype.hasOwnProperty.call(config, legacyKey)) {
      rootParticipantFields[FIELD_KEY_ALIASES[legacyKey]] = config[legacyKey];
    }
  });

  const nestedParticipantFields =
    config.participantFields && typeof config.participantFields === 'object' ? config.participantFields : {};
  Object.keys(FIELD_KEY_ALIASES).forEach((legacyKey) => {
    if (Object.prototype.hasOwnProperty.call(nestedParticipantFields, legacyKey)) {
      rootParticipantFields[FIELD_KEY_ALIASES[legacyKey]] = nestedParticipantFields[legacyKey];
    }
  });

  return {
    participantFields: {
      ...DEFAULT_PARTICIPANT_FIELDS_CONFIG.participantFields,
      ...rootParticipantFields,
      ...nestedParticipantFields
    },
    minorFields: {
      ...(config.minorFields && typeof config.minorFields === 'object' ? config.minorFields : {})
    }
  };
};

const WaiverSettingsScreen = () => {
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'WaiverSettingsScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const { hideModuleDeactivation } = useWaiversShell();
  const containerStyle = useWaiversShellStyle(styles.container);
  useSecurityContext({
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    componentName: 'WaiverSettingsScreen',
    sensitiveComponent: true
  });

  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (auth.selectedBusinessId) {
      WaiverSettingsService.setBusinessId(auth.selectedBusinessId);
      loadSettings();
    }
  }, [auth.selectedBusinessId]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await WaiverSettingsService.getGlobalSettings();
      setSettings({
        ...data,
        participant_fields_config: normalizeParticipantFieldsConfig(data?.participant_fields_config)
      });
    } catch (error) {
      console.error('Error loading settings:', error);
      toast.error('Error loading settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      // Save all settings
      for (const [key, value] of Object.entries(settings)) {
        await WaiverSettingsService.updateSetting(key, value);
      }
      toast.success('Settings saved');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSettingChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleParticipantFieldToggle = (fieldKey, checked) => {
    setSettings(prev => ({
      ...prev,
      participant_fields_config: {
        ...normalizeParticipantFieldsConfig(prev.participant_fields_config),
        participantFields: {
          ...normalizeParticipantFieldsConfig(prev.participant_fields_config).participantFields,
          [fieldKey]: checked
        }
      }
    }));
  };

  const canManageSettings = hasPermission('waivers.settings.manage') || hasElevatedPrivileges();

  if (auth.authLoading || loading) {
    return (
      <POSAuthWrapper componentName="WaiverSettingsScreen">
        <div style={TavariStyles.loadingContainer}>
          <p>Loading...</p>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!canManageSettings) {
    return (
      <POSAuthWrapper componentName="WaiverSettingsScreen">
        <div style={TavariStyles.errorContainer}>
          <h2>Access Denied</h2>
          <p>You do not have permission to manage settings.</p>
        </div>
      </POSAuthWrapper>
    );
  }

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'participant_info', label: 'Participant Info' },
    { id: 'signature', label: 'Signature' },
    { id: 'expiry', label: 'Expiry' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'consents', label: 'Consents' },
    { id: 'legacy_import', label: 'Legacy import' }
  ];

  return (
    <POSAuthWrapper componentName="WaiverSettingsScreen">
      <SecurityWrapper componentName="WaiverSettingsScreen" sensitiveComponent={true}>
        <div style={containerStyle}>
          <div style={styles.header}>
            <FiSettings size={32} style={styles.headerIcon} />
            <h1 style={styles.title}>Waiver Settings</h1>
            <button
              onClick={handleSave}
              disabled={saving}
              style={styles.saveButton}
            >
              <FiSave /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>

          <TavariTabSystemComponent
            tabs={tabs}
            mode="state"
            activeTab={activeTab}
            onTabChange={setActiveTab}
            ariaLabel="Waiver settings"
          />

          <div style={styles.content}>
            {activeTab === 'general' && (
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>General Settings</h3>
                <div style={styles.settingItem}>
                  <label style={styles.settingLabel}>Default Expiry Days:</label>
                  <input
                    type="number"
                    value={settings.default_expiry_days || 365}
                    onChange={(e) => handleSettingChange('default_expiry_days', parseInt(e.target.value))}
                    style={styles.settingInput}
                  />
                </div>
                <div style={styles.settingItem}>
                  <label style={styles.settingLabel}>Minor Age Threshold:</label>
                  <input
                    type="number"
                    value={settings.minor_age_threshold || 18}
                    onChange={(e) => handleSettingChange('minor_age_threshold', parseInt(e.target.value))}
                    style={styles.settingInput}
                  />
                </div>
              </div>
            )}

            {activeTab === 'participant_info' && (
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>Participant Information</h3>
                <p style={styles.helperText}>
                  Choose which extra fields should be collected on waiver forms. Any field enabled here
                  will be shown and required during waiver entry.
                </p>
                <div style={styles.settingItem}>
                  <TavariCheckbox
                    checked={normalizeParticipantFieldsConfig(settings.participant_fields_config).participantFields.phoneNumber}
                    onChange={(checked) => handleParticipantFieldToggle('phoneNumber', checked)}
                    label="Collect phone number"
                  />
                </div>
                <div style={styles.settingItem}>
                  <TavariCheckbox
                    checked={normalizeParticipantFieldsConfig(settings.participant_fields_config).participantFields.emailAddress}
                    onChange={(checked) => handleParticipantFieldToggle('emailAddress', checked)}
                    label="Collect email address"
                  />
                </div>
                <div style={styles.settingItem}>
                  <TavariCheckbox
                    checked={normalizeParticipantFieldsConfig(settings.participant_fields_config).participantFields.address}
                    onChange={(checked) => handleParticipantFieldToggle('address', checked)}
                    label="Collect street address"
                  />
                </div>
                <div style={styles.settingItem}>
                  <TavariCheckbox
                    checked={normalizeParticipantFieldsConfig(settings.participant_fields_config).participantFields.city}
                    onChange={(checked) => handleParticipantFieldToggle('city', checked)}
                    label="Collect city"
                  />
                </div>
                <div style={styles.settingItem}>
                  <TavariCheckbox
                    checked={normalizeParticipantFieldsConfig(settings.participant_fields_config).participantFields.postalCode}
                    onChange={(checked) => handleParticipantFieldToggle('postalCode', checked)}
                    label="Collect postal code"
                  />
                </div>
              </div>
            )}

            {activeTab === 'signature' && (
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>Signature Settings</h3>
                <div style={styles.settingItem}>
                  <TavariCheckbox
                    checked={settings.require_digital_signature !== false}
                    onChange={(checked) => handleSettingChange('require_digital_signature', checked)}
                    label="Require Digital Signature"
                  />
                </div>
                <div style={styles.settingItem}>
                  <TavariCheckbox
                    checked={settings.require_guardian_signature || false}
                    onChange={(checked) => handleSettingChange('require_guardian_signature', checked)}
                    label="Require Guardian Signature for Minors"
                  />
                </div>
              </div>
            )}

            {activeTab === 'expiry' && (
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>Expiry Settings</h3>
                <div style={styles.settingItem}>
                  <label style={styles.settingLabel}>Expiry Warning Days:</label>
                  <input
                    type="number"
                    value={settings.expiry_warning_days || 30}
                    onChange={(e) => handleSettingChange('expiry_warning_days', parseInt(e.target.value))}
                    style={styles.settingInput}
                  />
                </div>
                <div style={styles.settingItem}>
                  <TavariCheckbox
                    checked={settings.auto_expire || false}
                    onChange={(checked) => handleSettingChange('auto_expire', checked)}
                    label="Automatically Mark Expired Waivers as Invalid"
                  />
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>Notification Settings</h3>
                <div style={styles.settingItem}>
                  <TavariCheckbox
                    checked={settings.send_expiry_reminders || false}
                    onChange={(checked) => handleSettingChange('send_expiry_reminders', checked)}
                    label="Send Expiry Reminders"
                  />
                </div>
                <div style={styles.settingItem}>
                  <label style={styles.settingLabel}>Reminder Days Before Expiry:</label>
                  <input
                    type="number"
                    value={settings.reminder_days || 7}
                    onChange={(e) => handleSettingChange('reminder_days', parseInt(e.target.value))}
                    style={styles.settingInput}
                  />
                </div>
              </div>
            )}

            {activeTab === 'consents' && (
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>Consent Settings</h3>
                <div style={styles.settingItem}>
                  <TavariCheckbox
                    checked={settings.auto_click_marketing !== false}
                    onChange={(checked) => handleSettingChange('auto_click_marketing', checked)}
                    label="Preselect Marketing Consent (customer can uncheck)"
                  />
                </div>
              </div>
            )}

            {activeTab === 'legacy_import' && (
              <LegacyImportSettingsPanel businessId={auth.selectedBusinessId} />
            )}
          </div>

          {!hideModuleDeactivation && <ModuleDeactivationPanel moduleKey="waivers" />}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.background,
    padding: TavariStyles.spacing.xl,
    paddingTop: 0
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: TavariStyles.spacing.xl
  },
  headerIcon: {
    color: TavariStyles.colors.primary
  },
  title: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    margin: 0
  },
  saveButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600'
  },
  tabs: {
    display: 'flex',
    gap: '2px',
    marginBottom: '12px',
    backgroundColor: '#e5e7eb',
    borderRadius: '8px',
    padding: '4px',
    overflowX: 'auto'
  },
  content: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    boxShadow: TavariStyles.shadows.sm
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.md
  },
  settingItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs,
    marginBottom: TavariStyles.spacing.md
  },
  settingLabel: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '500',
    color: TavariStyles.colors.text,
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },
  settingInput: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: TavariStyles.typography.fontSize.base,
    maxWidth: '300px'
  },
  helperText: {
    margin: 0,
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: 1.5
  }
};

export default WaiverSettingsScreen;




