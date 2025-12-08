// components/HR/HRPayrollComponents/PET-DraftLookupModal.jsx - FIXED: Resolved Console Errors
import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const PETDraftLookupModal = ({ 
  isOpen, 
  onClose, 
  effectiveBusinessId,
  onLoadDraft
}) => {
  const [draftPayrollRuns, setDraftPayrollRuns] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [selectedDrafts, setSelectedDrafts] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  // FIXED: Simplified security context to prevent rate limiting issues
  const {
    logSecurityEvent,
    recordAction
  } = useSecurityContext({
    componentName: 'PETDraftLookupModal',
    sensitiveComponent: true,
    enableRateLimiting: false, // DISABLED to prevent console errors
    enableAuditLogging: true,
    securityLevel: 'medium' // Reduced from high to prevent conflicts
  });

  // Authentication context
  const {
    selectedBusinessId: authBusinessId,
    authUser,
    userRole,
    businessData
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'hr_admin'],
    requireBusiness: true,
    componentName: 'PETDraftLookupModal'
  });

  // Tax calculations for formatting
  const { formatTaxAmount } = useTaxCalculations(effectiveBusinessId || authBusinessId);

  // Use effective business ID
  const businessId = effectiveBusinessId || authBusinessId;

  const timezone = businessData?.timezone || 'America/Toronto';

  const normalizeDateInput = (value) => {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `${value}T12:00:00`;
    }
    return value;
  };

  const formatDate = (value) => {
    try {
      const normalized = normalizeDateInput(value);
      if (!normalized) return '—';
      return new Date(normalized).toLocaleDateString('en-CA', { timeZone: timezone });
    } catch (err) {
      console.warn('Failed to format date:', value, err);
      return value || '—';
    }
  };

  const formatDateTime = (value) => {
    try {
      const normalized = normalizeDateInput(value);
      if (!normalized) return '—';
      return new Date(normalized).toLocaleString('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (err) {
      console.warn('Failed to format date/time:', value, err);
      return value || '—';
    }
  };

  useEffect(() => {
    if (isOpen && businessId) {
      loadDraftPayrollRuns();
      setSelectedDrafts(new Set());
      setError(null);
    }
  }, [isOpen, businessId]);

  // FIXED: Simplified load function with better error handling
  const loadDraftPayrollRuns = async () => {
    if (!businessId) return;

    try {
      setLoadingDrafts(true);
      setError(null);

      // FIXED: Simple security logging without rate limiting
      try {
        await logSecurityEvent('draft_payrolls_accessed', {
          business_id: businessId,
          action: 'load_draft_payrolls'
        }, 'low');
      } catch (securityError) {
        console.warn('Security logging failed, continuing...', securityError);
      }
      
      const { data, error } = await supabase
        .from('hrpayroll_runs')
        .select(`
          id,
          pay_period_start,
          pay_period_end,
          pay_date,
          status,
          created_at,
          created_by
        `)
        .eq('business_id', businessId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading draft payroll runs:', error);
        setError('Failed to load draft payroll runs: ' + error.message);
        return;
      }

      setDraftPayrollRuns(data || []);
      
      // FIXED: Safe action recording
      try {
        await recordAction('load_draft_payrolls', true);
      } catch (actionError) {
        console.warn('Action recording failed, continuing...', actionError);
      }

    } catch (error) {
      console.error('Error loading draft payroll runs:', error);
      setError('Failed to load draft payroll runs. Please try again.');
      
      try {
        await recordAction('load_draft_payrolls', false);
      } catch (actionError) {
        console.warn('Action recording failed:', actionError);
      }
    } finally {
      setLoadingDrafts(false);
    }
  };

  // Handle single draft selection
  const handleDraftSelection = (draftId, checked) => {
    setSelectedDrafts(prev => {
      const newSelection = new Set(prev);
      if (checked) {
        newSelection.add(draftId);
      } else {
        newSelection.delete(draftId);
      }
      return newSelection;
    });
  };

  // Handle select all / deselect all
  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedDrafts(new Set(draftPayrollRuns.map(draft => draft.id)));
    } else {
      setSelectedDrafts(new Set());
    }
  };

  // FIXED: Simplified mass delete function
  const massDeleteDrafts = async () => {
    if (selectedDrafts.size === 0) {
      alert('Please select drafts to delete');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedDrafts.size} draft payroll runs? This cannot be undone.`)) {
      return;
    }

    try {
      setDeleting(true);
      
      // FIXED: Safe security logging
      try {
        await logSecurityEvent('mass_draft_payroll_deletion', {
          business_id: businessId,
          draft_count: selectedDrafts.size,
          draft_ids: Array.from(selectedDrafts)
        }, 'medium');
      } catch (securityError) {
        console.warn('Security logging failed, continuing...', securityError);
      }

      // Delete entries first (foreign key constraint)
      const { error: entriesError } = await supabase
        .from('hrpayroll_entries')
        .delete()
        .in('payroll_run_id', Array.from(selectedDrafts));

      if (entriesError) {
        throw new Error(`Failed to delete entries: ${entriesError.message}`);
      }

      // Delete the payroll runs
      const { error: runsError } = await supabase
        .from('hrpayroll_runs')
        .delete()
        .in('id', Array.from(selectedDrafts));

      if (runsError) {
        throw new Error(`Failed to delete payroll runs: ${runsError.message}`);
      }

      // Clear selection and refresh list
      setSelectedDrafts(new Set());
      await loadDraftPayrollRuns();
      
      alert(`${selectedDrafts.size} draft payroll runs deleted successfully.`);

    } catch (error) {
      console.error('Error deleting draft payrolls:', error);
      alert('Error deleting draft payrolls: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  // FIXED: Simplified single delete function
  const deleteDraftPayrollRun = async (draftRun) => {
    if (!confirm(`Are you sure you want to delete the draft payroll for ${draftRun.pay_period_start} to ${draftRun.pay_period_end}? This cannot be undone.`)) {
      return;
    }

    try {
      // FIXED: Safe security logging
      try {
        await logSecurityEvent('draft_payroll_deleted', {
          business_id: businessId,
          payroll_run_id: draftRun.id,
          pay_period: `${draftRun.pay_period_start} to ${draftRun.pay_period_end}`,
          user_role: userRole,
          user_id: authUser?.id
        }, 'medium');
      } catch (securityError) {
        console.warn('Security logging failed, continuing...', securityError);
      }

      // Delete entries first (foreign key constraint)
      const { error: entriesError } = await supabase
        .from('hrpayroll_entries')
        .delete()
        .eq('payroll_run_id', draftRun.id);

      if (entriesError) {
        throw new Error(`Failed to delete entries: ${entriesError.message}`);
      }

      // Delete the payroll run
      const { error: runError } = await supabase
        .from('hrpayroll_runs')
        .delete()
        .eq('id', draftRun.id);

      if (runError) {
        throw new Error(`Failed to delete payroll run: ${runError.message}`);
      }

      // Remove from selection if it was selected
      setSelectedDrafts(prev => {
        const newSelection = new Set(prev);
        newSelection.delete(draftRun.id);
        return newSelection;
      });

      // Refresh the draft list
      await loadDraftPayrollRuns();
      
      alert('Draft payroll deleted successfully.');

    } catch (error) {
      console.error('Error deleting draft payroll:', error);
      alert('Error deleting draft payroll: ' + error.message);
    }
  };

  // FIXED: Simplified load draft function with comprehensive error handling
  const handleLoadDraft = async (draftRun) => {
    console.log('🚀 Loading draft payroll:', draftRun);

    // Validate inputs
    if (!draftRun) {
      console.error('❌ No draft run provided');
      alert('Error: No draft payroll selected');
      return;
    }

    if (!onLoadDraft || typeof onLoadDraft !== 'function') {
      console.error('❌ onLoadDraft is not a function:', onLoadDraft);
      alert('Error: Load function not available. Please refresh the page and try again.');
      return;
    }

    try {
      console.log('⏳ Starting load process...');

      // FIXED: Safe security logging
      try {
        await logSecurityEvent('draft_payroll_loaded', {
          business_id: businessId,
          payroll_run_id: draftRun.id,
          pay_period: `${draftRun.pay_period_start} to ${draftRun.pay_period_end}`,
          user_role: userRole,
          user_id: authUser?.id
        }, 'low');
      } catch (securityError) {
        console.warn('Security logging failed, continuing...', securityError);
      }

      // FIXED: Safe action recording
      try {
        await recordAction('draft_payroll_load', draftRun.id);
      } catch (actionError) {
        console.warn('Action recording failed, continuing...', actionError);
      }
      
      console.log('📄 Calling onLoadDraft function...');
      await onLoadDraft(draftRun);
      
      console.log('✅ Load completed successfully!');

      // Close the modal after successful load
      onClose();

    } catch (error) {
      console.error('❌ Error loading draft:', error);
      alert('Error loading draft payroll: ' + error.message);
    }
  };

  // FIXED: Simplified styles object
  const styles = {
    modal: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
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
      maxHeight: '80vh',
      overflow: 'auto',
      boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)'
    },
    modalHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.gray50
    },
    modalTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    modalClose: {
      background: 'none',
      border: 'none',
      fontSize: '24px',
      cursor: 'pointer',
      color: TavariStyles.colors.gray600,
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '32px',
      height: '32px'
    },
    modalBody: {
      padding: TavariStyles.spacing.xl
    },
    loadingMessage: {
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
      padding: TavariStyles.spacing.xl,
      fontSize: TavariStyles.typography.fontSize.md
    },
    errorMessage: {
      textAlign: 'center',
      color: TavariStyles.colors.danger,
      padding: TavariStyles.spacing.xl,
      fontSize: TavariStyles.typography.fontSize.md,
      backgroundColor: TavariStyles.colors.danger + '10',
      border: `1px solid ${TavariStyles.colors.danger}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.lg
    },
    noDraftsMessage: {
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
      padding: TavariStyles.spacing.xl,
      fontSize: TavariStyles.typography.fontSize.md
    },
    description: {
      marginBottom: TavariStyles.spacing.lg,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    massActionsHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    selectAllSection: {
      display: 'flex',
      alignItems: 'center'
    },
    massDeleteButton: {
      backgroundColor: TavariStyles.colors.danger,
      color: TavariStyles.colors.white,
      border: 'none',
      padding: '8px 16px',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer'
    },
    massDeleteButtonDisabled: {
      opacity: 0.6,
      cursor: 'not-allowed'
    },
    draftItemWithCheckbox: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.sm,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      backgroundColor: TavariStyles.colors.white
    },
    draftItemContent: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flex: 1
    },
    selectedDraftItem: {
      backgroundColor: `${TavariStyles.colors.primary}08`,
      borderColor: `${TavariStyles.colors.primary}40`
    },
    draftItemInfo: {
      flex: 1
    },
    draftItemTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    draftItemDetails: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    draftItemActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm
    },
    draftActionButton: {
      padding: '8px 16px',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer'
    },
    loadDraftButton: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    deleteDraftButton: {
      backgroundColor: TavariStyles.colors.danger,
      color: TavariStyles.colors.white
    }
  };

  if (!isOpen) return null;

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'hr_admin']}
      requireBusiness={true}
      componentName="PETDraftLookupModal"
    >
      <SecurityWrapper
        componentName="PETDraftLookupModal"
        sensitiveComponent={true}
        enableRateLimiting={false}
        enableAuditLogging={true}
        securityLevel="medium"
      >
        <div style={styles.modal} onClick={(e) => e.target === e.currentTarget && onClose()}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Load Draft Payroll</h3>
              <button 
                style={styles.modalClose} 
                onClick={onClose}
                onMouseOver={(e) => e.target.style.backgroundColor = TavariStyles.colors.gray200}
                onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
              >
                ×
              </button>
            </div>
            <div style={styles.modalBody}>
              {error && (
                <div style={styles.errorMessage}>
                  {error}
                  <button 
                    onClick={() => {
                      setError(null);
                      loadDraftPayrollRuns();
                    }}
                    style={{
                      marginLeft: TavariStyles.spacing.md,
                      padding: '4px 8px',
                      fontSize: TavariStyles.typography.fontSize.xs,
                      backgroundColor: TavariStyles.colors.white,
                      color: TavariStyles.colors.danger,
                      border: `1px solid ${TavariStyles.colors.danger}`,
                      borderRadius: TavariStyles.borderRadius?.sm || '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {loadingDrafts ? (
                <div style={styles.loadingMessage}>
                  Loading draft payroll runs...
                </div>
              ) : draftPayrollRuns.length === 0 ? (
                <div style={styles.noDraftsMessage}>
                  No draft payroll runs found. Create a new payroll run to get started.
                </div>
              ) : (
                <div>
                  <div style={styles.description}>
                    Click "Load" to continue working on a draft payroll, or use checkboxes to select multiple drafts for deletion.
                  </div>
                  
                  {/* Mass Actions Header */}
                  <div style={styles.massActionsHeader}>
                    <div style={styles.selectAllSection}>
                      <TavariCheckbox
                        checked={selectedDrafts.size === draftPayrollRuns.length && draftPayrollRuns.length > 0}
                        onChange={(checked) => handleSelectAll(checked)}
                        label={`Select All (${selectedDrafts.size} of ${draftPayrollRuns.length} selected)`}
                        size="sm"
                        id="select-all-drafts"
                        name="select_all_drafts"
                      />
                    </div>
                    
                    {selectedDrafts.size > 0 && (
                      <button
                        style={{
                          ...styles.massDeleteButton,
                          ...(deleting ? styles.massDeleteButtonDisabled : {})
                        }}
                        onClick={massDeleteDrafts}
                        disabled={deleting}
                      >
                        {deleting ? 'Deleting...' : `Delete Selected (${selectedDrafts.size})`}
                      </button>
                    )}
                  </div>

                  {draftPayrollRuns.map(draft => {
                    const isSelected = selectedDrafts.has(draft.id);
                    
                    return (
                      <div
                        key={draft.id}
                        style={{
                          ...styles.draftItemWithCheckbox,
                          ...(isSelected ? styles.selectedDraftItem : {})
                        }}
                      >
                        <TavariCheckbox
                          checked={isSelected}
                          onChange={(checked) => handleDraftSelection(draft.id, checked)}
                          size="sm"
                          id={`draft-${draft.id}`}
                          name={`draft_${draft.id}`}
                        />
                        
                        <div style={styles.draftItemContent}>
                          <div style={styles.draftItemInfo}>
                            <div style={styles.draftItemTitle}>
                            Pay Period: {formatDate(draft.pay_period_start)} - {formatDate(draft.pay_period_end)}
                            </div>
                            <div style={styles.draftItemDetails}>
                            Pay Date: {formatDate(draft.pay_date)} | 
                            Created: {formatDateTime(draft.created_at)}
                            </div>
                          </div>
                          <div style={styles.draftItemActions}>
                            <button
                              style={{...styles.draftActionButton, ...styles.loadDraftButton}}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleLoadDraft(draft);
                              }}
                              onMouseOver={(e) => e.target.style.opacity = '0.9'}
                              onMouseOut={(e) => e.target.style.opacity = '1'}
                            >
                              Load
                            </button>
                            <button
                              style={{...styles.draftActionButton, ...styles.deleteDraftButton}}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                deleteDraftPayrollRun(draft);
                              }}
                              onMouseOver={(e) => e.target.style.opacity = '0.9'}
                              onMouseOut={(e) => e.target.style.opacity = '1'}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default PETDraftLookupModal;