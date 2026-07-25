// Review Step - Review and edit all waiver information before submission
import React, { useState, useEffect, useRef } from 'react';
import { FiEdit2, FiCheck, FiX } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_POST_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import CancelConfirmationModal from './CancelConfirmationModal';
import TimeoutWarningModal from './TimeoutWarningModal';
import { formatDateOfBirthDisplay } from '../../../utils/waiverDateOfBirth';
import {
  getResolvedExplicitParticipantFieldValue,
  getResolvedParticipantFieldsConfig,
  validateWaiverParticipantData
} from '../../../utils/waiverParticipantValidation';
import toast from 'react-hot-toast';

const ReviewStep = ({
  participants,
  formData,
  setFormData,
  onSubmit,
  onEdit,
  onCancel,
  onBack,
  onSave,
  phoneNumber,
  customerInfo = null,
  template = {},
  businessTimezone = 'America/Toronto',
  minorAgeThreshold = 18,
  waiverSettings = {},
  suspendInactivityTimer = false
}) => {
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const saveTimeoutRef = useRef(null);

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

  const primaryAdultIndex = participants?.findIndex(p => p.type === 'primary') ?? -1;
  const primaryAdult = primaryAdultIndex >= 0 ? participants[primaryAdultIndex] : {};
  const minors = participants?.filter(p => p.type === 'minor') || [];
  const additionalAdults = participants?.filter(p => p.type === 'additional_adult') || [];
  const resolvedFieldConfig = getResolvedParticipantFieldsConfig({ waiverSettings, template });
  const explicitGlobalEmail = getResolvedExplicitParticipantFieldValue({ waiverSettings, template, key: 'emailAddress' });
  const explicitGlobalPhone = getResolvedExplicitParticipantFieldValue({ waiverSettings, template, key: 'phoneNumber' });
  const explicitGlobalAddress = getResolvedExplicitParticipantFieldValue({ waiverSettings, template, key: 'address' });
  const explicitGlobalCity = getResolvedExplicitParticipantFieldValue({ waiverSettings, template, key: 'city' });
  const explicitGlobalPostalCode = getResolvedExplicitParticipantFieldValue({ waiverSettings, template, key: 'postalCode' });
  const getReviewFieldVisibility = (participantType) => {
    const isMinor = participantType === 'minor';
    return {
      showEmailField: !isMinor && (explicitGlobalEmail !== undefined
        ? explicitGlobalEmail !== false
        : resolvedFieldConfig.participantFields.emailAddress !== false),
      showPhoneField: !isMinor && (explicitGlobalPhone !== undefined
        ? explicitGlobalPhone !== false
        : resolvedFieldConfig.participantFields.phoneNumber !== false),
      showAddressField: !isMinor && (explicitGlobalAddress !== undefined
        ? explicitGlobalAddress !== false
        : resolvedFieldConfig.participantFields.address !== false),
      showCityField: !isMinor && (explicitGlobalCity !== undefined
        ? explicitGlobalCity !== false
        : resolvedFieldConfig.participantFields.city !== false),
      showPostalCodeField: !isMinor && (explicitGlobalPostalCode !== undefined
        ? explicitGlobalPostalCode !== false
        : resolvedFieldConfig.participantFields.postalCode !== false)
    };
  };
  const primaryVisibility = getReviewFieldVisibility('primary');

  const handleEditStart = (field, currentValue) => {
    setEditingField(field);
    setEditValue(currentValue || '');
  };

  const handleEditSave = (field) => {
    if (field.includes('.')) {
      const [participantIndex, subField] = field.split('.');
      const updatedParticipants = [...participants];
      if (!updatedParticipants[participantIndex].data) {
        updatedParticipants[participantIndex].data = {};
      }
      updatedParticipants[participantIndex].data[subField] = editValue;
      // Update participants in parent
      onEdit(updatedParticipants);
      // Auto-save after a delay
      if (onSave) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
          onSave({ participants: updatedParticipants });
        }, 2000); // 2 second delay
      }
    } else {
      setFormData(prev => ({ ...prev, [field]: editValue }));
      // Auto-save after a delay
      if (onSave) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
          onSave({ formData: { ...formData, [field]: editValue } });
        }, 2000); // 2 second delay
      }
    }
    setEditingField(null);
    setEditValue('');
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleEditCancel = () => {
    setEditingField(null);
    setEditValue('');
  };

  const formatDate = (dateStr) =>
    formatDateOfBirthDisplay(dateStr, 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const EditableField = ({ label, value, field, participantIndex = null }) => {
    const fieldKey = participantIndex !== null ? `${participantIndex}.${field}` : field;
    const isEditing = editingField === fieldKey;

    return (
      <div style={styles.fieldRow} className="public-waiver-review-field">
        <strong style={styles.fieldLabel}>{label}:</strong>
        {isEditing ? (
          <div style={styles.editContainer}>
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              style={styles.editInput}
              autoFocus
            />
            <button
              onClick={() => handleEditSave(fieldKey)}
              style={styles.editButton}
            >
              <FiCheck size={16} />
            </button>
            <button
              onClick={handleEditCancel}
              style={styles.editCancelButton}
            >
              <FiX size={16} />
            </button>
          </div>
        ) : (
          <div style={styles.valueContainer} className="public-waiver-review-value">
            <span style={styles.fieldValue}>{value || 'N/A'}</span>
            <button
              onClick={() => {
                if (participantIndex !== null && onEdit) {
                  onEdit(participantIndex);
                  return;
                }
                handleEditStart(fieldKey, value);
              }}
              style={styles.editIconButton}
              className="public-waiver-review-edit"
            >
              <FiEdit2 size={16} />
            </button>
          </div>
        )}
      </div>
    );
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

  const getParticipantDisplayName = (participant, fallbackLabel) => {
    const firstName = participant?.data?.firstName || participant?.first_name || '';
    const lastName = participant?.data?.lastName || participant?.last_name || '';
    const fullName = `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim();
    return fullName || fallbackLabel;
  };

  const buildParticipantValidationFormData = (participant, fallbackPhoneNumber) => ({
    firstName: participant?.data?.firstName || participant?.first_name || '',
    lastName: participant?.data?.lastName || participant?.last_name || '',
    dateOfBirth: participant?.data?.dateOfBirth || participant?.date_of_birth || '',
    birthYear: '',
    birthMonth: '',
    birthDay: '',
    email: participant?.data?.email || participant?.email || '',
    phoneNumber:
      participant?.data?.phoneNumber ||
      participant?.data?.phone_number ||
      participant?.phone_number ||
      fallbackPhoneNumber ||
      '',
    address: participant?.data?.address || participant?.address || '',
    city: participant?.data?.city || participant?.city || '',
    postalCode: participant?.data?.postalCode || participant?.postal_code || ''
  });

  const handleSubmit = () => {
    const nextValidationErrors = [];
    let minorCounter = 0;
    let additionalAdultCounter = 0;

    (participants || []).forEach((participant, index) => {
      const participantType = participant?.type || participant?.participant_type || 'primary';
      if (participantType === 'minor') {
        minorCounter += 1;
      }
      if (participantType === 'additional_adult') {
        additionalAdultCounter += 1;
      }
      const participantLabel =
        participantType === 'minor'
          ? `Minor ${minorCounter}`
          : participantType === 'additional_adult'
            ? `Additional Adult ${additionalAdultCounter}`
            : 'Primary Adult';

      const { errors, hasErrors } = validateWaiverParticipantData({
        participantType,
        formData: buildParticipantValidationFormData(participant, phoneNumber),
        customerInfo,
        minorAgeThreshold,
        waiverSettings,
        template,
        businessTimezone
      });

      if (hasErrors) {
        nextValidationErrors.push({
          index,
          type: participantType,
          label: getParticipantDisplayName(participant, participantLabel),
          messages: Object.values(errors)
        });
      }
    });

    setValidationErrors(nextValidationErrors);

    if (nextValidationErrors.length > 0) {
      toast.error('Please fix the highlighted waiver information before submitting.');
      return;
    }

    onSubmit?.();
  };

  return (
    <div style={styles.container} className="public-waiver-shell public-waiver-flow">
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
      <div style={styles.content} className="public-waiver-card">
        <h1 style={styles.title} className="public-waiver-title">Review Your Waiver Information</h1>
        <p style={styles.subtitle}>
          Please review all information below. Click the edit icon to make changes.
        </p>

        {validationErrors.length > 0 && (
          <div style={styles.validationBox}>
            <h2 style={styles.validationTitle}>Please review the following:</h2>
            {validationErrors.map((item) => (
              <div key={`${item.label}-${item.index}`} style={styles.validationGroup}>
                <strong style={styles.validationGroupTitle}>{item.label}</strong>
                {item.messages.map((message) => (
                  <div key={`${item.label}-${message}`} style={styles.validationMessage}>
                    {message}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Primary Adult Information */}
        <div style={styles.section} className="public-waiver-section">
          <h2 style={styles.sectionTitle}>Primary Adult</h2>
          <EditableField
            label="First Name"
            value={primaryAdult.data?.firstName || primaryAdult.firstName}
            field="firstName"
            participantIndex={primaryAdultIndex >= 0 ? primaryAdultIndex : null}
          />
          <EditableField
            label="Last Name"
            value={primaryAdult.data?.lastName || primaryAdult.lastName}
            field="lastName"
            participantIndex={primaryAdultIndex >= 0 ? primaryAdultIndex : null}
          />
          <EditableField
            label="Date of Birth"
            value={formatDate(primaryAdult.data?.dateOfBirth || primaryAdult.date_of_birth)}
            field="dateOfBirth"
            participantIndex={primaryAdultIndex >= 0 ? primaryAdultIndex : null}
          />
          {primaryVisibility.showEmailField && (
            <EditableField
              label="Email"
              value={primaryAdult.data?.email || primaryAdult.email}
              field="email"
              participantIndex={primaryAdultIndex >= 0 ? primaryAdultIndex : null}
            />
          )}
          {primaryVisibility.showPhoneField && (
            <EditableField
              label="Phone Number"
              value={primaryAdult.data?.phoneNumber || primaryAdult.data?.phone_number || primaryAdult.phone_number || phoneNumber || 'N/A'}
              field="phoneNumber"
              participantIndex={primaryAdultIndex >= 0 ? primaryAdultIndex : null}
            />
          )}
          {primaryVisibility.showAddressField && (
            <EditableField
              label="Street address"
              value={primaryAdult.data?.address || primaryAdult.address || ''}
              field="address"
              participantIndex={primaryAdultIndex >= 0 ? primaryAdultIndex : null}
            />
          )}
          {primaryVisibility.showCityField && (
            <EditableField
              label="City"
              value={primaryAdult.data?.city || primaryAdult.city || ''}
              field="city"
              participantIndex={primaryAdultIndex >= 0 ? primaryAdultIndex : null}
            />
          )}
          {primaryVisibility.showPostalCodeField && (
            <EditableField
              label="Postal code"
              value={primaryAdult.data?.postalCode || primaryAdult.postal_code || ''}
              field="postalCode"
              participantIndex={primaryAdultIndex >= 0 ? primaryAdultIndex : null}
            />
          )}
        </div>

        {/* Minors */}
        {minors.length > 0 && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Minors</h2>
            {minors.map((minor, index) => {
              const minorIndex = participants.findIndex(p => p === minor);
              return (
                <div key={index} style={styles.participantCard}>
                  <h3 style={styles.participantName}>
                    Minor {index + 1}
                  </h3>
                  <EditableField
                    label="First Name"
                    value={minor.data?.firstName || minor.first_name}
                    field="firstName"
                    participantIndex={minorIndex}
                  />
                  <EditableField
                    label="Last Name"
                    value={minor.data?.lastName || minor.last_name}
                    field="lastName"
                    participantIndex={minorIndex}
                  />
                  <EditableField
                    label="Date of Birth"
                    value={formatDate(minor.data?.dateOfBirth || minor.date_of_birth)}
                    field="dateOfBirth"
                    participantIndex={minorIndex}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Additional Adults */}
        {additionalAdults.length > 0 && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Additional Adults</h2>
            {additionalAdults.map((adult, index) => {
              const adultIndex = participants.findIndex(p => p === adult);
              const additionalAdultVisibility = getReviewFieldVisibility('additional_adult');
              return (
                <div key={index} style={styles.participantCard}>
                  <h3 style={styles.participantName}>
                    Additional Adult {index + 1}
                  </h3>
                  <EditableField
                    label="First Name"
                    value={adult.data?.firstName || adult.first_name}
                    field="firstName"
                    participantIndex={adultIndex}
                  />
                  <EditableField
                    label="Last Name"
                    value={adult.data?.lastName || adult.last_name}
                    field="lastName"
                    participantIndex={adultIndex}
                  />
                  <EditableField
                    label="Date of Birth"
                    value={formatDate(adult.data?.dateOfBirth || adult.date_of_birth)}
                    field="dateOfBirth"
                    participantIndex={adultIndex}
                  />
                  {additionalAdultVisibility.showEmailField && (
                    <EditableField
                      label="Email"
                      value={adult.data?.email || adult.email}
                      field="email"
                      participantIndex={adultIndex}
                    />
                  )}
                  {additionalAdultVisibility.showPhoneField && (
                    <EditableField
                      label="Phone Number"
                      value={adult.data?.phoneNumber || adult.phone_number}
                      field="phoneNumber"
                      participantIndex={adultIndex}
                    />
                  )}
                  {additionalAdultVisibility.showAddressField && (
                    <EditableField
                      label="Street address"
                      value={adult.data?.address || adult.address || ''}
                      field="address"
                      participantIndex={adultIndex}
                    />
                  )}
                  {additionalAdultVisibility.showCityField && (
                    <EditableField
                      label="City"
                      value={adult.data?.city || adult.city || ''}
                      field="city"
                      participantIndex={adultIndex}
                    />
                  )}
                  {additionalAdultVisibility.showPostalCodeField && (
                    <EditableField
                      label="Postal code"
                      value={adult.data?.postalCode || adult.postal_code || ''}
                      field="postalCode"
                      participantIndex={adultIndex}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Submit Button */}
        <div style={styles.buttonContainer} className="public-waiver-actions">
          {onBack && (
            <button
              onClick={onBack}
              style={styles.backButton}
            >
              Back
            </button>
          )}
          {onCancel && (
            <button
              onClick={handleCancelClick}
              style={styles.cancelButton}
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSubmit}
            style={styles.submitButton}
          >
            Submit Waiver
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    padding: '2rem',
    backgroundColor: TavariStyles.colors.background
  },
  content: {
    maxWidth: '800px',
    margin: '0 auto',
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    padding: '2rem',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    boxShadow: `0 0 0 1px ${TavariStyles.colors.gray200}, ${TavariStyles.shadows.xl}`
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: '0.5rem',
    textAlign: 'center'
  },
  subtitle: {
    fontSize: '1rem',
    color: TavariStyles.colors.gray600,
    marginBottom: '2rem',
    textAlign: 'center'
  },
  validationBox: {
    marginBottom: '1.5rem',
    padding: '1rem 1.25rem',
    backgroundColor: '#FEF2F2',
    border: '1px solid #FCA5A5',
    borderRadius: '6px'
  },
  validationTitle: {
    fontSize: '1rem',
    fontWeight: '700',
    color: '#991B1B',
    margin: '0 0 0.75rem 0'
  },
  validationGroup: {
    marginBottom: '0.75rem'
  },
  validationGroupTitle: {
    display: 'block',
    color: '#7F1D1D',
    marginBottom: '0.25rem'
  },
  validationMessage: {
    color: '#991B1B',
    fontSize: '0.9rem',
    lineHeight: 1.4
  },
  section: {
    marginBottom: '2rem',
    padding: '1.5rem',
    backgroundColor: '#F9FAFB',
    borderRadius: '6px',
    border: '1px solid #E5E7EB'
  },
  sectionTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: '1rem',
    borderBottom: '2px solid #E5E7EB',
    paddingBottom: '0.5rem'
  },
  participantCard: {
    marginBottom: '1.5rem',
    padding: '1rem',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '6px',
    border: '1px solid #E5E7EB'
  },
  participantName: {
    fontSize: '1rem',
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: '0.75rem'
  },
  fieldRow: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '0.75rem',
    gap: '1rem',
    flexWrap: 'wrap'
  },
  fieldLabel: {
    minWidth: '120px',
    fontSize: '0.875rem',
    color: TavariStyles.colors.gray600
  },
  valueContainer: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  fieldValue: {
    flex: 1,
    minWidth: 0,
    fontSize: '1rem',
    color: TavariStyles.colors.text,
    wordBreak: 'break-word',
    overflowWrap: 'anywhere'
  },
  editIconButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#008080',
    padding: '0.25rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  editContainer: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  editInput: {
    flex: 1,
    padding: '0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '1rem'
  },
  editButton: {
    background: '#10B981',
    border: 'none',
    color: 'white',
    padding: '0.5rem',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  editCancelButton: {
    background: '#EF4444',
    border: 'none',
    color: 'white',
    padding: '0.5rem',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  cancelButton: {
    background: '#EF4444',
    border: 'none',
    color: 'white',
    padding: '1rem 2rem',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    flex: 1
  },
  buttonContainer: {
    marginTop: '2rem',
    display: 'flex',
    justifyContent: 'center',
    gap: '1rem',
    flexWrap: 'wrap',
    width: '100%'
  },
  backButton: {
    padding: '1rem 2rem',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.text,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '600',
    minWidth: 0,
    flex: 1
  },
  submitButton: {
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    padding: '1rem 2rem',
    fontSize: '1rem',
    fontWeight: '600',
    minWidth: 0,
    flex: 1
  }
};

export default ReviewStep;

