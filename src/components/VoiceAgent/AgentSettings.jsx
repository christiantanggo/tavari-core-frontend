// components/VoiceAgent/AgentSettings.jsx
// Settings for voice agent configuration (API keys, webhooks, notifications)
import React, { useState, useEffect } from 'react';
import { Settings, Save, Key, Bell } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import ModuleDeactivationPanel from '../Modules/ModuleDeactivationPanel';

const AgentSettings = ({ businessId, voiceAgentService, onSaved }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    vapi_api_key: '',
    telnyx_api_key: '',
    webhook_url: '',
    default_voice_provider: '11labs',
    default_voice_id: 'jennifer',
    default_model: 'gpt-4',
    notify_on_new_lead: true,
    notify_on_call_failed: false,
    notification_email: '',
    notification_sms: '',
  });

  useEffect(() => {
    loadConfig();
  }, [businessId]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const configData = await voiceAgentService.getConfiguration();
      if (configData) {
        setConfig({
          ...config,
          ...configData,
        });
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await voiceAgentService.saveConfiguration(config);
      toast.success('Settings saved successfully');
      if (onSaved) onSaved();
    } catch (error) {
      console.error('Error saving configuration:', error);
      toast.error('Failed to save settings: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '48px' }}>
        <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600 }}>Loading settings...</div>
      </div>
    );
  }

  const styles = {
    container: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      maxWidth: '800px',
    },
    section: {
      marginBottom: TavariStyles.spacing['2xl'],
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.md,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
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
      marginBottom: TavariStyles.spacing.sm,
    },
    helpText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      marginTop: '4px',
    },
    saveButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: saving ? 'not-allowed' : 'pointer',
      opacity: saving ? 0.6 : 1,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <Key size={20} />
          Phone Number Configuration
        </h3>
        <div style={{
          padding: TavariStyles.spacing.md,
          backgroundColor: '#f0f9ff',
          borderRadius: TavariStyles.borderRadius?.md || '8px',
          marginBottom: TavariStyles.spacing.md,
          fontSize: TavariStyles.typography.fontSize.sm,
          color: TavariStyles.colors.gray700,
        }}>
          ✅ <strong>Vapi is managed by Tavari</strong> - No setup needed! Just connect your phone number below.
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Telnyx API Key (Optional)</label>
          <input
            type="password"
            value={config.telnyx_api_key || ''}
            onChange={(e) => setConfig({ ...config, telnyx_api_key: e.target.value })}
            style={styles.input}
            placeholder="Enter your Telnyx API key (if you have one)"
          />
          <div style={styles.helpText}>
            Only needed if you want to use your own Telnyx account. Otherwise, Tavari will use the default connection.
          </div>
        </div>
      </div>


      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <Bell size={20} />
          Notifications
        </h3>
        <div style={styles.checkbox}>
          <input
            type="checkbox"
            id="notify_new_lead"
            checked={config.notify_on_new_lead}
            onChange={(e) => setConfig({ ...config, notify_on_new_lead: e.target.checked })}
            style={{ width: '18px', height: '18px' }}
          />
          <label htmlFor="notify_new_lead" style={{ cursor: 'pointer' }}>
            Notify when a new lead is captured
          </label>
        </div>
        <div style={styles.checkbox}>
          <input
            type="checkbox"
            id="notify_call_failed"
            checked={config.notify_on_call_failed}
            onChange={(e) => setConfig({ ...config, notify_on_call_failed: e.target.checked })}
            style={{ width: '18px', height: '18px' }}
          />
          <label htmlFor="notify_call_failed" style={{ cursor: 'pointer' }}>
            Notify when a call fails
          </label>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Notification Email</label>
          <input
            type="email"
            value={config.notification_email || ''}
            onChange={(e) => setConfig({ ...config, notification_email: e.target.value })}
            style={styles.input}
            placeholder="manager@example.com"
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Notification SMS (Phone Number)</label>
          <input
            type="tel"
            value={config.notification_sms || ''}
            onChange={(e) => setConfig({ ...config, notification_sms: e.target.value })}
            style={styles.input}
            placeholder="+1234567890"
          />
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} style={styles.saveButton}>
        <Save size={18} />
        {saving ? 'Saving...' : 'Save Settings'}
      </button>

      <ModuleDeactivationPanel moduleKey="voice_agent" />
    </div>
  );
};

export default AgentSettings;

