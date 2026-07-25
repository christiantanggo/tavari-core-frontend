// Step 93: Create WaiverParticipantList.jsx
// Display list of participants in waiver
import React from 'react';
import { FiEdit, FiX, FiUser, FiUserCheck, FiAlertCircle } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import WaiverStatusBadge from './WaiverStatusBadge';
import { resolveWaiverSignatureImgSrc, resolveWaiverSignatureStorageUrl } from '../../utils/waiverSignatureDisplay';

const WaiverParticipantList = ({ participants, onEdit, onRemove, onAddGuardian, canEdit = false, waiver = null }) => {
  const getStatusColor = (participant) => {
    if (participant.signed_at) {
      return TavariStyles.colors.success;
    } else if (participant.is_required) {
      return TavariStyles.colors.error;
    } else {
      return TavariStyles.colors.warning;
    }
  };

  const getStatusIcon = (participant) => {
    if (participant.signed_at) {
      return <FiUserCheck style={{ color: TavariStyles.colors.success }} />;
    } else if (participant.is_required) {
      return <FiAlertCircle style={{ color: TavariStyles.colors.error }} />;
    } else {
      return <FiUser style={{ color: TavariStyles.colors.warning }} />;
    }
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Participants</h3>
      {participants && participants.length > 0 ? (
        <div style={styles.list}>
          {participants.map((participant) => (
            <div key={participant.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <div style={styles.participantInfo}>
                  {getStatusIcon(participant)}
                  <div style={styles.participantDetails}>
                    <h4 style={styles.participantName}>
                      {participant._legacyCountOnly && typeof participant._legacyMinorCount === 'number'
                        ? `${participant._legacyMinorCount} minor${
                            participant._legacyMinorCount === 1 ? '' : 's'
                          } — names/DOB not in legacy file`
                        : [participant.first_name, participant.last_name].filter(Boolean).join(' ').trim() || '—'}
                    </h4>
                    <p style={styles.participantType}>
                      {participant.participant_type === 'guardian' ? 'Guardian' :
                       participant.participant_type === 'additional_adult' ? 'Additional Adult' :
                       participant.participant_type === 'minor' ? 'Minor' : 'Primary'}
                      {participant.relationship_to_minor && ` - ${participant.relationship_to_minor}`}
                      {participant._legacyCountOnly && ' — count only; per-child data was not in the import'}
                      {participant._legacyPlaceholder && ' — legacy import (name not in source export)'}
                      {participant._legacyFromExportJson && ' — from legacy JSON (info/notes)'}
                      {participant._legacyFromWallkidsImport && ' — from Wallkids import (customers/minor_waivers)'}
                    </p>
                    {participant.signed_at && (
                      <p style={styles.signedDate}>
                        Signed: {new Date(participant.signed_at).toLocaleDateString()}
                      </p>
                    )}
                    {(() => {
                      const sigSrc = resolveWaiverSignatureImgSrc(participant);
                      if (!sigSrc) return null;
                      return (
                        <div style={styles.signaturePreview}>
                          <span style={styles.signaturePreviewLabel}>Signature</span>
                          <img
                            src={sigSrc}
                            alt=""
                            style={styles.signaturePreviewImg}
                            onError={(e) => {
                              const url = resolveWaiverSignatureStorageUrl(participant);
                              if (url && e.currentTarget.src !== url) e.currentTarget.src = url;
                            }}
                          />
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div style={styles.actions}>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => onEdit?.(participant)}
                        style={styles.actionButton}
                        title="Edit participant"
                      >
                        <FiEdit />
                      </button>
                      {!participant.is_required && (
                        <button
                          type="button"
                          onClick={() => onRemove?.(participant.id)}
                          style={{ ...styles.actionButton, color: TavariStyles.colors.error }}
                          title="Remove participant"
                        >
                          <FiX />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {participant.participant_type === 'minor' &&
                !participant.guardian_id &&
                !waiver?.signed_at &&
                waiver?._dataSource !== 'legacy' && (
                <div style={styles.guardianWarning}>
                  <FiAlertCircle style={{ color: TavariStyles.colors.warning }} />
                  <span>Guardian signature required</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onAddGuardian?.(participant)}
                      style={styles.addGuardianButton}
                    >
                      Add Guardian
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p style={styles.emptyState}>No participants added yet</p>
      )}
    </div>
  );
};

const styles = {
  container: {
    marginBottom: TavariStyles.spacing.lg
  },
  title: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.md
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },
  card: {
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.md
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start'
  },
  participantInfo: {
    display: 'flex',
    gap: TavariStyles.spacing.sm,
    flex: 1
  },
  participantDetails: {
    flex: 1
  },
  participantName: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.xs
  },
  participantType: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: TavariStyles.spacing.xs
  },
  signedDate: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500,
    margin: 0
  },
  signaturePreview: {
    marginTop: TavariStyles.spacing.sm,
    paddingTop: TavariStyles.spacing.sm,
    borderTop: `1px solid ${TavariStyles.colors.gray200}`
  },
  signaturePreviewLabel: {
    display: 'block',
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.xs,
    fontWeight: 600
  },
  signaturePreviewImg: {
    maxWidth: '220px',
    maxHeight: '80px',
    objectFit: 'contain',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
    backgroundColor: '#fff'
  },
  actions: {
    display: 'flex',
    gap: TavariStyles.spacing.xs
  },
  actionButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: TavariStyles.colors.gray600,
    padding: TavariStyles.spacing.xs,
    display: 'flex',
    alignItems: 'center'
  },
  guardianWarning: {
    marginTop: TavariStyles.spacing.sm,
    padding: TavariStyles.spacing.sm,
    backgroundColor: '#FEF3C7',
    borderRadius: TavariStyles.borderRadius.sm,
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  addGuardianButton: {
    marginLeft: 'auto',
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm
  },
  emptyState: {
    textAlign: 'center',
    color: TavariStyles.colors.gray600,
    padding: TavariStyles.spacing.xl,
    fontStyle: 'italic'
  }
};

export default WaiverParticipantList;




