// components/HR/HRSettingsComponents/ShiftPremiumsTab.jsx - Updated Premium Application Logic with Modal
import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../Auth/POSAuthWrapper';
import TavariCheckbox from '../../UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

function htmlTimeFromDb(value) {
  if (value == null || value === '') return '';
  const s = String(value);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function toPgTime(htmlTime) {
  if (htmlTime == null || htmlTime === '') return null;
  const s = String(htmlTime).trim();
  if (s.length === 5) return `${s}:00`;
  return s;
}

const DEFAULT_NEW_PREMIUM = {
  name: '',
  type: 'hourly_rate',
  rate: '',
  rate_type: 'fixed_amount',
  applies_to: 'specific_hours',
  requires_certificate: false,
  required_certificate_id: null,
  description: '',
  is_active: true,
  time_application_mode: 'none',
  daily_window_start: '',
  daily_window_end: '',
  public_hours_buffer_before_minutes: 60,
  public_hours_buffer_after_minutes: 60,
  stacking_behavior: 'additive',
  exclusive_cluster_key: '',
};

const ShiftPremiumsTab = ({
  settings,
  onSettingsChange,
  selectedBusinessId,
  businessData,
  userRole,
  authUser,
  saving
}) => {
  const [premiums, setPremiums] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [newPremium, setNewPremium] = useState(() => ({ ...DEFAULT_NEW_PREMIUM }));
  const [editingPremium, setEditingPremium] = useState(null);
  const [showNewPremiumForm, setShowNewPremiumForm] = useState(false);
  const [loading, setLoading] = useState(true);

  // Security context for sensitive premium settings
  const {
    validateInput,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'ShiftPremiumsTab',
    sensitiveComponent: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  useEffect(() => {
    if (selectedBusinessId) {
      loadPremiums();
      loadCertificates();
    }
  }, [selectedBusinessId]);

  const loadPremiums = async () => {
    try {
      const { data, error } = await supabase
        .from('hr_shift_premiums')
        .select(`
          *,
          hr_certificates(id, name, description)
        `)
        .eq('business_id', selectedBusinessId)
        .order('name');

      if (error) throw error;
      setPremiums(data || []);
    } catch (error) {
      console.error('Error loading shift premiums:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCertificates = async () => {
    try {
      const { data, error } = await supabase
        .from('hr_certificates')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setCertificates(data || []);
    } catch (error) {
      console.error('Error loading certificates:', error);
    }
  };

  const handleSavePremium = async () => {
    try {
      // Validation
      if (!newPremium.name.trim()) {
        alert('Premium name is required');
        return;
      }

      if (!newPremium.rate || parseFloat(newPremium.rate) <= 0) {
        alert('Valid rate is required');
        return;
      }

      if (newPremium.time_application_mode === 'daily_window') {
        if (!newPremium.daily_window_start?.trim() || !newPremium.daily_window_end?.trim()) {
          alert('Daily time window requires both a start time and an end time.');
          return;
        }
      }

      if (newPremium.stacking_behavior === 'exclusive_cluster') {
        const key = String(newPremium.exclusive_cluster_key || '').trim();
        if (!key) {
          alert('Exclusive cluster premiums need a cluster name (e.g. time_based_premiums).');
          return;
        }
      }

      await logSecurityEvent('premium_creation', {
        premium_name: newPremium.name,
        business_id: selectedBusinessId
      }, 'medium');

      const clusterKey =
        newPremium.stacking_behavior === 'exclusive_cluster'
          ? String(newPremium.exclusive_cluster_key || '').trim()
          : null;

      const premiumData = {
        name: newPremium.name.trim(),
        description: newPremium.description || null,
        type: newPremium.type,
        rate: parseFloat(newPremium.rate),
        rate_type: newPremium.rate_type,
        applies_to: newPremium.applies_to,
        requires_certificate: newPremium.requires_certificate,
        required_certificate_id: newPremium.required_certificate_id || null,
        is_active: newPremium.is_active,
        business_id: selectedBusinessId,
        time_application_mode: newPremium.time_application_mode || 'none',
        daily_window_start:
          newPremium.time_application_mode === 'daily_window'
            ? toPgTime(newPremium.daily_window_start)
            : null,
        daily_window_end:
          newPremium.time_application_mode === 'daily_window'
            ? toPgTime(newPremium.daily_window_end)
            : null,
        public_hours_buffer_before_minutes:
          newPremium.time_application_mode === 'public_hours_inside_buffer' ||
          newPremium.time_application_mode === 'public_hours_outside_buffer'
            ? Math.min(
                24 * 60,
                Math.max(0, parseInt(newPremium.public_hours_buffer_before_minutes, 10) || 0)
              )
            : 60,
        public_hours_buffer_after_minutes:
          newPremium.time_application_mode === 'public_hours_inside_buffer' ||
          newPremium.time_application_mode === 'public_hours_outside_buffer'
            ? Math.min(
                24 * 60,
                Math.max(0, parseInt(newPremium.public_hours_buffer_after_minutes, 10) || 0)
              )
            : 60,
        stacking_behavior: newPremium.stacking_behavior || 'additive',
        exclusive_cluster_key: clusterKey,
      };

      let result;
      if (editingPremium) {
        result = await supabase
          .from('hr_shift_premiums')
          .update(premiumData)
          .eq('id', editingPremium.id)
          .eq('business_id', selectedBusinessId);
      } else {
        result = await supabase.from('hr_shift_premiums').insert([
          { ...premiumData, created_by: authUser.id },
        ]);
      }

      if (result.error) {
        console.error('Database error:', result.error);
        throw result.error;
      }

      await recordAction('premium_saved', {
        premium_name: newPremium.name,
        action: editingPremium ? 'updated' : 'created',
        business_id: selectedBusinessId
      });

      // Reset form and close modal
      handleCloseModal();
      
      // Reload premiums
      loadPremiums();
    } catch (error) {
      console.error('Error saving premium:', error);
      alert(`Failed to save premium: ${error.message || 'Please try again.'}`);
    }
  };

  const handleEditPremium = (premium) => {
    setNewPremium({
      name: premium.name,
      description: premium.description || '',
      type: premium.type,
      rate: premium.rate.toString(),
      rate_type: premium.rate_type,
      applies_to: premium.applies_to || 'specific_hours',
      requires_certificate: premium.requires_certificate,
      required_certificate_id: premium.required_certificate_id,
      is_active: premium.is_active,
      time_application_mode: premium.time_application_mode || 'none',
      daily_window_start: htmlTimeFromDb(premium.daily_window_start),
      daily_window_end: htmlTimeFromDb(premium.daily_window_end),
      public_hours_buffer_before_minutes:
        premium.public_hours_buffer_before_minutes ?? 60,
      public_hours_buffer_after_minutes:
        premium.public_hours_buffer_after_minutes ?? 60,
      stacking_behavior: premium.stacking_behavior || 'additive',
      exclusive_cluster_key: premium.exclusive_cluster_key || '',
    });
    setEditingPremium(premium);
    setShowNewPremiumForm(true);
  };

  const handleCloseModal = () => {
    setShowNewPremiumForm(false);
    setEditingPremium(null);
    setNewPremium({ ...DEFAULT_NEW_PREMIUM });
  };

  const handleDeletePremium = async (premiumId) => {
    if (!confirm('Are you sure you want to delete this premium? This cannot be undone.')) {
      return;
    }

    try {
      await logSecurityEvent('premium_deletion', {
        premium_id: premiumId,
        business_id: selectedBusinessId
      }, 'high');

      const { error } = await supabase
        .from('hr_shift_premiums')
        .delete()
        .eq('id', premiumId)
        .eq('business_id', selectedBusinessId);

      if (error) throw error;

      await recordAction('premium_deleted', {
        premium_id: premiumId,
        business_id: selectedBusinessId
      });

      loadPremiums();
    } catch (error) {
      console.error('Error deleting premium:', error);
      alert('Failed to delete premium. Please try again.');
    }
  };

  // Helper function to get premium application description
  const getPremiumApplicationDescription = (appliesTo) => {
    switch (appliesTo) {
      case 'all_hours':
        return 'Automatically applies to all hours worked';
      case 'specific_hours':
        return 'Manual entry of premium hours during payroll';
      case 'overtime_hours':
        return 'Automatically applies to overtime hours only';
      case 'regular_hours':
        return 'Automatically applies to regular hours only';
      case 'weekend_hours':
        return 'Automatically applies to weekend hours only';
      default:
        return 'Manual entry of premium hours during payroll';
    }
  };

  // Helper function to get premium application display name
  const getPremiumApplicationDisplay = (appliesTo) => {
    switch (appliesTo) {
      case 'all_hours':
        return 'Apply to All Hours';
      case 'specific_hours':
        return 'Apply to Selected Hours';
      case 'overtime_hours':
        return 'Overtime Hours Only';
      case 'regular_hours':
        return 'Regular Hours Only';
      case 'weekend_hours':
        return 'Weekend Hours Only';
      default:
        return 'Selected Hours';
    }
  };

  const summarizeTimeRules = (premium) => {
    const mode = premium.time_application_mode || 'none';
    if (mode === 'daily_window') {
      const a = htmlTimeFromDb(premium.daily_window_start) || '?';
      const b = htmlTimeFromDb(premium.daily_window_end) || '?';
      let crossesMidnight = false;
      if (a !== '?' && b !== '?' && /^(\d{1,2}):(\d{2})$/.test(a) && /^(\d{1,2}):(\d{2})$/.test(b)) {
        const pa = a.split(':').map(Number);
        const pb = b.split(':').map(Number);
        const ma = pa[0] * 60 + pa[1];
        const mb = pb[0] * 60 + pb[1];
        crossesMidnight = ma > mb;
      }
      return `Clock time ${a}–${b}${crossesMidnight ? ' (overnight)' : ''}`;
    }
    if (mode === 'public_hours_inside_buffer') {
      const bef = premium.public_hours_buffer_before_minutes ?? 60;
      const aft = premium.public_hours_buffer_after_minutes ?? 60;
      return `Inside operating hours + ${bef}m before / ${aft}m after`;
    }
    if (mode === 'public_hours_outside_buffer') {
      const bef = premium.public_hours_buffer_before_minutes ?? 60;
      const aft = premium.public_hours_buffer_after_minutes ?? 60;
      return `Outside operating hours (buffers ${bef}m / ${aft}m)`;
    }
    return null;
  };

  const summarizeStacking = (premium) => {
    if (premium.stacking_behavior === 'exclusive_cluster' && premium.exclusive_cluster_key) {
      return `Exclusive: “${premium.exclusive_cluster_key}”`;
    }
    return 'Stacks with other premiums';
  };

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xl
    },
    section: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xl,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      margin: `0 0 ${TavariStyles.spacing.lg} 0`
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    inputGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    input: {
      ...TavariStyles.components.form?.input || {
        padding: '12px 16px',
        border: `1px solid ${TavariStyles.colors.gray300}`,
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        fontSize: TavariStyles.typography.fontSize.sm,
        backgroundColor: TavariStyles.colors.white
      },
      width: '90%'
    },
    select: {
      ...TavariStyles.components.form?.select || {
        padding: '12px 16px',
        border: `1px solid ${TavariStyles.colors.gray300}`,
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        fontSize: TavariStyles.typography.fontSize.sm,
        backgroundColor: TavariStyles.colors.white,
        cursor: 'pointer'
      },
      width: '90%'
    },
    textarea: {
      ...TavariStyles.components.form?.input || {},
      minHeight: '80px',
      resize: 'vertical',
      fontFamily: 'inherit',
      width: '90%'
    },
    button: {
      ...TavariStyles.components.button?.base || {
        padding: '12px 20px',
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        border: 'none',
        fontSize: TavariStyles.typography.fontSize.sm,
        fontWeight: TavariStyles.typography.fontWeight.semibold,
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      },
      ...TavariStyles.components.button?.variants?.primary || {
        backgroundColor: TavariStyles.colors.primary,
        color: TavariStyles.colors.white
      }
    },
    secondaryButton: {
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700,
      border: `1px solid ${TavariStyles.colors.gray300}`
    },
    dangerButton: {
      backgroundColor: TavariStyles.colors.danger,
      color: TavariStyles.colors.white
    },
    premiumCard: {
      backgroundColor: TavariStyles.colors.gray50,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.md
    },
    premiumHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: TavariStyles.spacing.md
    },
    premiumName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    premiumRate: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.primary,
      margin: 0
    },
    premiumDetails: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600
    },
    buttonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.md
    },
    certificateWarning: {
      backgroundColor: TavariStyles.colors.warningBg,
      color: TavariStyles.colors.warningText,
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.xs,
      marginTop: TavariStyles.spacing.sm
    },
    infoBox: {
      backgroundColor: TavariStyles.colors.infoBg,
      color: TavariStyles.colors.infoText,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.lg
    },
    helpText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs,
      fontStyle: 'italic'
    },
    applicationTypeCard: {
      border: `2px solid ${TavariStyles.colors.primary}20`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      padding: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.primary + '10'
    },
    loadingText: {
      textAlign: 'center',
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.lg,
      padding: TavariStyles.spacing.xl
    },
    // Modal styles
    modalOverlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999
    },
    modalContent: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      maxWidth: '800px',
      width: '90%',
      maxHeight: '90vh',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
    },
    modalHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    modalTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    closeButton: {
      backgroundColor: 'transparent',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.xl,
      cursor: 'pointer',
      color: TavariStyles.colors.gray500,
      padding: '8px',
      borderRadius: TavariStyles.borderRadius?.sm || '4px'
    },
    modalBody: {
      flex: 1,
      padding: TavariStyles.spacing.xl,
      overflowY: 'auto'
    },
    modalFooter: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      justifyContent: 'flex-end'
    }
  };

  if (loading) {
    return (
      <POSAuthWrapper
        componentName="ShiftPremiumsTab"
        requiredRoles={['owner', 'manager', 'hr_admin']}
        requireBusiness={true}
      >
        <SecurityWrapper
          componentName="ShiftPremiumsTab"
          securityLevel="high"
          enableAuditLogging={true}
          sensitiveComponent={true}
        >
          <div style={styles.loadingText}>
            Loading shift premiums...
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper
      componentName="ShiftPremiumsTab"
      requiredRoles={['owner', 'manager', 'hr_admin']}
      requireBusiness={true}
    >
      <SecurityWrapper
        componentName="ShiftPremiumsTab"
        securityLevel="high"
        enableAuditLogging={true}
        sensitiveComponent={true}
      >
        <div style={styles.container}>
          {/* Information Box */}
          <div style={styles.infoBox}>
            <strong>Shift Premium Application Types</strong><br />
            <strong>Apply to All Hours:</strong> Premium automatically applies to all hours the employee worked (no manual entry needed)<br />
            <strong>Apply to Selected Hours:</strong> Manager enters specific number of hours for this premium during payroll entry<br />
            <strong>Time-based rules</strong> below define when a premium applies by clock time (e.g. after-hours window, or only while open to the public using Settings → operating hours).<br />
            <strong>Stacking:</strong> “Additive” premiums (typical for certifications) stack together. Premiums in the same <em>exclusive cluster</em> do not stack with each other but still stack with additive premiums.
          </div>

          {/* Existing Premiums */}
          <div style={styles.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: TavariStyles.spacing.lg }}>
              <h3 style={styles.sectionTitle}>Current Shift Premiums</h3>
              <button
                onClick={() => setShowNewPremiumForm(true)}
                style={styles.button}
                disabled={saving}
              >
                Add New Premium
              </button>
            </div>

            {premiums.length === 0 ? (
              <div style={{ textAlign: 'center', color: TavariStyles.colors.gray500, padding: TavariStyles.spacing.xl }}>
                No shift premiums configured. Click "Add New Premium" to create your first premium.
              </div>
            ) : (
              premiums.map((premium) => (
                <div key={premium.id} style={styles.premiumCard}>
                  <div style={styles.premiumHeader}>
                    <div>
                      <h4 style={styles.premiumName}>{premium.name}</h4>
                      <p style={styles.premiumRate}>
                        {premium.rate_type === 'percentage' ? `${premium.rate}%` : `$${premium.rate}`}
                        {premium.rate_type === 'percentage' ? ' of base rate' : ' per hour'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: TavariStyles.spacing.sm, flexWrap: 'wrap' }}>
                      {premium.requires_certificate && (
                        <span style={{
                          backgroundColor: TavariStyles.colors.warningBg,
                          color: TavariStyles.colors.warningText,
                          padding: '4px 8px',
                          borderRadius: TavariStyles.borderRadius?.sm || '4px',
                          fontSize: TavariStyles.typography.fontSize.xs,
                          fontWeight: TavariStyles.typography.fontWeight.medium
                        }}>
                          Certificate Required
                        </span>
                      )}
                      {!premium.is_active && (
                        <span style={{
                          backgroundColor: TavariStyles.colors.gray200,
                          color: TavariStyles.colors.gray600,
                          padding: '4px 8px',
                          borderRadius: TavariStyles.borderRadius?.sm || '4px',
                          fontSize: TavariStyles.typography.fontSize.xs
                        }}>
                          Inactive
                        </span>
                      )}
                      <span style={{
                        backgroundColor: premium.applies_to === 'all_hours' ? TavariStyles.colors.successBg : TavariStyles.colors.infoBg,
                        color: premium.applies_to === 'all_hours' ? TavariStyles.colors.success : TavariStyles.colors.info,
                        padding: '4px 8px',
                        borderRadius: TavariStyles.borderRadius?.sm || '4px',
                        fontSize: TavariStyles.typography.fontSize.xs,
                        fontWeight: TavariStyles.typography.fontWeight.medium
                      }}>
                        {getPremiumApplicationDisplay(premium.applies_to)}
                      </span>
                    </div>
                  </div>

                  <div style={styles.premiumDetails}>
                    <div><strong>Application:</strong> {getPremiumApplicationDescription(premium.applies_to)}</div>
                    {summarizeTimeRules(premium) && (
                      <div><strong>Time rule:</strong> {summarizeTimeRules(premium)}</div>
                    )}
                    <div><strong>Stacking:</strong> {summarizeStacking(premium)}</div>
                    {premium.requires_certificate && premium.hr_certificates && (
                      <div><strong>Certificate:</strong> {premium.hr_certificates.name}</div>
                    )}
                    <div><strong>Type:</strong> {premium.type.replace('_', ' ')}</div>
                  </div>

                  {premium.description && (
                    <div style={{ marginTop: TavariStyles.spacing.sm, fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600 }}>
                      {premium.description}
                    </div>
                  )}

                  <div style={styles.buttonGroup}>
                    <button
                      onClick={() => handleEditPremium(premium)}
                      style={{ ...styles.button, ...styles.secondaryButton }}
                      disabled={saving}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeletePremium(premium.id)}
                      style={{ ...styles.button, ...styles.dangerButton }}
                      disabled={saving}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Modal for New/Edit Premium Form */}
          {showNewPremiumForm && (
            <div style={styles.modalOverlay} onClick={(e) => {
              if (e.target === e.currentTarget) handleCloseModal();
            }}>
              <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <h3 style={styles.modalTitle}>
                    {editingPremium ? 'Edit Premium' : 'Add New Premium'}
                  </h3>
                  <button
                    style={styles.closeButton}
                    onClick={handleCloseModal}
                    disabled={saving}
                  >
                    ✕
                  </button>
                </div>

                <div style={styles.modalBody}>
                  <div style={styles.grid}>
                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Premium Name *</label>
                      <input
                        type="text"
                        value={newPremium.name}
                        onChange={(e) => setNewPremium(prev => ({ ...prev, name: e.target.value }))}
                        style={styles.input}
                        placeholder="Night Shift Premium"
                        disabled={saving}
                      />
                    </div>

                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Premium Type</label>
                      <select
                        value={newPremium.type}
                        onChange={(e) => setNewPremium(prev => ({ ...prev, type: e.target.value }))}
                        style={styles.select}
                        disabled={saving}
                      >
                        <option value="hourly_rate">Hourly Rate Premium</option>
                        <option value="shift_differential">Shift Differential</option>
                        <option value="skill_premium">Skill Premium</option>
                        <option value="location_premium">Location Premium</option>
                        <option value="hazard_pay">Hazard Pay</option>
                        <option value="overtime_premium">Overtime Premium</option>
                      </select>
                    </div>

                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Rate Type</label>
                      <select
                        value={newPremium.rate_type}
                        onChange={(e) => setNewPremium(prev => ({ ...prev, rate_type: e.target.value }))}
                        style={styles.select}
                        disabled={saving}
                      >
                        <option value="fixed_amount">Fixed Amount ($)</option>
                        <option value="percentage">Percentage of Base Rate (%)</option>
                      </select>
                    </div>

                    <div style={styles.inputGroup}>
                      <label style={styles.label}>
                        Rate * {newPremium.rate_type === 'percentage' ? '(%)' : '($)'}
                      </label>
                      <input
                        type="number"
                        step={newPremium.rate_type === 'percentage' ? '0.1' : '0.01'}
                        min="0"
                        value={newPremium.rate}
                        onChange={(e) => setNewPremium(prev => ({ ...prev, rate: e.target.value }))}
                        style={styles.input}
                        placeholder={newPremium.rate_type === 'percentage' ? '15' : '2.50'}
                        disabled={saving}
                      />
                    </div>
                  </div>

                  {/* Premium Application Type - Main Setting */}
                  <div style={{ marginTop: TavariStyles.spacing.lg }}>
                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Premium Application Method *</label>
                      <select
                        value={newPremium.applies_to}
                        onChange={(e) => setNewPremium(prev => ({ ...prev, applies_to: e.target.value }))}
                        style={styles.select}
                        disabled={saving}
                      >
                        <option value="specific_hours">Apply to Selected Hours (Manual Entry)</option>
                        <option value="all_hours">Apply to All Hours (Automatic)</option>
                        <option value="overtime_hours">Apply to Overtime Hours Only</option>
                        <option value="regular_hours">Apply to Regular Hours Only</option>
                        <option value="weekend_hours">Apply to Weekend Hours Only</option>
                      </select>
                      
                      {/* Dynamic explanation card */}
                      <div style={styles.applicationTypeCard}>
                        <strong>{getPremiumApplicationDisplay(newPremium.applies_to)}</strong><br />
                        <div style={styles.helpText}>
                          {getPremiumApplicationDescription(newPremium.applies_to)}
                        </div>
                        
                        {newPremium.applies_to === 'specific_hours' && (
                          <div style={{ ...styles.helpText, marginTop: TavariStyles.spacing.xs }}>
                            Example: Employee works 8 hours, manager enters "4 hours" for this premium during payroll entry.
                          </div>
                        )}
                        
                        {newPremium.applies_to === 'all_hours' && (
                          <div style={{ ...styles.helpText, marginTop: TavariStyles.spacing.xs }}>
                            Example: Employee works 8 hours, premium automatically applies to all 8 hours.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Time-of-day rules (payroll / scheduling use businesses.operating_hours for public-hours modes) */}
                  <div style={{ marginTop: TavariStyles.spacing.lg }}>
                    <h4 style={{ ...styles.sectionTitle, fontSize: TavariStyles.typography.fontSize.lg, marginBottom: TavariStyles.spacing.sm }}>
                      Time-based application
                    </h4>
                    <p style={{ ...styles.helpText, marginBottom: TavariStyles.spacing.md }}>
                      Optional. Leave as “No clock-time filter” unless this premium should only apply during certain times.
                      Public-hours modes use <strong>Settings → Operating hours</strong> for this business.
                    </p>
                    <div style={styles.inputGroup}>
                      <label style={styles.label}>When does this premium apply by clock time?</label>
                      <select
                        value={newPremium.time_application_mode}
                        onChange={(e) =>
                          setNewPremium((prev) => ({
                            ...prev,
                            time_application_mode: e.target.value,
                          }))
                        }
                        style={styles.select}
                        disabled={saving}
                      >
                        <option value="none">No clock-time filter</option>
                        <option value="daily_window">Daily start / end time (e.g. after-hours cleaner)</option>
                        <option value="public_hours_inside_buffer">
                          While open to the public — operating hours plus buffer before/after
                        </option>
                        <option value="public_hours_outside_buffer">
                          Outside public-facing hours (inverse of operating hours ± buffer)
                        </option>
                      </select>
                    </div>

                    {newPremium.time_application_mode === 'daily_window' && (
                      <div style={{ ...styles.grid, marginTop: TavariStyles.spacing.md }}>
                        <div style={styles.inputGroup}>
                          <label style={styles.label}>Window start (local time)</label>
                          <input
                            type="time"
                            value={newPremium.daily_window_start}
                            onChange={(e) =>
                              setNewPremium((prev) => ({
                                ...prev,
                                daily_window_start: e.target.value,
                              }))
                            }
                            style={styles.input}
                            disabled={saving}
                          />
                          <span style={styles.helpText}>
                            If start is later than end, the window crosses midnight (e.g. 22:00–06:00).
                          </span>
                        </div>
                        <div style={styles.inputGroup}>
                          <label style={styles.label}>Window end (local time)</label>
                          <input
                            type="time"
                            value={newPremium.daily_window_end}
                            onChange={(e) =>
                              setNewPremium((prev) => ({
                                ...prev,
                                daily_window_end: e.target.value,
                              }))
                            }
                            style={styles.input}
                            disabled={saving}
                          />
                        </div>
                      </div>
                    )}

                    {(newPremium.time_application_mode === 'public_hours_inside_buffer' ||
                      newPremium.time_application_mode === 'public_hours_outside_buffer') && (
                      <div style={{ ...styles.grid, marginTop: TavariStyles.spacing.md }}>
                        <div style={styles.inputGroup}>
                          <label style={styles.label}>Buffer before opening (minutes)</label>
                          <input
                            type="number"
                            min={0}
                            max={1440}
                            value={newPremium.public_hours_buffer_before_minutes}
                            onChange={(e) =>
                              setNewPremium((prev) => ({
                                ...prev,
                                public_hours_buffer_before_minutes: e.target.value,
                              }))
                            }
                            style={styles.input}
                            disabled={saving}
                          />
                          <span style={styles.helpText}>Premium starts this many minutes before the first customer-facing open.</span>
                        </div>
                        <div style={styles.inputGroup}>
                          <label style={styles.label}>Buffer after closing (minutes)</label>
                          <input
                            type="number"
                            min={0}
                            max={1440}
                            value={newPremium.public_hours_buffer_after_minutes}
                            onChange={(e) =>
                              setNewPremium((prev) => ({
                                ...prev,
                                public_hours_buffer_after_minutes: e.target.value,
                              }))
                            }
                            style={styles.input}
                            disabled={saving}
                          />
                          <span style={styles.helpText}>Premium ends this many minutes after the last public close.</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stacking */}
                  <div style={{ marginTop: TavariStyles.spacing.lg }}>
                    <h4 style={{ ...styles.sectionTitle, fontSize: TavariStyles.typography.fontSize.lg, marginBottom: TavariStyles.spacing.sm }}>
                      Stacking with other premiums
                    </h4>
                    <div style={styles.inputGroup}>
                      <label style={styles.label}>Stacking behavior</label>
                      <select
                        value={newPremium.stacking_behavior}
                        onChange={(e) =>
                          setNewPremium((prev) => ({
                            ...prev,
                            stacking_behavior: e.target.value,
                            exclusive_cluster_key:
                              e.target.value === 'exclusive_cluster' ? prev.exclusive_cluster_key : '',
                          }))
                        }
                        style={styles.select}
                        disabled={saving}
                      >
                        <option value="additive">
                          Additive — stacks with other premiums (use for First Aid, Food Safety, etc.)
                        </option>
                        <option value="exclusive_cluster">
                          Exclusive cluster — does not stack with other premiums in the same cluster name
                        </option>
                      </select>
                    </div>
                    {newPremium.stacking_behavior === 'exclusive_cluster' && (
                      <div style={{ ...styles.inputGroup, marginTop: TavariStyles.spacing.md }}>
                        <label style={styles.label}>Cluster name</label>
                        <input
                          type="text"
                          value={newPremium.exclusive_cluster_key}
                          onChange={(e) =>
                            setNewPremium((prev) => ({
                              ...prev,
                              exclusive_cluster_key: e.target.value,
                            }))
                          }
                          style={styles.input}
                          placeholder="e.g. time_based_premiums"
                          disabled={saving}
                        />
                        <span style={styles.helpText}>
                          Put shift-lead and after-hours in the same cluster so only one applies at a time; leave certification premiums as additive so they still stack.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Certificate Requirement */}
                  <div style={{ marginTop: TavariStyles.spacing.lg }}>
                    <TavariCheckbox
                      checked={newPremium.requires_certificate}
                      onChange={(checked) => setNewPremium(prev => ({ 
                        ...prev, 
                        requires_certificate: checked,
                        required_certificate_id: checked ? prev.required_certificate_id : null
                      }))}
                      label="Requires Certificate (only employees with this certificate can receive this premium)"
                      disabled={saving}
                      size="md"
                    />

                    {newPremium.requires_certificate && (
                      <div style={{ marginTop: TavariStyles.spacing.md }}>
                        <label style={styles.label}>Required Certificate</label>
                        <select
                          value={newPremium.required_certificate_id || ''}
                          onChange={(e) => setNewPremium(prev => ({ ...prev, required_certificate_id: e.target.value || null }))}
                          style={styles.select}
                          disabled={saving}
                        >
                          <option value="">Select Certificate...</option>
                          {certificates.map((cert) => (
                            <option key={cert.id} value={cert.id}>
                              {cert.name}
                            </option>
                          ))}
                        </select>
                        
                        {certificates.length === 0 && (
                          <div style={styles.certificateWarning}>
                            No certificates available. You'll need to create certificates in the Employee Management section first.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  <div style={{ marginTop: TavariStyles.spacing.lg }}>
                    <label style={styles.label}>Description (Optional)</label>
                    <textarea
                      value={newPremium.description}
                      onChange={(e) => setNewPremium(prev => ({ ...prev, description: e.target.value }))}
                      style={styles.textarea}
                      placeholder="Additional details about when this premium applies (e.g., 'For working after 11 PM', 'Requires forklift certification')..."
                      disabled={saving}
                    />
                  </div>

                  {/* Active Status */}
                  <div style={{ marginTop: TavariStyles.spacing.lg }}>
                    <TavariCheckbox
                      checked={newPremium.is_active}
                      onChange={(checked) => setNewPremium(prev => ({ ...prev, is_active: checked }))}
                      label="Premium is Active (will appear in payroll entry)"
                      disabled={saving}
                      size="md"
                    />
                  </div>
                </div>

                <div style={styles.modalFooter}>
                  <button
                    onClick={handleCloseModal}
                    style={{ ...styles.button, ...styles.secondaryButton }}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSavePremium}
                    style={styles.button}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : editingPremium ? 'Update Premium' : 'Create Premium'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default ShiftPremiumsTab;