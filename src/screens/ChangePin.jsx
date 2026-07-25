// src/screens/ChangePin.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { hashValue, verifyHash } from '../helpers/crypto';
import { TavariStyles } from '../utils/TavariStyles';
import POSAuthWrapper from '../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../hooks/usePOSAuth';
import { usePermissions } from '../hooks/usePermissions';
import { SecurityWrapper, useSecurityContext } from '../Security';
import toast from 'react-hot-toast';
import { getPublicUserId } from '../utils/getPublicUserId';

const ChangePin = () => {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const navigate = useNavigate();

  // Security context for PIN changes
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'ChangePin',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  // Authentication
  const {
    authUser,
    userRole,
    authLoading,
    authError
  } = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner', 'admin'],
    requireBusiness: false,
    componentName: 'ChangePin'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks - all users can change their own PIN
  const canChangeOwnPin = hasAnyPermission([
    'profile.pin.change',
    'pos.pin.change'
  ]) || true; // Default allow for own PIN

  useEffect(() => {
    if (authUser && !authLoading) {
      enforceAccess();
    }
  }, [authUser, authLoading]);

  const enforceAccess = async () => {
    if (!authUser?.id) return;

    try {
      await recordAction('pin_change_page_access', authUser.id, true);

      const publicUserId = (await getPublicUserId(authUser.email)) || authUser.id;

      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', publicUserId)
        .single();

      if (error) {
        await logSecurityEvent('pin_change_access_error', {
          error: error.message,
          user_id: authUser.id
        }, 'medium');
        toast.error('Failed to load profile');
        return;
      }

      setProfile(user);

      // Check account status
      const now = new Date();
      const start = user.start_date ? new Date(user.start_date) : null;
      const end = user.end_date ? new Date(user.end_date) : null;

      const isExpired = end && now > end;
      const isPremature = start && now < start;
      const isInactive = user.status !== 'active';

      if (isInactive || isExpired || isPremature) {
        await logSecurityEvent('pin_change_blocked', {
          user_id: authUser.id,
          reason: isInactive ? 'inactive' : isExpired ? 'expired' : 'premature',
          account_status: user.status
        }, 'high');

        toast.error('Your account is inactive or outside the allowed access window.');
        navigate('/locked');
      }
    } catch (err) {
      await logSecurityEvent('pin_change_access_exception', {
        error: err.message,
        user_id: authUser?.id
      }, 'high');
      toast.error('Access verification failed');
    }
  };

  const handleChangePin = async () => {
    if (!canChangeOwnPin) {
      toast.error('You do not have permission to change your PIN');
      return;
    }

    // Rate limit check - 5 attempts per 15 minutes
    const rateLimitOk = await checkRateLimit('pin_change', 5, 900000);
    if (!rateLimitOk) {
      await logSecurityEvent('pin_change_rate_limit', {
        user_id: authUser?.id,
        attempts_blocked: true
      }, 'high');
      toast.error('Too many PIN change attempts. Please wait 15 minutes.');
      return;
    }

    // Validate inputs
    const currentPinValidation = validateInput(currentPin, 'pin', { 
      required: true,
      minLength: 4,
      maxLength: 4 
    });

    if (!currentPinValidation.isValid) {
      toast.error(currentPinValidation.error);
      return;
    }

    const newPinValidation = validateInput(newPin, 'pin', { 
      required: true,
      minLength: 4,
      maxLength: 4 
    });

    if (!newPinValidation.isValid) {
      toast.error(newPinValidation.error);
      return;
    }

    if (!/^\d{4}$/.test(newPin)) {
      toast.error('PIN must be exactly 4 digits.');
      return;
    }

    if (newPin !== confirmPin) {
      toast.error('New PIN and confirmation do not match.');
      return;
    }

    if (currentPin === newPin) {
      toast.error('New PIN must be different from current PIN.');
      return;
    }

    setLoading(true);

    try {
      await recordAction('pin_change_attempt', authUser.id, true);

      const publicUserId = (await getPublicUserId(authUser.email)) || authUser.id;

      const { data, error } = await supabase
        .from('users')
        .select('pin')
        .eq('id', publicUserId)
        .single();

      if (error || !data) {
        await logSecurityEvent('pin_change_fetch_error', {
          error: error?.message || 'No data',
          user_id: authUser.id
        }, 'medium');
        toast.error('Failed to fetch current PIN.');
        return;
      }

      // Verify current PIN
      const pinMatches = await verifyHash(currentPin, data.pin);
      if (!pinMatches) {
        await logSecurityEvent('pin_change_incorrect_current', {
          user_id: authUser.id,
          verification_failed: true
        }, 'medium');
        toast.error('Current PIN is incorrect.');
        return;
      }

      // Hash new PIN
      const hashedPin = await hashValue(newPin);

      // Update PIN
      const { error: updateError } = await supabase
        .from('users')
        .update({ pin: hashedPin })
        .eq('id', publicUserId);

      if (updateError) {
        await logSecurityEvent('pin_change_update_error', {
          error: updateError.message,
          user_id: authUser.id
        }, 'high');
        toast.error('Failed to update PIN.');
        return;
      }

      // Log successful PIN change
      await logSecurityEvent('pin_change_success', {
        user_id: authUser.id,
        screen: 'ChangePin',
        method: 'manual',
        previous_pin_verified: true
      }, 'medium');

      await supabase.from('audit_logs').insert({
        user_id: authUser.id,
        event_type: 'pin_change',
        details: {
          screen: 'ChangePin',
          method: 'manual',
          previousPinChecked: true,
          pinUpdated: true,
          timestamp: new Date().toISOString()
        }
      });

      toast.success('PIN updated successfully.');
      
      // Clear form
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');

      setTimeout(() => navigate('/dashboard'), 1500);

    } catch (err) {
      await logSecurityEvent('pin_change_exception', {
        error: err.message,
        user_id: authUser?.id
      }, 'high');
      toast.error('An error occurred while updating PIN.');
    } finally {
      setLoading(false);
    }
  };

  const styles = {
    container: {
      padding: TavariStyles.spacing['2xl'],
      maxWidth: '500px',
      margin: '0 auto',
      marginTop: TavariStyles.spacing['3xl']
    },

    card: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['2xl']
    },

    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xl,
      textAlign: 'center'
    },

    formGroup: {
      marginBottom: TavariStyles.spacing.lg
    },

    label: {
      ...TavariStyles.components.form.label,
      display: 'block',
      marginBottom: TavariStyles.spacing.sm
    },

    input: {
      ...TavariStyles.components.form.input,
      width: '100%'
    },

    button: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      width: '100%',
      marginTop: TavariStyles.spacing.lg
    },

    buttonDisabled: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      width: '100%',
      marginTop: TavariStyles.spacing.lg,
      opacity: 0.5,
      cursor: 'not-allowed'
    },

    helperText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.sm
    },

    securityNote: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.info,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.lg
    }
  };

  if (authLoading || permissionsLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', color: TavariStyles.colors.gray600 }}>
            Loading...
          </div>
        </div>
      </div>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['employee', 'manager', 'owner', 'admin']}
      requireBusiness={false}
      componentName="ChangePin"
    >
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Change PIN</h2>

          <div style={styles.securityNote}>
            🔒 Your PIN is used to unlock the POS register. Keep it secure and don't share it with others.
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Current PIN</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="Enter current PIN"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
              style={styles.input}
              disabled={loading}
            />
            <div style={styles.helperText}>Enter your current 4-digit PIN</div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>New PIN</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="Enter new PIN (4 digits)"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              style={styles.input}
              disabled={loading}
            />
            <div style={styles.helperText}>Must be exactly 4 digits</div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Confirm New PIN</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="Confirm new PIN"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              style={styles.input}
              disabled={loading}
            />
            <div style={styles.helperText}>Re-enter your new PIN to confirm</div>
          </div>

          <button 
            onClick={handleChangePin} 
            style={loading ? styles.buttonDisabled : styles.button}
            disabled={loading}
          >
            {loading ? 'Updating...' : 'Update PIN'}
          </button>
        </div>
      </div>
    </POSAuthWrapper>
  );
};

export default ChangePin;