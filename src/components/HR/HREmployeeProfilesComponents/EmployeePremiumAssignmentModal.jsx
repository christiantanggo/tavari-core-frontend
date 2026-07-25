// components/HR/HREmployeeProfilesComponents/EmployeePremiumAssignmentModal.jsx
import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, DollarSign, AlertTriangle, Check } from 'lucide-react';
import { supabase } from '../../../supabaseClient';

// Import all required consistency files
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';
import PositionLabel from '../PositionLabel';

async function resolveOperatorPublicUserId(authUser) {
  const email = (authUser?.email || '').trim().toLowerCase();
  if (email) {
    const { data } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    if (data?.id) return data.id;
  }
  if (authUser?.id) {
    const { data } = await supabase.from('users').select('id').eq('id', authUser.id).maybeSingle();
    if (data?.id) return data.id;
  }
  return authUser?.id || null;
}

const EmployeePremiumAssignmentModal = ({
  isOpen,
  onClose,
  employee,
  availablePremiums = [],
  onPremiumsUpdated
}) => {
  // Security context for sensitive premium data
  const {
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'EmployeePremiumAssignmentModal',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication
  const {
    selectedBusinessId,
    authUser
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'EmployeePremiumAssignmentModal'
  });

  // Tax calculations for formatting
  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId);

  // Component state
  const [currentPremiums, setCurrentPremiums] = useState([]);
  const [selectedPremiumId, setSelectedPremiumId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actingPremiumId, setActingPremiumId] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Load current premiums when modal opens
  useEffect(() => {
    if (isOpen && employee?.id) {
      loadCurrentPremiums();
    }
  }, [isOpen, employee?.id]);

  // Clear messages after a delay
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  const loadCurrentPremiums = async () => {
    try {
      setLoading(true);
      setError(null);

      await logSecurityEvent('premium_assignment_view', {
        employee_id: employee.id,
        employee_name: employee.full_name
      }, 'low');

      const { data, error: premiumError } = await supabase
        .from('hrpayroll_employee_premiums')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .eq('user_id', employee.id)
        .or('is_active.eq.true,approval_status.eq.pending')
        .order('created_at', { ascending: false });

      if (premiumError) throw premiumError;

      setCurrentPremiums(data || []);
    } catch (error) {
      console.error('Error loading current premiums:', error);
      setError('Failed to load current premiums: ' + error.message);
      await logSecurityEvent('premium_assignment_load_failed', {
        employee_id: employee.id,
        error_message: error.message
      }, 'medium');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPremium = async () => {
    if (!selectedPremiumId) {
      setError('Please select a premium to assign');
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('assign_premium');
    if (!rateLimitCheck.allowed) {
      setError('Rate limit exceeded. Please wait before assigning another premium.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      // Find the selected premium details
      const selectedPremium = availablePremiums.find(p => p.id === selectedPremiumId);
      if (!selectedPremium) {
        throw new Error('Selected premium not found');
      }

      // Check if employee already has this premium
      const existingPremium = currentPremiums.find(cp => cp.premium_name === selectedPremium.name);
      if (existingPremium) {
        setError(`Employee already has the ${selectedPremium.name} premium assigned`);
        return;
      }

      await logSecurityEvent('premium_assignment_attempt', {
        employee_id: employee.id,
        employee_name: employee.full_name,
        premium_id: selectedPremiumId,
        premium_name: selectedPremium.name
      }, 'medium');

      // Insert the new premium assignment
      const { data, error: insertError } = await supabase
        .from('hrpayroll_employee_premiums')
        .insert({
          business_id: selectedBusinessId,
          user_id: employee.id,
          premium_name: selectedPremium.name,
          premium_rate: selectedPremium.rate,
          applies_to_all_hours: selectedPremium.applies_to === 'all_hours'
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Update local state
      setCurrentPremiums(prev => [...prev, data]);
      setSelectedPremiumId('');
      setSuccess(`${selectedPremium.name} premium assigned successfully`);

      // Record action for audit
      await recordAction('assign_employee_premium', employee.id, true);

      // Notify parent component
      if (onPremiumsUpdated) {
        onPremiumsUpdated();
      }

    } catch (error) {
      console.error('Error assigning premium:', error);
      setError('Failed to assign premium: ' + error.message);
      await logSecurityEvent('premium_assignment_failed', {
        employee_id: employee.id,
        premium_id: selectedPremiumId,
        error_message: error.message
      }, 'high');
    } finally {
      setSaving(false);
    }
  };

  const handleViewLinkedCertificate = async (premiumAssignment) => {
    const certId = premiumAssignment?.employee_certificate_id;
    if (!certId) {
      setError('No certificate file is linked to this premium.');
      return;
    }

    try {
      setActingPremiumId(premiumAssignment.id);
      const { data: cert, error: certError } = await supabase
        .from('employee_certificates')
        .select('id, certificate_file_url')
        .eq('id', certId)
        .eq('business_id', selectedBusinessId)
        .maybeSingle();

      if (certError) throw certError;
      if (!cert?.certificate_file_url) {
        setError('No uploaded file found for this certificate.');
        return;
      }

      const { data, error: signedError } = await supabase.storage
        .from('employee-certificates')
        .createSignedUrl(cert.certificate_file_url, 3600);

      if (signedError) throw signedError;
      window.open(data.signedUrl, '_blank');
    } catch (err) {
      console.error('Error viewing linked certificate:', err);
      setError('Failed to open certificate: ' + (err.message || 'Unknown error'));
    } finally {
      setActingPremiumId(null);
    }
  };

  const handleDecidePendingPremium = async (premiumAssignment, decision) => {
    if (!premiumAssignment?.id || premiumAssignment.approval_status !== 'pending') return;

    const label = decision === 'approve' ? 'approve' : 'reject';
    if (decision === 'reject' && !confirm(`Reject ${premiumAssignment.premium_name} for ${employee.full_name}?`)) {
      return;
    }

    const rateLimitCheck = await checkRateLimit(`${label}_premium`);
    if (!rateLimitCheck.allowed) {
      setError('Rate limit exceeded. Please wait before trying again.');
      return;
    }

    try {
      setActingPremiumId(premiumAssignment.id);
      setError(null);

      const operatorId = await resolveOperatorPublicUserId(authUser);
      const now = new Date().toISOString();
      const updatePayload = decision === 'approve'
        ? {
            approval_status: 'approved',
            is_active: true,
            approved_by: operatorId,
            approved_at: now,
            rejected_by: null,
            rejected_at: null,
            rejection_reason: null,
            updated_at: now,
          }
        : {
            approval_status: 'rejected',
            is_active: false,
            rejected_by: operatorId,
            rejected_at: now,
            updated_at: now,
          };

      const { error: updateError } = await supabase
        .from('hrpayroll_employee_premiums')
        .update(updatePayload)
        .eq('id', premiumAssignment.id)
        .eq('business_id', selectedBusinessId)
        .eq('approval_status', 'pending');

      if (updateError) throw updateError;

      // Invalidate any outstanding email action tokens for this assignment (best-effort; table may be service-role only)
      try {
        await supabase
          .from('shift_premium_approval_action_tokens')
          .update({ used_at: now })
          .eq('premium_assignment_id', premiumAssignment.id)
          .is('used_at', null);
      } catch (_) {
        /* ignore */
      }

      if (decision === 'approve') {
        setCurrentPremiums((prev) =>
          prev.map((p) =>
            p.id === premiumAssignment.id
              ? { ...p, ...updatePayload }
              : p
          )
        );
        setSuccess(`${premiumAssignment.premium_name} approved and activated`);
      } else {
        setCurrentPremiums((prev) => prev.filter((p) => p.id !== premiumAssignment.id));
        setSuccess(`${premiumAssignment.premium_name} rejected`);
      }

      await recordAction(`${label}_employee_premium`, employee.id, true);
      await logSecurityEvent(`premium_${label}`, {
        employee_id: employee.id,
        premium_id: premiumAssignment.id,
        premium_name: premiumAssignment.premium_name,
      }, 'medium');

      if (onPremiumsUpdated) onPremiumsUpdated();
    } catch (err) {
      console.error(`Error ${label}ing premium:`, err);
      setError(`Failed to ${label} premium: ` + (err.message || 'Unknown error'));
    } finally {
      setActingPremiumId(null);
    }
  };

  const handleRemovePremium = async (premiumAssignment) => {
    if (!confirm(`Remove ${premiumAssignment.premium_name} premium from ${employee.full_name}?`)) {
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('remove_premium');
    if (!rateLimitCheck.allowed) {
      setError('Rate limit exceeded. Please wait before removing another premium.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      await logSecurityEvent('premium_removal_attempt', {
        employee_id: employee.id,
        employee_name: employee.full_name,
        premium_id: premiumAssignment.id,
        premium_name: premiumAssignment.premium_name
      }, 'medium');

      // Soft delete by setting is_active to false
      const { error: updateError } = await supabase
        .from('hrpayroll_employee_premiums')
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', premiumAssignment.id);

      if (updateError) throw updateError;

      // Update local state
      setCurrentPremiums(prev => prev.filter(p => p.id !== premiumAssignment.id));
      setSuccess(`${premiumAssignment.premium_name} premium removed successfully`);

      // Record action for audit
      await recordAction('remove_employee_premium', employee.id, true);

      // Notify parent component
      if (onPremiumsUpdated) {
        onPremiumsUpdated();
      }

    } catch (error) {
      console.error('Error removing premium:', error);
      setError('Failed to remove premium: ' + error.message);
      await logSecurityEvent('premium_removal_failed', {
        employee_id: employee.id,
        premium_id: premiumAssignment.id,
        error_message: error.message
      }, 'high');
    } finally {
      setSaving(false);
    }
  };

  // Get available premiums that aren't already assigned
  const getAvailablePremiums = () => {
    const assignedPremiumNames = currentPremiums.map(cp => cp.premium_name);
    return availablePremiums.filter(p => !assignedPremiumNames.includes(p.name));
  };

  const styles = {
    overlay: {
      ...TavariStyles.components.modal?.overlay,
      display: isOpen ? 'flex' : 'none'
    },
    modal: {
      ...TavariStyles.components.modal?.content,
      width: '600px',
      maxHeight: '80vh'
    },
    header: {
      ...TavariStyles.components.modal?.header,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: TavariStyles.colors.gray500,
      padding: TavariStyles.spacing.xs
    },
    content: {
      ...TavariStyles.components.modal?.body,
      overflowY: 'auto'
    },
    section: {
      marginBottom: TavariStyles.spacing.xl
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.lg,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    addSection: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      alignItems: 'flex-end',
      marginBottom: TavariStyles.spacing.lg
    },
    selectGroup: {
      flex: 1
    },
    label: {
      ...TavariStyles.components.form?.label,
      marginBottom: TavariStyles.spacing.sm
    },
    select: {
      ...TavariStyles.components.form?.select,
      width: '100%'
    },
    addButton: {
      ...TavariStyles.components.button?.base,
      ...TavariStyles.components.button?.variants?.primary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      whiteSpace: 'nowrap'
    },
    premiumsList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md
    },
    premiumItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap'
    },
    premiumInfo: {
      flex: 1,
      minWidth: '180px'
    },
    premiumName: {
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    premiumDetails: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    premiumRate: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.success
    },
    actionRow: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      flexWrap: 'wrap'
    },
    approveButton: {
      ...TavariStyles.components.button?.base,
      backgroundColor: TavariStyles.colors.successBg || '#dcfce7',
      color: TavariStyles.colors.success || '#15803d',
      border: `1px solid ${TavariStyles.colors.success || '#15803d'}50`,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      cursor: 'pointer'
    },
    rejectButton: {
      ...TavariStyles.components.button?.base,
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.danger,
      border: `1px solid ${TavariStyles.colors.danger}50`,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      cursor: 'pointer'
    },
    removeButton: {
      ...TavariStyles.components.button?.base,
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.danger,
      border: `1px solid ${TavariStyles.colors.danger}50`,
      padding: TavariStyles.spacing.sm,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray500
    },
    emptyIcon: {
      color: TavariStyles.colors.gray400,
      marginBottom: TavariStyles.spacing.lg
    },
    emptyText: {
      fontSize: TavariStyles.typography.fontSize.lg
    },
    message: {
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.lg,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    errorMessage: {
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.danger,
      border: `1px solid ${TavariStyles.colors.danger}30`
    },
    successMessage: {
      backgroundColor: TavariStyles.colors.successBg,
      color: TavariStyles.colors.success,
      border: `1px solid ${TavariStyles.colors.success}30`
    },
    loading: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray600
    }
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>
            <DollarSign size={24} />
            Manage Premiums — {employee?.full_name}
          </h3>
          <button onClick={onClose} style={styles.closeButton} title="Close">
            <X size={24} />
          </button>
        </div>

        <div style={styles.content}>
          {error && (
            <div style={{ ...styles.message, ...styles.errorMessage }}>
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
          {success && (
            <div style={{ ...styles.message, ...styles.successMessage }}>
              <Check size={16} />
              {success}
            </div>
          )}

          {/* Add Premium */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>Assign New Premium</h4>
            <div style={styles.addSection}>
              <div style={styles.selectGroup}>
                <label style={styles.label}>Select Premium</label>
                <select
                  value={selectedPremiumId}
                  onChange={(e) => setSelectedPremiumId(e.target.value)}
                  style={styles.select}
                  disabled={saving || getAvailablePremiums().length === 0}
                >
                  <option value="">Choose a premium...</option>
                  {getAvailablePremiums().map((premium) => (
                    <option key={premium.id} value={premium.id}>
                      {premium.name} (+${formatTaxAmount(premium.rate)})
                      {premium.applies_to === 'all_hours' ? ' — all hours' : ' — specific hours'}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleAddPremium}
                disabled={!selectedPremiumId || saving}
                style={{
                  ...styles.addButton,
                  opacity: (!selectedPremiumId || saving) ? 0.6 : 1,
                  cursor: (!selectedPremiumId || saving) ? 'not-allowed' : 'pointer'
                }}
              >
                <Plus size={16} />
                {saving ? 'Adding...' : 'Add Premium'}
              </button>
            </div>

            {getAvailablePremiums().length === 0 && (
              <div style={styles.emptyState}>
                <div style={styles.emptyText}>
                  All available premiums have been assigned to this employee.
                </div>
              </div>
            )}
          </div>

          {/* Current Premiums */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>
              <DollarSign size={20} />
              Current Premium Assignments ({currentPremiums.length})
            </h4>

            {loading ? (
              <div style={styles.loading}>Loading current premiums...</div>
            ) : currentPremiums.length === 0 ? (
              <div style={styles.emptyState}>
                <DollarSign size={48} style={styles.emptyIcon} />
                <div style={styles.emptyText}>
                  No premiums currently assigned to this employee.
                </div>
              </div>
            ) : (
              <div style={styles.premiumsList}>
                {currentPremiums.map((premium) => {
                  const isPending = premium.approval_status === 'pending';
                  const isActing = actingPremiumId === premium.id;
                  return (
                  <div key={premium.id} style={styles.premiumItem}>
                    <div style={styles.premiumInfo}>
                      <div style={styles.premiumName}>
                        {premium.premium_name}
                        {isPending && (
                          <span style={{
                            marginLeft: '8px',
                            fontSize: '9px',
                            fontWeight: 700,
                            color: '#b45309',
                            background: '#fef3c7',
                            padding: '2px 8px',
                            borderRadius: '999px',
                          }}>
                            Pending approval
                          </span>
                        )}
                      </div>
                      <div style={styles.premiumDetails}>
                        {premium.applies_to_all_hours ? 'Applies to all hours' : 'Applies to specific hours'}
                        {' • '}
                        {isPending ? 'Awaiting manager approval' : `Assigned ${new Date(premium.created_at).toLocaleDateString()}`}
                      </div>
                    </div>
                    
                    <div style={styles.premiumRate}>
                      +${formatTaxAmount(premium.premium_rate)}
                    </div>
                    
                    <div style={styles.actionRow}>
                      {isPending ? (
                        <>
                          {premium.employee_certificate_id && (
                            <button
                              type="button"
                              onClick={() => handleViewLinkedCertificate(premium)}
                              disabled={!!actingPremiumId || saving}
                              style={{
                                ...styles.approveButton,
                                backgroundColor: '#e0f2fe',
                                color: '#0369a1',
                                border: '1px solid #7dd3fc',
                                opacity: (actingPremiumId || saving) ? 0.6 : 1,
                                cursor: (actingPremiumId || saving) ? 'not-allowed' : 'pointer'
                              }}
                              title="View uploaded certificate"
                            >
                              View certificate
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDecidePendingPremium(premium, 'approve')}
                            disabled={!!actingPremiumId || saving}
                            style={{
                              ...styles.approveButton,
                              opacity: (actingPremiumId || saving) ? 0.6 : 1,
                              cursor: (actingPremiumId || saving) ? 'not-allowed' : 'pointer'
                            }}
                            title="Approve premium"
                          >
                            <Check size={16} />
                            {isActing ? 'Saving…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDecidePendingPremium(premium, 'reject')}
                            disabled={!!actingPremiumId || saving}
                            style={{
                              ...styles.rejectButton,
                              opacity: (actingPremiumId || saving) ? 0.6 : 1,
                              cursor: (actingPremiumId || saving) ? 'not-allowed' : 'pointer'
                            }}
                            title="Reject premium"
                          >
                            <X size={16} />
                            Reject
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleRemovePremium(premium)}
                          disabled={saving || !!actingPremiumId}
                          style={{
                            ...styles.removeButton,
                            opacity: (saving || actingPremiumId) ? 0.6 : 1,
                            cursor: (saving || actingPremiumId) ? 'not-allowed' : 'pointer'
                          }}
                          title="Remove premium"
                        >
                          <Trash2 size={16} />
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );})}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeePremiumAssignmentModal;
