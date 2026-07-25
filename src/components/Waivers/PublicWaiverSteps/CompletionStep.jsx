// Completion Step - Waiver signed successfully with detailed information
import React, { useState, useEffect, useRef } from 'react';
import { FiCheckCircle, FiClock, FiFileText, FiEye } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import { supabase } from '../../../supabaseClient';
import WaiverSettingsService from '../../../services/Waivers/WaiverSettingsService';
import { completionRedirectMessage } from '../../../utils/publicWaiverRedirect';

const CompletionStep = ({
  waiver,
  participants,
  business,
  template,
  onNewWaiver,
  onClose,
  onResign,
  onViewWaiver,
  fromBooking = false,
  completionRedirect = null,
  isKioskMode: isKioskModeProp
}) => {
  const redirectSeconds = fromBooking ? 2 : 10;
  const [timeRemaining, setTimeRemaining] = useState(redirectSeconds);
  const [showWaiverContent, setShowWaiverContent] = useState(false);
  const [expiryDays, setExpiryDays] = useState(null);
  const [loadedParticipants, setLoadedParticipants] = useState(participants || []);
  const timerRef = useRef(null);
  const hasTriggeredCloseRef = useRef(false);
  const isKioskMode =
    isKioskModeProp ??
    (() => {
      if (typeof window === 'undefined') return false;
      const search = new URLSearchParams(window.location.search || '');
      return (
        search.get('signingStation') === 'browser_kiosk' ||
        !!window.electronAPI ||
        !!window.__TAVARI_KIOSK_MODE__ ||
        !!window.__TAVARI_ELECTRON__
      );
    })();
  const shouldAutoClose = fromBooking || isKioskMode || !!completionRedirect;
  const redirectPrefix = completionRedirectMessage(completionRedirect);

  // Reset timer on user interaction (only when not fromBooking so user can read)
  const resetTimer = () => {
    if (!fromBooking) setTimeRemaining(redirectSeconds);
  };

  const handleCloseOnce = () => {
    if (hasTriggeredCloseRef.current) return;
    hasTriggeredCloseRef.current = true;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    onClose?.(isKioskMode ? { reason: 'idle_ad' } : undefined);
  };

  useEffect(() => {
    // Listen for user interactions
    const handleInteraction = () => {
      resetTimer();
    };

    window.addEventListener('mousedown', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    window.addEventListener('scroll', handleInteraction);

    return () => {
      window.removeEventListener('mousedown', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
      window.removeEventListener('scroll', handleInteraction);
    };
  }, []);

  useEffect(() => {
    if (!shouldAutoClose) return undefined;

    if (timeRemaining <= 0) {
      handleCloseOnce();
      return undefined;
    }

    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          handleCloseOnce();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [timeRemaining, onClose, isKioskMode, shouldAutoClose]);

  // Load expiry days from settings and participants
  useEffect(() => {
    const loadData = async () => {
      if (!waiver?.business_id) return;
      
      try {
        // Load expiry days from settings
        WaiverSettingsService.setBusinessId(waiver.business_id);
        const settings = await WaiverSettingsService.getGlobalSettings();
        const defaultExpiryDays = settings?.default_expiry_days;
        
        if (defaultExpiryDays) {
          setExpiryDays(typeof defaultExpiryDays === 'number' ? defaultExpiryDays : parseInt(defaultExpiryDays));
        }
        
        // Load participants if not already loaded or if waiver ID changed
        if (waiver?.id && (!loadedParticipants || loadedParticipants.length === 0 || loadedParticipants[0]?.waiver_id !== waiver.id)) {
          const { data: participantData } = await supabase
            .from('waiver_participants')
            .select('*')
            .eq('waiver_id', waiver.id)
            .order('created_at', { ascending: true });
          
          if (participantData) {
            setLoadedParticipants(participantData);
          }
        }
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };
    
    loadData();
  }, [waiver?.business_id, waiver?.id]);
  
  // Update loaded participants when participants prop changes
  useEffect(() => {
    if (participants && participants.length > 0) {
      setLoadedParticipants(participants);
    }
  }, [participants]);

  // Log signature data when modal opens
  useEffect(() => {
    if (showWaiverContent) {
      console.log('========== [CompletionStep] View Waiver Modal Opened ==========');
      console.log('[CompletionStep] Waiver signature data:', {
        waiverId: waiver?.id,
        hasSignatureImageUrl: !!waiver?.signature_image_url,
        signatureImageUrl: waiver?.signature_image_url,
        hasSignatureData: !!waiver?.signature_data,
        signatureData: waiver?.signature_data,
        hasGuardianSignatureUrl: !!waiver?.guardian_signature_url,
        guardianSignatureUrl: waiver?.guardian_signature_url,
        hasGuardianSignatureData: !!waiver?.guardian_signature_data,
        participants: loadedParticipants?.map(p => ({
          type: p.participant_type || p.type,
          firstName: p.first_name || p.data?.firstName,
          lastName: p.last_name || p.data?.lastName,
          hasSignature: !!(p.signature_image_url || p.data?.signatureImageUrl),
          signatureUrl: p.signature_image_url || p.data?.signatureImageUrl
        }))
      });
    }
  }, [showWaiverContent, waiver, loadedParticipants]);

  // Calculate days until expiry with extensive logging
  const getDaysUntilExpiry = () => {
    console.log('========== [CompletionStep] getDaysUntilExpiry START ==========');
    console.log('[CompletionStep] Waiver data:', {
      hasWaiver: !!waiver,
      waiverId: waiver?.id,
      expires_at: waiver?.expires_at,
      signed_at: waiver?.signed_at,
      expiryDays: expiryDays
    });
    
    // If expires_at is set, use that
    if (waiver?.expires_at) {
      console.log('[CompletionStep] Using expires_at from waiver');
      const expiryDate = new Date(waiver.expires_at);
      const now = new Date();
      console.log('[CompletionStep] Expiry calculation:', {
        expiryDate: expiryDate.toISOString(),
        now: now.toISOString(),
        expiryDateValue: waiver.expires_at
      });
      
      const diffTime = expiryDate - now;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      console.log('[CompletionStep] Calculated days:', {
        diffTime,
        diffDays,
        diffTimeMs: diffTime,
        diffTimeHours: diffTime / (1000 * 60 * 60),
        diffTimeDays: diffTime / (1000 * 60 * 60 * 24)
      });
      
      const result = diffDays > 0 ? diffDays : 0;
      console.log('[CompletionStep] Final result (expires_at):', result);
      console.log('========== [CompletionStep] getDaysUntilExpiry END ==========');
      return result;
    }
    
    // If no expires_at but we have signed_at and expiry days from settings, calculate it
    if (waiver?.signed_at && expiryDays) {
      console.log('[CompletionStep] Calculating expiry from signed_at + expiryDays');
      console.log('[CompletionStep] Calculation inputs:', {
        signed_at: waiver.signed_at,
        signed_atType: typeof waiver.signed_at,
        expiryDays,
        expiryDaysType: typeof expiryDays
      });
      
      const signedDate = new Date(waiver.signed_at);
      console.log('[CompletionStep] Signed date:', {
        signedDate: signedDate.toISOString(),
        signedDateValue: waiver.signed_at,
        signedDateValid: !isNaN(signedDate.getTime())
      });
      
      const calculatedExpiry = new Date(signedDate.getTime() + expiryDays * 24 * 60 * 60 * 1000);
      console.log('[CompletionStep] Calculated expiry:', {
        calculatedExpiry: calculatedExpiry.toISOString(),
        signedDateMs: signedDate.getTime(),
        expiryDaysMs: expiryDays * 24 * 60 * 60 * 1000,
        totalMs: signedDate.getTime() + expiryDays * 24 * 60 * 60 * 1000
      });
      
      const now = new Date();
      const diffTime = calculatedExpiry - now;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      console.log('[CompletionStep] Calculated days:', {
        now: now.toISOString(),
        diffTime,
        diffDays,
        diffTimeMs: diffTime,
        diffTimeHours: diffTime / (1000 * 60 * 60),
        diffTimeDays: diffTime / (1000 * 60 * 60 * 24)
      });
      
      const result = diffDays > 0 ? diffDays : 0;
      console.log('[CompletionStep] Final result (calculated):', result);
      console.log('========== [CompletionStep] getDaysUntilExpiry END ==========');
      return result;
    }
    
    console.log('[CompletionStep] No expiry data available:', {
      hasExpiresAt: !!waiver?.expires_at,
      hasSignedAt: !!waiver?.signed_at,
      hasExpiryDays: !!expiryDays
    });
    console.log('========== [CompletionStep] getDaysUntilExpiry END ==========');
    return null;
  };

  // Get primary adult (from waiver itself)
  const primaryAdult = waiver ? {
    firstName: waiver.first_name || '',
    lastName: waiver.last_name || '',
    dateOfBirth: waiver.date_of_birth || '',
    email: waiver.email || '',
    phoneNumber: waiver.phone_number || '',
    address: waiver.address || '',
    city: waiver.city || '',
    postalCode: waiver.postal_code || ''
  } : null;

  // Get minors (each in their own row) - handle both data structures
  const minors = loadedParticipants?.filter(p => 
    p.type === 'minor' || 
    p.participant_type === 'minor' ||
    (p.data && p.data.type === 'minor')
  ) || [];
  
  // Get additional adults - handle both data structures
  const additionalAdults = loadedParticipants?.filter(p => 
    p.type === 'additional_adult' || 
    p.participant_type === 'additional_adult' ||
    (p.data && p.data.type === 'additional_adult')
  ) || [];

  // Format signed date
  const signedDate = waiver?.signed_at 
    ? new Date(waiver.signed_at).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'N/A';

  const daysUntilExpiry = getDaysUntilExpiry();
  const waiverName = waiver?.waiver_templates?.template_name || waiver?.waiver_templates?.waiver_title || template?.template_name || template?.waiver_title || 'Waiver';
  
  // Safety check - ensure all required data exists before rendering
  if (!waiver) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading waiver information...</div>;
  }

  // Safely get template content, ensuring it's a string
  const getSafeTemplateContent = () => {
    try {
      if (!template?.waiver_content) return '';
      const content = String(template.waiver_content);
      // Remove any potential script tags or dangerous content
      return content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    } catch (error) {
      console.error('[CompletionStep] Error processing template content:', error);
      return '';
    }
  };

  return (
    <div style={styles.container} className="public-waiver-shell public-waiver-flow">
      <div style={styles.content} className="public-waiver-card">
        <FiCheckCircle size={80} style={styles.successIcon} />
        <h1 style={styles.successTitle}>
          {fromBooking ? 'Your Waiver Has Been Completed' : 'Waiver Submitted'}
        </h1>
        <p style={styles.successMessage}>
          {fromBooking
            ? 'Wait while we confirm your booking.'
            : isKioskMode
              ? 'Your waiver has been submitted, an email copy has been sent, and you can now go to the counter to check in.'
              : 'Your waiver has been submitted and an email copy has been sent.'}
        </p>
        
        {/* Timer / redirect message */}
        {shouldAutoClose && (
        <div style={styles.timerContainer}>
          <FiClock size={20} style={styles.timerIcon} />
          <span style={styles.timerText}>
            {fromBooking
              ? (timeRemaining > 0 ? `Redirecting in ${timeRemaining} second${timeRemaining === 1 ? '' : 's'}…` : 'Redirecting…')
              : redirectPrefix
                ? (timeRemaining > 0
                    ? `${redirectPrefix} ${timeRemaining} second${timeRemaining === 1 ? '' : 's'}…`
                    : 'Redirecting…')
                : `This screen will automatically close in ${timeRemaining} seconds`}
          </span>
        </div>
        )}

        {/* New Waiver Button – hide when from booking (quick redirect) */}
        {!fromBooking && (
          <div style={styles.buttonContainer} className="public-waiver-actions">
            <button
              onClick={() => {
                if (onNewWaiver) {
                  onNewWaiver();
                }
              }}
              style={styles.newWaiverButton}
            >
              Start New Waiver
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '2rem',
    backgroundColor: TavariStyles.colors.background
  },
  content: {
    width: '100%',
    maxWidth: '800px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: '3rem',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    boxShadow: `0 0 0 1px ${TavariStyles.colors.gray200}, ${TavariStyles.shadows.xl}`,
    textAlign: 'center'
  },
  successIcon: {
    color: '#10B981',
    marginBottom: '1.5rem'
  },
  successTitle: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: '1rem'
  },
  successMessage: {
    fontSize: '1.25rem',
    color: TavariStyles.colors.gray600,
    marginBottom: '2rem'
  },
  timerContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    padding: '0.75rem',
    backgroundColor: '#FEF3C7',
    borderRadius: TavariStyles.borderRadius.md,
    marginBottom: '2rem',
    border: '1px solid #FCD34D'
  },
  timerIcon: {
    color: '#D97706'
  },
  timerText: {
    fontSize: '0.875rem',
    color: '#92400E',
    fontWeight: '500'
  },
  categorySection: {
    textAlign: 'left',
    marginBottom: '2rem',
    padding: '1.5rem',
    backgroundColor: '#F9FAFB',
    borderRadius: TavariStyles.borderRadius.md,
    border: '1px solid #E5E7EB'
  },
  categoryTitle: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: '1rem',
    paddingBottom: '0.5rem',
    borderBottom: '2px solid #E5E7EB'
  },
  categoryContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  infoRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  infoRowHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.25rem'
  },
  label: {
    fontSize: '0.875rem',
    color: TavariStyles.colors.gray600,
    fontWeight: '600'
  },
  value: {
    fontSize: '1rem',
    color: TavariStyles.colors.text,
    fontWeight: '500'
  },
  minorRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    padding: '0.75rem',
    backgroundColor: '#FFFFFF',
    borderRadius: TavariStyles.borderRadius.sm,
    border: '1px solid #E5E7EB',
    marginBottom: '0.5rem'
  },
  viewButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.375rem 0.75rem',
    backgroundColor: '#008080',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  resignButton: {
    padding: '0.375rem 0.75rem',
    backgroundColor: '#DC2626',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '2rem'
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: TavariStyles.borderRadius.lg,
    maxWidth: '800px',
    width: '100%',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows.xl
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.5rem',
    borderBottom: '1px solid #E5E7EB'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '2rem',
    cursor: 'pointer',
    color: TavariStyles.colors.gray600,
    padding: '0',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  waiverContent: {
    padding: '1.5rem',
    overflowY: 'auto',
    maxHeight: 'calc(90vh - 80px)',
    lineHeight: '1.8',
    whiteSpace: 'break-spaces',
    wordBreak: 'break-word'
  },
  signedWaiverSection: {
    marginBottom: '2rem',
    padding: '1rem',
    backgroundColor: '#F9FAFB',
    borderRadius: '8px',
    border: '1px solid #E5E7EB'
  },
  sectionTitle: {
    fontSize: '1.125rem',
    fontWeight: 'bold',
    marginBottom: '0.75rem',
    color: TavariStyles.colors.text
  },
  participantRow: {
    marginBottom: '1rem',
    paddingBottom: '1rem',
    borderBottom: '1px solid #E5E7EB'
  },
  signatureSection: {
    marginTop: '1rem',
    padding: '1rem',
    backgroundColor: '#FFFFFF',
    borderRadius: '4px',
    border: '1px solid #E5E7EB'
  },
  signatureImage: {
    maxWidth: '300px',
    maxHeight: '100px',
    marginTop: '0.5rem',
    border: '1px solid #E5E7EB',
    borderRadius: '4px'
  },
  waiverContentBody: {
    marginTop: '1rem',
    padding: '1rem',
    backgroundColor: '#FFFFFF',
    borderRadius: '4px',
    whiteSpace: 'break-spaces',
    wordBreak: 'break-word'
  },
  noMinorsMessage: {
    padding: '1rem',
    textAlign: 'center',
    color: TavariStyles.colors.gray600,
    fontStyle: 'italic',
    backgroundColor: '#F9FAFB',
    borderRadius: '4px',
    border: '1px solid #E5E7EB'
  },
  buttonContainer: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'center',
    marginTop: '2rem'
  },
  primaryButton: {
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    padding: '1rem 2rem',
    fontSize: '1rem',
    fontWeight: '600',
    minWidth: '120px'
  },
  secondaryButton: {
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.text,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    padding: '1rem 2rem',
    fontSize: '1rem',
    fontWeight: '600',
    minWidth: '120px'
  },
  newWaiverButton: {
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    padding: '1rem 2rem',
    fontSize: '1rem',
    fontWeight: '600',
    minWidth: '120px'
  }
};

export default CompletionStep;
