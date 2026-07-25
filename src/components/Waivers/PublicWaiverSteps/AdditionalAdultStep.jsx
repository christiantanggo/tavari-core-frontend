// Participant management step after primary adult info
import React, { useState } from 'react';
import { FiUserPlus, FiArrowRight, FiX, FiAlertCircle, FiUsers } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_POST_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import TavariCheckbox from '../../UI/TavariCheckbox';
import CancelConfirmationModal from './CancelConfirmationModal';
import TimeoutWarningModal from './TimeoutWarningModal';
import ParticipantInfoStep from './ParticipantInfoStep';
import { getAdditionalAdultIntentAcknowledgmentFullText } from '../../../constants/waiverLegalCopy';

const AdditionalAdultStep = ({
  mode = 'adults',
  onAdd,
  onAddChild,
  onContinue,
  onCancel,
  onBack,
  participants = [],
  modalParticipant,
  modalFormData,
  setModalFormData,
  onModalSubmit,
  onModalClose,
  template,
  customerInfo,
  businessTimezone = 'America/Toronto',
  minorAgeThreshold = 18,
  waiverSettings = {},
  title,
  subtitle,
  reminderTitle,
  reminderText,
  addButtonLabel,
  continueButtonLabel,
  continueConfirmation,
  addConfirmation,
  suspendInactivityTimer = false
}) => {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showContinueConfirm, setShowContinueConfirm] = useState(false);
  const [showAddConfirm, setShowAddConfirm] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const { timeRemaining, resetTimer, showWarning, setShowWarning } = useInactivityTimer(
    () => {
      if (onCancel) onCancel({ reason: 'idle_ad' });
    },
    WAIVER_POST_OTP_TIMEOUT_SECONDS,
    null,
    { enabled: !suspendInactivityTimer, warningSeconds: WAIVER_TIMEOUT_WARNING_SECONDS }
  );
  
  const handleExtendSession = () => {
    resetTimer();
    setShowWarning(false);
  };
  
  const handleCloseSession = () => {
    if (onCancel) onCancel();
  };

  const handleCancelClick = () => {
    setShowCancelConfirm(true);
  };

  const handleCancelConfirm = () => {
    setShowCancelConfirm(false);
    if (onCancel) onCancel();
  };

  const handleCancelCancel = () => {
    setShowCancelConfirm(false);
  };

  const isChildrenMode = mode === 'children';
  const resolvedTitle = title || (isChildrenMode ? 'Add Children' : 'Additional Adults');
  const resolvedSubtitle =
    subtitle ||
    (isChildrenMode
      ? 'Add every child who needs a waiver before continuing to the waiver review.'
      : 'Add every additional adult who should be included before continuing.');
  const resolvedReminderTitle = reminderTitle || 'Important Reminder';
  const resolvedReminderText =
    reminderText ||
    (isChildrenMode
      ? 'Every child requires a waiver, including babies and any child who is not playing.'
      : 'Every adult requires a waiver, whether they are playing or not. This includes grandparents, parents, and spectators.');
  const resolvedChildButtonLabel = isChildrenMode ? (addButtonLabel || 'Add Child') : 'Add Child';
  const resolvedAdultButtonLabel = addButtonLabel || 'Add Additional Adult';
  const resolvedContinueButtonLabel =
    continueButtonLabel || (isChildrenMode ? 'Continue to Waiver Review' : 'Continue Without Additional Adult');
  const additionalAdultDisclaimerText = getAdditionalAdultIntentAcknowledgmentFullText();

  const openContinueConfirm = () => {
    if (continueConfirmation) {
      setShowContinueConfirm(true);
      return;
    }
    onContinue?.();
  };

  const openAddConfirm = () => {
    if (!onAdd) return;
    if (addConfirmation) {
      setConfirmChecked(false);
      setShowAddConfirm(true);
      return;
    }
    onAdd();
  };

  return (
    <div style={styles.container}>
      {showWarning && (
        <TimeoutWarningModal
          onClose={handleCloseSession}
          onExtend={handleExtendSession}
          timeRemaining={timeRemaining}
        />
      )}
      {showCancelConfirm && (
        <CancelConfirmationModal
          onConfirm={handleCancelConfirm}
          onCancel={handleCancelCancel}
        />
      )}
      {showContinueConfirm && continueConfirmation && (
        <div style={styles.modalOverlay} onClick={() => setShowContinueConfirm(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.confirmTitle}>{continueConfirmation.title}</h2>
            <p style={styles.confirmText}>{continueConfirmation.message}</p>
            <div style={styles.confirmActions}>
              <button onClick={() => setShowContinueConfirm(false)} style={styles.modalSecondaryButton}>Back</button>
              <button
                onClick={() => {
                  setShowContinueConfirm(false);
                  onContinue?.();
                }}
                style={styles.modalPrimaryButton}
              >
                {continueConfirmation.confirmLabel || 'Yes, continue'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showAddConfirm && addConfirmation && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.confirmTitle}>{addConfirmation.title}</h2>
            <p style={styles.confirmText}>{addConfirmation.message}</p>
            <div style={styles.disclaimerBox}>
              <p style={styles.disclaimerText}>{additionalAdultDisclaimerText}</p>
            </div>
            <div style={styles.confirmCheckbox}>
              <TavariCheckbox
                checked={confirmChecked}
                onChange={(checked) => setConfirmChecked(checked)}
                label={addConfirmation.checkboxLabel}
                size="md"
              />
            </div>
            <div style={styles.confirmActions}>
              <button onClick={() => setShowAddConfirm(false)} style={styles.modalSecondaryButton}>Back</button>
              <button
                onClick={() => {
                  if (!confirmChecked) return;
                  setShowAddConfirm(false);
                  onAdd?.();
                }}
                style={{
                  ...styles.modalPrimaryButton,
                  ...(!confirmChecked ? styles.disabledButton : {})
                }}
              >
                {addConfirmation.confirmLabel || resolvedAdultButtonLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={styles.content}>
        <div style={styles.header}>
          <FiUsers size={48} style={styles.icon} />
          <h1 style={styles.title}>{resolvedTitle}</h1>
          <p style={styles.subtitle}>
            {resolvedSubtitle}
          </p>
        </div>

        <div style={styles.legalBox}>
          <FiAlertCircle style={styles.legalIcon} />
          <div style={styles.legalContent}>
            <p style={styles.legalTitle}>{resolvedReminderTitle}</p>
            <p style={styles.legalText}>
              {resolvedReminderText}
            </p>
          </div>
        </div>

        {participants.length > 0 && (
          <div style={styles.summarySection}>
            <h3 style={styles.summaryTitle}>Added So Far</h3>
            <div style={styles.summaryList}>
              {participants.map((participant, index) => {
                const participantName = `${participant?.data?.firstName || ''} ${participant?.data?.lastName || ''}`.trim();
                const label = participant?.type === 'primary'
                  ? 'Primary Adult'
                  : participant?.type === 'minor'
                    ? `Child ${participants.slice(0, index + 1).filter((p) => p.type === 'minor').length}`
                    : `Additional Adult ${participants.slice(0, index + 1).filter((p) => p.type === 'additional_adult').length}`;
                return (
                  <div key={`${participant?.type || 'participant'}-${participant?.index ?? index}`} style={styles.summaryRow}>
                    <span style={styles.summaryChip}>{label}</span>
                    <span style={styles.summaryName}>{participantName || 'Information not entered yet'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={styles.buttons}>
          {onBack && (
            <button
              onClick={onBack}
              style={styles.backButton}
            >
              Back
            </button>
          )}
          {onAddChild && (
            <button
              onClick={onAddChild}
              style={styles.childButton}
            >
              <FiUsers style={styles.buttonIcon} />
              {resolvedChildButtonLabel}
            </button>
          )}
          {!isChildrenMode && onAdd && (
            <button
              onClick={openAddConfirm}
              style={styles.addButton}
            >
              <FiUserPlus style={styles.buttonIcon} />
              {resolvedAdultButtonLabel}
            </button>
          )}

          <button
            onClick={openContinueConfirm}
            style={styles.skipButton}
          >
            <FiArrowRight style={styles.buttonIcon} />
            {resolvedContinueButtonLabel}
          </button>
          
          {onCancel && (
            <button
              onClick={handleCancelClick}
              style={styles.cancelButton}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {modalParticipant && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <ParticipantInfoStep
              embedded
              participant={modalParticipant}
              formData={modalFormData}
              setFormData={setModalFormData}
              onSubmit={onModalSubmit}
              onBack={onModalClose}
              backLabel="Back"
              submitLabel={modalParticipant?.type === 'minor' ? 'Save Child' : 'Continue'}
              template={template}
              customerInfo={customerInfo}
              businessTimezone={businessTimezone}
              onCancel={onCancel}
              minorAgeThreshold={minorAgeThreshold}
              waiverSettings={waiverSettings}
              participants={participants}
              suspendInactivityTimer={suspendInactivityTimer}
            />
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    backgroundColor: TavariStyles.colors.background
  },
  content: {
    width: '100%',
    maxWidth: '500px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: '3rem',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    boxShadow: `0 0 0 1px ${TavariStyles.colors.gray200}, ${TavariStyles.shadows.lg}`,
    textAlign: 'center'
  },
  header: {
    marginBottom: '2rem'
  },
  icon: {
    color: TavariStyles.colors.primary,
    marginBottom: '1rem'
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: '0.5rem'
  },
  subtitle: {
    fontSize: '1rem',
    color: TavariStyles.colors.gray600
  },
  legalBox: {
    padding: '1.5rem 3.5rem',
    backgroundColor: '#FEF3C7',
    borderRadius: TavariStyles.borderRadius.md,
    marginBottom: '2rem',
    border: '2px solid #F59E0B',
    position: 'relative',
    textAlign: 'center'
  },
  legalIcon: {
    color: '#F59E0B',
    fontSize: '1.5rem',
    position: 'absolute',
    left: '1rem',
    top: '1rem'
  },
  legalContent: {
    width: '100%',
    maxWidth: '360px',
    margin: '0 auto'
  },
  legalTitle: {
    fontSize: '1rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    margin: '0 0 0.5rem 0'
  },
  legalText: {
    fontSize: '0.875rem',
    color: TavariStyles.colors.text,
    margin: 0,
    lineHeight: '1.6'
  },
  buttons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  backButton: {
    padding: '1rem 2rem',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.text,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    width: '100%'
  },
  summarySection: {
    marginBottom: '2rem',
    textAlign: 'left'
  },
  summaryTitle: {
    margin: '0 0 0.75rem 0',
    fontSize: '1rem',
    fontWeight: '700',
    color: TavariStyles.colors.text
  },
  summaryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  summaryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: TavariStyles.borderRadius.md,
    backgroundColor: '#F9FAFB'
  },
  summaryChip: {
    fontSize: '0.75rem',
    fontWeight: '700',
    color: TavariStyles.colors.primary,
    textTransform: 'uppercase',
    letterSpacing: '0.04em'
  },
  summaryName: {
    fontSize: '0.9rem',
    color: TavariStyles.colors.text
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(17, 24, 39, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.5rem',
    zIndex: 1000
  },
  modalCard: {
    width: '100%',
    maxWidth: '760px',
    maxHeight: '90vh',
    overflowY: 'auto',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: '2rem',
    boxShadow: TavariStyles.shadows.lg
  },
  confirmTitle: {
    margin: '0 0 1rem 0',
    fontSize: '1.35rem',
    fontWeight: '700',
    color: TavariStyles.colors.text
  },
  confirmText: {
    margin: '0 0 1rem 0',
    color: TavariStyles.colors.text,
    lineHeight: 1.6
  },
  disclaimerBox: {
    padding: '1rem 1.1rem',
    marginBottom: '1rem',
    backgroundColor: '#FEFCE8',
    border: '1px solid #FDE047',
    borderRadius: TavariStyles.borderRadius.md,
    maxHeight: '280px',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch'
  },
  disclaimerText: {
    margin: 0,
    fontSize: '0.9rem',
    lineHeight: 1.65,
    color: TavariStyles.colors.text
  },
  confirmCheckbox: {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'flex-start',
    marginBottom: '1.25rem',
    textAlign: 'left'
  },
  confirmActions: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end',
    flexWrap: 'wrap'
  },
  modalSecondaryButton: {
    padding: '0.9rem 1.25rem',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.text,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '0.95rem',
    fontWeight: '600',
    cursor: 'pointer'
  },
  modalPrimaryButton: {
    padding: '0.9rem 1.25rem',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '0.95rem',
    fontWeight: '600',
    cursor: 'pointer'
  },
  disabledButton: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  addButton: {
    padding: '1rem 2rem',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    width: '100%'
  },
  childButton: {
    padding: '1rem 2rem',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    width: '100%'
  },
  skipButton: {
    padding: '1rem 2rem',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.text,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    width: '100%'
  },
  buttonIcon: {
    fontSize: '1.25rem'
  },
  cancelButton: {
    padding: '1rem 2rem',
    backgroundColor: '#EF4444',
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    minWidth: '120px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    width: '100%'
  }
};

export default AdditionalAdultStep;



