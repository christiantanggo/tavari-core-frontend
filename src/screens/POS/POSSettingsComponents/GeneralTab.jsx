// src/screens/POS/POSSettingsComponents/GeneralTab.jsx - Fixed to only update parent state, no database operations
import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { TavariStyles } from '../../../utils/TavariStyles';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import RegisterStationsSettings from './RegisterStationsSettings';
import { applyRegisterStationToDevice } from '../../../services/posRegisterStationsService';

const GeneralTab = ({ settings, handleInputChange, businessId, currentTerminalId, onTerminalChange, canEdit }) => {
  const [availableTerminals, setAvailableTerminals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (businessId) {
      loadAvailableTerminals();
    }
  }, [businessId]);

  const loadAvailableTerminals = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: terminals, error: terminalsError } = await supabase
        .from('pos_terminals')
        .select('*')
        .eq('business_id', businessId)
        .order('terminal_name');

      if (terminalsError) throw terminalsError;

      setAvailableTerminals(terminals || []);

      if (!currentTerminalId && terminals && terminals.length > 0) {
        const deviceId = getStoredDeviceId();
        const matchingTerminal = terminals.find(t => 
          localStorage.getItem(`terminal_device_${t.terminal_id}`) === deviceId
        );
        
        if (matchingTerminal) {
          onTerminalChange(matchingTerminal.terminal_id);
        }
      }

    } catch (err) {
      console.error('Error loading terminals:', err);
      setError(`Failed to load terminals: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getStoredDeviceId = () => {
    let deviceId = localStorage.getItem('tavari_device_id');
    if (!deviceId) {
      deviceId = `DEV_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      localStorage.setItem('tavari_device_id', deviceId);
    }
    return deviceId;
  };

  const handleTerminalSelect = async (terminalId) => {
    if (terminalId === 'business') {
      onTerminalChange(null);
      localStorage.removeItem('tavari_terminal_id');
      localStorage.removeItem('tavari_terminal_name');
    } else {
      const terminal = availableTerminals.find(t => t.terminal_id === terminalId);
      onTerminalChange(terminalId);
      
      if (terminal) {
        applyRegisterStationToDevice(terminal);
      }
    }
  };

  const handleStationSelected = (terminalId, station) => {
    onTerminalChange(terminalId);
    if (station) {
      applyRegisterStationToDevice(station);
    }
    loadAvailableTerminals();
  };

  const getCurrentTerminal = () => {
    return availableTerminals.find(t => t.terminal_id === currentTerminalId);
  };

  if (loading) {
    return (
      <div style={styles.tabContent}>
        <div style={styles.loading}>
          <div style={TavariStyles.components.loading.spinner}></div>
          <div>Loading terminal configuration...</div>
          <style>{TavariStyles.keyframes.spin}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.tabContent}>
      {error && (
        <div style={styles.errorBanner}>
          <strong>Error:</strong> {error}
          <button
            style={styles.clearErrorButton}
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Current Terminal Section */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Current Terminal</h3>
        
        {currentTerminalId && getCurrentTerminal() ? (
          <div style={styles.currentTerminalCard}>
            <div style={styles.terminalHeader}>
              <strong>{getCurrentTerminal().terminal_name}</strong>
              <span style={styles.terminalId}>({getCurrentTerminal().terminal_id})</span>
            </div>
            {getCurrentTerminal().location_description && (
              <div style={styles.terminalLocation}>
                📍 {getCurrentTerminal().location_description}
              </div>
            )}
            <div style={styles.terminalMeta}>
              Float: ${Number(getCurrentTerminal().float_amount || settings.default_float_amount || 200).toFixed(2)}
              {getCurrentTerminal().helcim_device_code
                ? ` · Helcim: ${getCurrentTerminal().helcim_device_code}`
                : ' · Helcim: not configured'}
            </div>
            <div style={styles.terminalMeta}>
              Created: {new Date(getCurrentTerminal().created_at).toLocaleDateString()}
            </div>
          </div>
        ) : (
          <div style={styles.noTerminalCard}>
            <strong>Business Default Mode</strong>
            <div style={styles.settingDescription}>
              Settings apply to all terminals. Select a specific terminal for device-specific configuration.
            </div>
          </div>
        )}
      </div>

      {/* Terminal Configuration Section */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Terminal Configuration</h3>
        
        <div style={styles.setting}>
          <label style={styles.label}>Terminal Mode:</label>
          <select
            value={settings.terminal_mode || 'manual'}
            onChange={(e) => handleInputChange('terminal_mode', e.target.value)}
            style={styles.select}
          >
            <option value="manual">Manual Entry</option>
            <option value="integrated">Fully Integrated</option>
            <option value="kiosk">Self-Service Kiosk</option>
          </select>
          <div style={styles.settingDescription}>
            Manual: Basic cash register functions. Integrated: Full POS with payments. Kiosk: Customer-facing self-service.
          </div>
        </div>

        <div style={styles.setting}>
          <TavariCheckbox
            checked={settings.pin_required || false}
            onChange={(checked) => handleInputChange('pin_required', checked)}
            label="Require PIN for Access"
            size="md"
          />
          <div style={styles.settingDescription}>
            When enabled, users will need to enter a PIN to access the POS system.
          </div>
        </div>
      </div>

      {/* Daily Deposit Configuration Section */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Daily Deposit Configuration</h3>
        
        <div style={styles.setting}>
          <label style={styles.label}>Default Float Amount:</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={settings.default_float_amount || '200.00'}
            onChange={(e) => handleInputChange('default_float_amount', parseFloat(e.target.value) || 0)}
            style={styles.input}
            placeholder="200.00"
          />
          <div style={styles.settingDescription}>
            Amount of cash that should remain in the drawer at the start of each day. Used as the default when adding new register stations.
          </div>
        </div>

        <div style={styles.setting}>
          <label style={styles.label}>Maximum Drawer Variance:</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={settings.max_drawer_variance || '5.00'}
            onChange={(e) => handleInputChange('max_drawer_variance', parseFloat(e.target.value) || 0)}
            style={styles.input}
            placeholder="5.00"
          />
          <div style={styles.settingDescription}>
            Maximum allowed variance between expected and counted cash before requiring manager approval.
          </div>
        </div>

        <div style={styles.setting}>
          <TavariCheckbox
            checked={settings.require_manager_pin_for_variance !== undefined ? settings.require_manager_pin_for_variance : true}
            onChange={(checked) => handleInputChange('require_manager_pin_for_variance', checked)}
            label="Require Manager PIN for Large Variances"
            size="md"
          />
          <div style={styles.settingDescription}>
            When enabled, deposits with variances exceeding the maximum will require manager PIN approval.
          </div>
        </div>

        <div style={styles.setting}>
          <TavariCheckbox
            checked={settings.deposit_history_requires_manager !== undefined ? settings.deposit_history_requires_manager : true}
            onChange={(checked) => handleInputChange('deposit_history_requires_manager', checked)}
            label="Require Manager Access for Deposit History"
            size="md"
          />
          <div style={styles.settingDescription}>
            When enabled, viewing deposit history will require manager PIN verification.
          </div>
        </div>
      </div>

      <RegisterStationsSettings
        businessId={businessId}
        defaultFloatAmount={Number(settings.default_float_amount) || 200}
        canEdit={canEdit}
        currentTerminalId={currentTerminalId}
        onStationSelected={handleStationSelected}
        onStationsChanged={setAvailableTerminals}
      />
    </div>
  );
};

const styles = {
  tabContent: {
    padding: TavariStyles.spacing['3xl']
  },

  loading: {
    ...TavariStyles.components.loading.container,
    minHeight: '300px'
  },

  errorBanner: {
    ...TavariStyles.components.banner.base,
    ...TavariStyles.components.banner.variants.error,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: TavariStyles.spacing.xl
  },

  clearErrorButton: {
    background: 'none',
    border: 'none',
    color: TavariStyles.colors.errorText,
    fontSize: TavariStyles.typography.fontSize.xl,
    cursor: 'pointer',
    padding: TavariStyles.spacing.xs
  },

  section: {
    marginBottom: TavariStyles.spacing['3xl']
  },

  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.xl,
    paddingBottom: TavariStyles.spacing.md,
    borderBottom: `2px solid ${TavariStyles.colors.primary}`
  },

  setting: {
    marginBottom: TavariStyles.spacing.xl
  },

  label: {
    ...TavariStyles.components.form.label
  },

  select: {
    ...TavariStyles.components.form.select,
    minWidth: '300px'
  },

  input: {
    ...TavariStyles.components.form.input,
    maxWidth: '200px'
  },

  settingDescription: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    marginTop: TavariStyles.spacing.xs,
    lineHeight: TavariStyles.typography.lineHeight.relaxed
  },

  currentTerminalCard: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing.xl,
    backgroundColor: TavariStyles.colors.primary + '10',
    border: `2px solid ${TavariStyles.colors.primary}`
  },

  noTerminalCard: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing.xl,
    backgroundColor: TavariStyles.colors.gray50
  },

  terminalHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    marginBottom: TavariStyles.spacing.sm,
    fontSize: TavariStyles.typography.fontSize.lg
  },

  terminalId: {
    color: TavariStyles.colors.gray500,
    fontSize: TavariStyles.typography.fontSize.sm,
    fontFamily: TavariStyles.typography.fontFamilyMono
  },

  terminalLocation: {
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.sm,
    marginBottom: TavariStyles.spacing.xs
  },

  terminalMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.lg,
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500
  },

  createTerminalButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.secondary
  },

  createTerminalForm: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing.xl,
    backgroundColor: TavariStyles.colors.gray50,
    border: `2px dashed ${TavariStyles.colors.gray300}`
  },

  formTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.lg
  },

  formField: {
    marginBottom: TavariStyles.spacing.lg
  },

  formActions: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    marginTop: TavariStyles.spacing.xl
  },

  saveTerminalButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary
  },

  cancelButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.secondary
  }
};

export default GeneralTab;

