// components/POS/HelcimTerminalSetup.jsx - Manual Terminal Registration Component
import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

/**
 * Component for manually registering/connecting a Helcim Gen 2 terminal
 * when automatic discovery fails
 */
const HelcimTerminalSetup = ({ businessId, onTerminalRegistered }) => {
  const [deviceCode, setDeviceCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const handleRegisterTerminal = async () => {
    if (!deviceCode.trim()) {
      toast.error('Device code is required');
      return;
    }

    setIsRegistering(true);
    try {
      // Store terminal info in database for this business
      const { data, error } = await supabase
        .from('pos_terminals')
        .insert({
          business_id: businessId,
          terminal_name: nickname || `Helcim Terminal ${deviceCode.substring(0, 8)}`,
          terminal_id: deviceCode,
          device_code: deviceCode,
          terminal_type: 'helcim_gen2',
          is_active: true,
          location_description: 'Manually registered Gen 2 terminal'
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Terminal registered successfully!');
      onTerminalRegistered?.(data);
      
      // Clear form
      setDeviceCode('');
      setNickname('');
    } catch (err) {
      console.error('Error registering terminal:', err);
      toast.error(`Failed to register terminal: ${err.message}`);
    } finally {
      setIsRegistering(false);
    }
  };

  const styles = {
    container: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      maxWidth: '500px',
      margin: '0 auto'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.lg,
      color: TavariStyles.colors.gray800
    },
    description: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xl,
      lineHeight: 1.6
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.lg
    },
    label: {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      marginBottom: TavariStyles.spacing.xs,
      color: TavariStyles.colors.gray700
    },
    input: {
      ...TavariStyles.components.form.input,
      width: '100%'
    },
    button: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      width: '100%'
    },
    infoBox: {
      backgroundColor: TavariStyles.colors.blue50,
      border: `1px solid ${TavariStyles.colors.blue200}`,
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.blue800
    }
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Register Helcim Gen 2 Terminal</h2>
      
      <div style={styles.infoBox}>
        <strong>Note:</strong> If automatic terminal discovery isn't working, you can manually register your terminal using the device code and nickname shown on the terminal screen.
      </div>

      <p style={styles.description}>
        Enter the device code and nickname displayed on your Gen 2 terminal to register it with your POS system.
      </p>

      <div style={styles.formGroup}>
        <label style={styles.label}>Device Code *</label>
        <input
          type="text"
          value={deviceCode}
          onChange={(e) => setDeviceCode(e.target.value)}
          placeholder="Enter device code from terminal"
          style={styles.input}
          disabled={isRegistering}
        />
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Nickname (Optional)</label>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Enter terminal nickname"
          style={styles.input}
          disabled={isRegistering}
        />
      </div>

      <button
        onClick={handleRegisterTerminal}
        disabled={isRegistering || !deviceCode.trim()}
        style={styles.button}
      >
        {isRegistering ? 'Registering...' : 'Register Terminal'}
      </button>
    </div>
  );
};

export default HelcimTerminalSetup;



