// Existing Waiver View Step - Path 3 Step 4
// Shows existing waiver details, inline full-waiver view (no PDF), signed date, expiry, and customer choices.
import React, { useState, useEffect, useMemo } from 'react';
import { FiFileText, FiCheckCircle, FiCalendar, FiEye, FiArrowRight, FiLayers, FiInfo } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_POST_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import CancelConfirmationModal from './CancelConfirmationModal';
import TimeoutWarningModal from './TimeoutWarningModal';
import WaiverSettingsService from '../../../services/Waivers/WaiverSettingsService';
import waiverPDFService from '../../../services/Waivers/WaiverPDFService';
import { supabase } from '../../../supabaseClient';
import { formatDateOfBirthDisplay } from '../../../utils/waiverDateOfBirth';
import {
  isWaiverAdditionalAdultParticipant,
  isWaiverMinorParticipant
} from '../../../utils/waiverParticipantClassification';
import { isWaiverExpired } from '../../../utils/waiverUtils';

/** Matches Waiver Settings UI default when no row exists yet (see WaiverSettingsScreen). */
const DISPLAY_FALLBACK_EXPIRY_DAYS = 365;

const DetailRow = ({ label, value }) => {
  if (value == null || value === '') return null;
  return (
    <div style={styles.detailRow}>
      <div style={styles.detailLabel}>{label}</div>
      <div style={styles.detailValue}>{value}</div>
    </div>
  );
};

/** Map flow/API shapes to rows PDF/inline preview expect. */
function normalizeParticipantsForDocument(participants) {
  return (participants || []).map((p) => ({
    ...p,
    participant_type: p.participant_type || p.type,
    first_name: p.first_name ?? p.data?.firstName,
    last_name: p.last_name ?? p.data?.lastName,
    date_of_birth: p.date_of_birth ?? p.data?.dateOfBirth,
    email: p.email ?? p.data?.email,
    phone_number: p.phone_number ?? p.data?.phoneNumber
  }));
}

function parsePositiveExpiryDays(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const ExistingWaiverViewStep = ({ 
  waiver, 
  participants = [], 
  waiverHistory = [],
  onSelectWaiverVersion,
  template, 
  onSignNewWaiver,
  onContinue,
  onCancel,
  waiverSettings = {},
  /** 'signer' | 'co_primary' | 'full_view' | 'self_only' — from verified phone match */
  viewerAccessMode = 'signer',
  viewerParticipantId = null,
  suspendInactivityTimer = false
}) => {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [versionLoading, setVersionLoading] = useState(false);
  /** Fallback when parent did not pass usable `default_expiry_days` in waiverSettings */
  const [fetchedGlobalExpiryDays, setFetchedGlobalExpiryDays] = useState(null);
  const [globalExpiryFetchDone, setGlobalExpiryFetchDone] = useState(false);
  const [showInlineWaiver, setShowInlineWaiver] = useState(false);
  const [inlineWaiverHtml, setInlineWaiverHtml] = useState('');
  const [inlineWaiverLoading, setInlineWaiverLoading] = useState(false);

  const { timeRemaining, resetTimer, showWarning, setShowWarning } = useInactivityTimer(
    () => {
      if (onCancel) onCancel({ reason: 'idle_ad' });
    },
    WAIVER_POST_OTP_TIMEOUT_SECONDS,
    null,
    { enabled: !suspendInactivityTimer, warningSeconds: WAIVER_TIMEOUT_WARNING_SECONDS }
  );

  const handleInactivitySessionEnd = () => {
    if (onCancel) onCancel();
  };

  const handleExtendSession = () => {
    resetTimer();
    setShowWarning(false);
  };

  // Load global default expiry when parent value is missing or not a positive number (kiosk is often anon — needs RLS policy)
  useEffect(() => {
    const loadExpiryDays = async () => {
      setGlobalExpiryFetchDone(false);
      setFetchedGlobalExpiryDays(null);
      if (!waiver?.business_id) {
        setGlobalExpiryFetchDone(true);
        return;
      }
      if (parsePositiveExpiryDays(waiverSettings?.default_expiry_days) != null) {
        setGlobalExpiryFetchDone(true);
        return;
      }
      try {
        WaiverSettingsService.setBusinessId(waiver.business_id);
        const settings = await WaiverSettingsService.getGlobalSettings();
        const n = parsePositiveExpiryDays(settings?.default_expiry_days);
        if (n != null) setFetchedGlobalExpiryDays(n);
      } catch (error) {
        console.error('Error loading expiry days:', error);
      } finally {
        setGlobalExpiryFetchDone(true);
      }
    };
    loadExpiryDays();
  }, [waiver?.id, waiver?.business_id, waiverSettings?.default_expiry_days]);

  const effectiveExpiryDays = useMemo(() => {
    const fromSettings = parsePositiveExpiryDays(waiverSettings?.default_expiry_days);
    if (fromSettings) return fromSettings;
    const fromTemplate = parsePositiveExpiryDays(template?.expiry_days);
    if (fromTemplate) return fromTemplate;
    if (fetchedGlobalExpiryDays != null) return fetchedGlobalExpiryDays;
    // No DB/settings row yet, or legacy waiver with null expires_at: align with app default (365)
    if (
      globalExpiryFetchDone &&
      waiver?.signed_at &&
      !waiver?.expires_at
    ) {
      return DISPLAY_FALLBACK_EXPIRY_DAYS;
    }
    return null;
  }, [
    waiverSettings?.default_expiry_days,
    template?.expiry_days,
    fetchedGlobalExpiryDays,
    globalExpiryFetchDone,
    waiver?.signed_at,
    waiver?.expires_at
  ]);

  const handleCancel = () => {
    setShowCancelConfirm(true);
  };

  const handleCancelConfirm = () => {
    setShowCancelConfirm(false);
    if (onCancel) onCancel();
  };

  const handleCancelCancel = () => {
    setShowCancelConfirm(false);
  };

  const getEffectiveExpiryDate = () => {
    if (waiver?.expires_at) return new Date(waiver.expires_at);
    if (waiver?.signed_at && effectiveExpiryDays) {
      const signedDate = new Date(waiver.signed_at);
      return new Date(signedDate.getTime() + effectiveExpiryDays * 24 * 60 * 60 * 1000);
    }
    return null;
  };

  const effectiveExpiryDate = getEffectiveExpiryDate();

  const getDaysUntilExpiry = () => {
    if (!effectiveExpiryDate) return null;
    const now = new Date();
    const diffTime = effectiveExpiryDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  const daysUntilExpiry = getDaysUntilExpiry();
  const isExpired = effectiveExpiryDate != null && effectiveExpiryDate <= new Date();
  const signedDate = waiver?.signed_at ? new Date(waiver.signed_at) : null;

  const entryIsCurrentlyValid = (entry) => {
    if (!entry || entry.is_valid === false) return false;
    if (!entry.expires_at) return true;
    return !isWaiverExpired(entry.expires_at);
  };

  const newestValidWaiverId = useMemo(() => {
    for (const h of waiverHistory) {
      const ok = h.is_valid !== false && (!h.expires_at || !isWaiverExpired(h.expires_at));
      if (ok) return h.id;
    }
    return null;
  }, [waiverHistory]);

  const historyOptionLabel = (entry) => {
    const dateLabel = entry.signed_at
      ? new Date(entry.signed_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        })
      : 'Unknown date';
    if (entry.id === newestValidWaiverId) return `${dateLabel} — Current on file`;
    if (entryIsCurrentlyValid(entry)) return `${dateLabel} — Valid`;
    return `${dateLabel} — Expired or inactive`;
  };

  const handleHistoryChange = async (e) => {
    const id = e.target.value;
    if (!id || id === waiver.id || !onSelectWaiverVersion) return;
    setVersionLoading(true);
    try {
      await onSelectWaiverVersion(id);
    } finally {
      setVersionLoading(false);
    }
  };

  const minorAgeThreshold =
    waiverSettings?.minor_age_threshold ?? template?.minor_age_threshold ?? 18;

  // Get primary adult from waiver
  const primaryAdult = {
    firstName: waiver?.first_name || '',
    lastName: waiver?.last_name || '',
    dateOfBirth: waiver?.date_of_birth || '',
    email: waiver?.email || '',
    phoneNumber: waiver?.phone_number || '',
    address: waiver?.address || '',
    city: waiver?.city || '',
    postalCode: waiver?.postal_code || ''
  };

  const formatPhoneDisplay = (raw) => {
    if (raw == null || raw === '') return '';
    const d = String(raw).replace(/\D/g, '');
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    return String(raw);
  };

  // Same rules as the waiver overview: minors by type or under-threshold DOB; additional adults by type.
  const minors =
    participants?.filter((p) => isWaiverMinorParticipant(p, minorAgeThreshold)) || [];

  const additionalAdults =
    participants?.filter((p) => isWaiverAdditionalAdultParticipant(p)) || [];

  const canSignNewWaiver =
    viewerAccessMode === 'signer' ||
    viewerAccessMode === 'co_primary' ||
    viewerAccessMode === 'full_view' ||
    viewerAccessMode === 'self_only';
  const canViewFullInline = viewerAccessMode !== 'self_only';
  const isSelfOnly = viewerAccessMode === 'self_only';
  const showVersionHistory = waiverHistory.length > 1 && !isSelfOnly;
  const viewerPid = viewerParticipantId != null ? String(viewerParticipantId) : null;
  const selfAdditionalAdults = isSelfOnly
    ? additionalAdults.filter((a) => a.id != null && String(a.id) === viewerPid)
    : additionalAdults;

  const closeInlineWaiver = () => {
    setShowInlineWaiver(false);
    setInlineWaiverHtml('');
  };

  /** Full signed waiver text + participants, shown only inside the app (no PDF / new tab / blob). */
  const handleViewFullWaiver = async () => {
    if (!canViewFullInline) {
      toast.error('Full waiver text is not available for this view.');
      return;
    }
    if (!waiver?.id) {
      toast.error('Waiver not available');
      return;
    }
    setInlineWaiverLoading(true);
    try {
      let consents = [];
      try {
        const { data, error } = await supabase
          .from('waiver_consents')
          .select('*')
          .eq('waiver_id', waiver.id);
        if (!error && data) consents = data;
      } catch {
        consents = [];
      }

      const merged = {
        ...waiver,
        waiver_templates: waiver.waiver_templates || template,
        waiver_participants: normalizeParticipantsForDocument(participants),
        waiver_consents: consents
      };

      const markup = waiverPDFService.getWaiverInlinePreviewMarkup(merged);
      setInlineWaiverHtml(markup);
      setShowInlineWaiver(true);
    } catch (error) {
      console.error('Error building inline waiver view:', error);
      toast.error('Could not load the full waiver. Try again.');
    } finally {
      setInlineWaiverLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  if (!waiver) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>
          <p>Waiver not found</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {showWarning && (
        <TimeoutWarningModal
          onClose={handleInactivitySessionEnd}
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

      <div style={styles.card}>
        <div style={styles.header}>
          <FiFileText size={48} style={styles.icon} />
          <h1 style={styles.title}>
            {isSelfOnly ? 'Your waiver signature on file' : 'Your waiver on file'}
          </h1>
          <p style={styles.headerSubtitle}>
            {isSelfOnly
              ? 'You are listed as an additional adult on this waiver. Other participants’ details are hidden for privacy.'
              : viewerAccessMode === 'full_view'
                ? 'You can review everyone on this waiver. If anything needs to change, please ask the front desk for help.'
                : 'Review what we have for you, then choose your next step.'}
          </p>
        </div>

        <div style={styles.body}>
        <div style={styles.instructionCallout} role="region" aria-label="What to do on this screen">
          <div style={styles.instructionCalloutHeader}>
            <FiInfo size={22} style={styles.instructionIcon} aria-hidden />
            <span style={styles.instructionCalloutTitle}>What to do next</span>
          </div>
          {isSelfOnly ? (
            <ol style={styles.instructionList}>
              <li style={styles.instructionListItem}>
                <strong>Confirm</strong> your own details below match who is visiting today.
              </li>
              <li style={styles.instructionListItem}>
                Tap <strong>Use this waiver today</strong> when you are ready to check in.
              </li>
            </ol>
          ) : viewerAccessMode === 'full_view' ? (
            <ol style={styles.instructionList}>
              <li style={styles.instructionListItem}>
                <strong>Review</strong> the adults and minors listed on this waiver.
              </li>
              <li style={styles.instructionListItem}>
                Tap <strong>Use this waiver today</strong> when you are ready to check in.
              </li>
            </ol>
          ) : (
            <ol style={styles.instructionList}>
              <li style={styles.instructionListItem}>
                <strong>Verify</strong> the adult, children, and any additional adults listed below. Make sure
                names and dates of birth match who is visiting today.
              </li>
              <li style={styles.instructionListItem}>
                If you need to <strong>add a child or another adult</strong>, or change details, tap{' '}
                <strong>Sign new waiver</strong> and complete a fresh waiver.
              </li>
              <li style={styles.instructionListItem}>
                If everything looks <strong>correct</strong>, tap <strong>Use this waiver today</strong> at the
                bottom when you are ready to check in.
              </li>
            </ol>
          )}
          {canViewFullInline && (
            <p style={styles.instructionFootnote}>
              You can open <strong>View full waiver</strong> anytime to read the full text you signed.
            </p>
          )}
        </div>
        {showVersionHistory && (
          <div style={styles.historySection}>
            <h2 style={styles.historySectionTitle}>
              <FiLayers style={styles.historySectionIcon} aria-hidden />
              Waivers on file
            </h2>
            <p style={styles.historyHint}>
              Your newest valid waiver loads first. Pick another date below if you need to review an older signed copy.
            </p>
            <label htmlFor="waiver-version-select" style={styles.fieldLabel}>
              Which waiver do you want to review?
            </label>
            <select
              id="waiver-version-select"
              value={waiver.id}
              onChange={handleHistoryChange}
              disabled={versionLoading}
              style={styles.historySelect}
            >
              {waiverHistory.map((h) => (
                <option key={h.id} value={h.id}>
                  {historyOptionLabel(h)}
                </option>
              ))}
            </select>
            {versionLoading && (
              <p style={styles.historyLoadingText}>Loading that version…</p>
            )}
          </div>
        )}
        {waiverHistory.length === 1 && !isSelfOnly && (
          <div style={styles.historySectionCompact}>
            <p style={styles.historyHint}>
              You have one signed waiver on file for this waiver type.
            </p>
          </div>
        )}

        {/* Waiver Status */}
        <div style={styles.statusSection}>
          {effectiveExpiryDate ? (
            isExpired ? (
              <div style={styles.expiredBadge}>
                <FiCalendar style={styles.badgeIcon} />
                <span>Waiver expired on {formatDate(effectiveExpiryDate.toISOString())}</span>
              </div>
            ) : (
              <div style={styles.expiryBadge}>
                <FiCalendar style={styles.badgeIcon} />
                <span>
                  Expires: {formatDate(effectiveExpiryDate.toISOString())}
                  {daysUntilExpiry !== null && (
                    <span style={styles.expirySubtext}>
                      {' '}({daysUntilExpiry} {daysUntilExpiry === 1 ? 'day' : 'days'} remaining)
                    </span>
                  )}
                </span>
              </div>
            )
          ) : (
            <div style={styles.noExpiryBadge}>
              <FiCheckCircle style={styles.badgeIcon} />
              <span>No expiry date</span>
            </div>
          )}
          {signedDate && (
            <div style={styles.signedDate}>
              <FiCalendar style={styles.dateIcon} />
              <span>Signed: {signedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
          )}
        </div>

        {/* Primary adult — full row for signer / co_primary / full_view; summary only for self_only */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>
            {isSelfOnly ? 'Primary adult on this waiver' : 'Adult Information'}
          </h2>
          {isSelfOnly ? (
            <p style={styles.privacySummary}>
              A primary adult is on file. Their name and contact details are hidden for privacy.
            </p>
          ) : null}
          {!isSelfOnly ? (
          <div style={styles.detailGrid}>
            <DetailRow label="Name" value={`${primaryAdult.firstName} ${primaryAdult.lastName}`.trim()} />
            <DetailRow
              label="Date of birth"
              value={formatDateOfBirthDisplay(primaryAdult.dateOfBirth, 'en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            />
            <DetailRow label="Email" value={primaryAdult.email} />
            <DetailRow label="Phone" value={formatPhoneDisplay(primaryAdult.phoneNumber)} />
            <DetailRow label="Street address" value={primaryAdult.address} />
            <DetailRow label="City" value={primaryAdult.city} />
            <DetailRow label="Postal code" value={primaryAdult.postalCode} />
          </div>
          ) : null}
        </div>

        {/* Minors */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Minors</h2>
          {isSelfOnly ? (
            <p style={styles.privacySummary}>
              {minors.length === 0
                ? 'No minors are listed on this waiver.'
                : `${minors.length} minor${minors.length === 1 ? '' : 's'} on this waiver — names and dates of birth are hidden for your privacy.`}
            </p>
          ) : minors.length > 0 ? (
            minors.map((minor, index) => (
              <div key={index} style={styles.participantCard}>
                <h3 style={styles.participantName}>Minor {index + 1}</h3>
                <div style={styles.detailGrid}>
                  <DetailRow
                    label="Name"
                    value={`${minor.first_name || minor.data?.firstName || ''} ${minor.last_name || minor.data?.lastName || ''}`.trim()}
                  />
                  <DetailRow
                    label="Date of birth"
                    value={formatDate(minor.date_of_birth || minor.data?.dateOfBirth)}
                  />
                </div>
              </div>
            ))
          ) : (
            <p style={styles.noDataMessage}>No minors included in this waiver</p>
          )}
        </div>

        {/* Additional adults (full list, or only “self” row in self_only mode) */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>
            {isSelfOnly ? 'Your information' : 'Additional Adults'}
          </h2>
          {isSelfOnly && selfAdditionalAdults.length === 0 ? (
            <p style={styles.noDataMessage}>
              We could not match your phone to an additional-adult line on this waiver. Please ask the front desk
              for help.
            </p>
          ) : (isSelfOnly ? selfAdditionalAdults : additionalAdults).length > 0 ? (
            (isSelfOnly ? selfAdditionalAdults : additionalAdults).map((adult, index) => (
              <div key={adult.id || index} style={styles.participantCard}>
                <h3 style={styles.participantName}>
                  {isSelfOnly ? 'You (additional adult)' : `Additional Adult ${index + 1}`}
                </h3>
                <div style={styles.detailGrid}>
                  <DetailRow
                    label="Name"
                    value={`${adult.first_name || adult.data?.firstName || ''} ${adult.last_name || adult.data?.lastName || ''}`.trim()}
                  />
                  <DetailRow
                    label="Date of birth"
                    value={formatDateOfBirthDisplay(adult.date_of_birth || adult.data?.dateOfBirth, 'en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  />
                  <DetailRow label="Email" value={adult.email || adult.data?.email || ''} />
                  <DetailRow
                    label="Phone"
                    value={formatPhoneDisplay(adult.phone_number || adult.data?.phoneNumber)}
                  />
                  <DetailRow label="Street address" value={adult.address || adult.data?.address || ''} />
                  <DetailRow label="City" value={adult.city || adult.data?.city || ''} />
                  <DetailRow label="Postal code" value={adult.postal_code || adult.data?.postalCode || ''} />
                </div>
              </div>
            ))
          ) : (
            <p style={styles.noDataMessage}>No additional adults included in this waiver</p>
          )}
        </div>

        {/* View full signed waiver (inline only — no PDF / download on tablet) */}
        {canViewFullInline ? (
        <div style={styles.buttonSection}>
          <button
            type="button"
            onClick={handleViewFullWaiver}
            disabled={inlineWaiverLoading}
            style={{
              ...styles.viewButton,
              ...(inlineWaiverLoading ? { opacity: 0.7, cursor: 'wait' } : {})
            }}
          >
            <FiEye style={styles.buttonIcon} />
            {inlineWaiverLoading ? 'Loading…' : 'View full waiver'}
          </button>
        </div>
        ) : (
          <p style={styles.privacyFootnote}>
            The full signed document is hidden in this view so other participants’ information stays private.
          </p>
        )}

        {/* Fill out a new waiver — primary signer and co-primary additional adults only */}
        {canSignNewWaiver ? (
        <div style={styles.buttonSection}>
          <button
            type="button"
            onClick={onSignNewWaiver}
            style={styles.signNewButton}
          >
            <FiArrowRight style={styles.buttonIcon} />
            Fill out a new waiver
          </button>
        </div>
        ) : null}

        {/* Cancel Button */}
        <div style={styles.buttonSection}>
          <button
            type="button"
            onClick={handleCancel}
            style={styles.cancelButton}
          >
            Start over
          </button>
        </div>

        {typeof onContinue === 'function' && (
          <div style={styles.buttonSection}>
            <button type="button" onClick={onContinue} style={styles.continueButton}>
              Use this waiver today
            </button>
            <p style={styles.continueHint}>Tap when everyone listed above is correct and you are ready to check in.</p>
          </div>
        )}
        </div>
      </div>

      {showInlineWaiver && (
        <div
          style={styles.inlineOverlay}
          onClick={closeInlineWaiver}
          role="presentation"
        >
          <div
            style={styles.inlinePanel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="inline-waiver-title"
          >
            <div style={styles.inlineToolbar}>
              <h2 id="inline-waiver-title" style={styles.inlineTitle}>
                Signed waiver
              </h2>
              <button
                type="button"
                onClick={closeInlineWaiver}
                style={styles.inlineCloseButton}
              >
                Close
              </button>
            </div>
            <div
              style={styles.inlineScroll}
              dangerouslySetInnerHTML={{ __html: inlineWaiverHtml }}
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
    flexDirection: 'column',
    alignItems: 'center',
    padding: '2rem',
    backgroundColor: TavariStyles.colors.background
  },
  card: {
    width: '100%',
    maxWidth: '800px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: '2rem',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    boxShadow: `0 0 0 1px ${TavariStyles.colors.gray200}, ${TavariStyles.shadows.lg}`
  },
  header: {
    textAlign: 'center',
    marginBottom: '1.5rem'
  },
  body: {
    width: '100%'
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
  headerSubtitle: {
    fontSize: '1rem',
    color: TavariStyles.colors.gray600,
    margin: '0 auto',
    maxWidth: '36rem',
    lineHeight: 1.5
  },
  instructionCallout: {
    marginBottom: '1.75rem',
    padding: '1.25rem 1.35rem',
    backgroundColor: '#EFF6FF',
    borderRadius: TavariStyles.borderRadius.md,
    border: '1px solid #BFDBFE',
    textAlign: 'left'
  },
  instructionCalloutHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.75rem'
  },
  instructionIcon: {
    color: TavariStyles.colors.primary,
    flexShrink: 0
  },
  instructionCalloutTitle: {
    fontSize: '1.0625rem',
    fontWeight: '700',
    color: TavariStyles.colors.text
  },
  instructionList: {
    margin: '0 0 0.75rem 0',
    paddingLeft: '1.35rem',
    color: TavariStyles.colors.text,
    fontSize: '0.9375rem',
    lineHeight: 1.55
  },
  instructionListItem: {
    marginBottom: '0.65rem'
  },
  instructionFootnote: {
    margin: 0,
    fontSize: '0.875rem',
    color: TavariStyles.colors.gray600,
    lineHeight: 1.5
  },
  continueButton: {
    padding: '1rem 2rem',
    backgroundColor: '#10B981',
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1.125rem',
    fontWeight: '700',
    cursor: 'pointer',
    width: '100%',
    maxWidth: '400px',
    display: 'block',
    margin: '0 auto'
  },
  continueHint: {
    marginTop: '0.75rem',
    fontSize: '0.875rem',
    color: TavariStyles.colors.gray600,
    textAlign: 'center'
  },
  statusSection: {
    marginBottom: '2rem',
    padding: '1rem',
    backgroundColor: '#F9FAFB',
    borderRadius: TavariStyles.borderRadius.md,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  expiredBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: '#EF4444',
    fontWeight: '600'
  },
  expiryBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: '#F59E0B',
    fontWeight: '600',
    flexWrap: 'wrap'
  },
  expirySubtext: {
    fontWeight: '500',
    color: TavariStyles.colors.gray600
  },
  noExpiryBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: '#10B981',
    fontWeight: '600'
  },
  badgeIcon: {
    fontSize: '1.25rem'
  },
  signedDate: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: TavariStyles.colors.gray600,
    fontSize: '0.875rem'
  },
  dateIcon: {
    fontSize: '1rem'
  },
  historySection: {
    marginBottom: '1.5rem',
    padding: '1.25rem',
    backgroundColor: '#F0F9FF',
    borderRadius: TavariStyles.borderRadius.md,
    border: '1px solid #BAE6FD'
  },
  historySectionTitle: {
    fontSize: '1.125rem',
    fontWeight: 600,
    color: TavariStyles.colors.text,
    marginBottom: '0.5rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  historySectionIcon: {
    flexShrink: 0,
    color: TavariStyles.colors.primary
  },
  historyHint: {
    fontSize: '0.875rem',
    color: TavariStyles.colors.gray600,
    marginBottom: '1rem',
    lineHeight: 1.5
  },
  historySelect: {
    width: '100%',
    maxWidth: '100%',
    padding: '0.75rem',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    backgroundColor: TavariStyles.colors.white,
    marginTop: '0.25rem',
    boxSizing: 'border-box'
  },
  historyLoadingText: {
    fontSize: '0.875rem',
    color: TavariStyles.colors.gray600,
    marginTop: '0.5rem'
  },
  historySectionCompact: {
    marginBottom: '1rem',
    padding: '0.75rem 1rem',
    backgroundColor: '#F9FAFB',
    borderRadius: TavariStyles.borderRadius.md,
    border: '1px solid #E5E7EB'
  },
  section: {
    marginBottom: '2rem',
    padding: '1.5rem',
    backgroundColor: '#F9FAFB',
    borderRadius: TavariStyles.borderRadius.md,
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
  fieldGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '0.85rem'
  },
  detailRow: {
    padding: '0.9rem 1rem',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.md,
    border: '1px solid #E5E7EB'
  },
  detailLabel: {
    fontSize: '0.78rem',
    fontWeight: '700',
    color: TavariStyles.colors.gray600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: '0.35rem'
  },
  detailValue: {
    fontSize: '1.05rem',
    fontWeight: '600',
    color: TavariStyles.colors.text,
    wordBreak: 'break-word'
  },
  fieldRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  fieldLabel: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: TavariStyles.colors.gray600
  },
  input: {
    padding: '0.75rem',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    backgroundColor: TavariStyles.colors.white
  },
  participantCard: {
    marginBottom: '1.5rem',
    padding: '1rem',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.md,
    border: '1px solid #E5E7EB'
  },
  participantName: {
    fontSize: '1rem',
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: '1rem'
  },
  noDataMessage: {
    color: TavariStyles.colors.gray600,
    fontStyle: 'italic',
    textAlign: 'center',
    padding: '1rem'
  },
  privacySummary: {
    color: TavariStyles.colors.gray700,
    fontSize: '0.95rem',
    lineHeight: 1.5,
    margin: 0,
    padding: '0.5rem 0'
  },
  privacyFootnote: {
    color: TavariStyles.colors.gray600,
    fontSize: '0.875rem',
    lineHeight: 1.45,
    textAlign: 'center',
    margin: '0.5rem 0 0 0',
    padding: '0 0.5rem'
  },
  buttonSection: {
    marginTop: '1.5rem',
    display: 'flex',
    justifyContent: 'center'
  },
  viewButton: {
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
    gap: '0.5rem'
  },
  signNewButton: {
    padding: '1rem 2rem',
    backgroundColor: '#10B981',
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    width: '100%',
    justifyContent: 'center'
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
    width: '100%'
  },
  buttonIcon: {
    fontSize: '1.25rem'
  },
  error: {
    textAlign: 'center',
    padding: '2rem',
    color: TavariStyles.colors.error
  },
  inlineOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    zIndex: 10050,
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'center',
    padding: 'max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))',
    boxSizing: 'border-box'
  },
  inlinePanel: {
    width: '100%',
    maxWidth: '720px',
    maxHeight: '100%',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: TavariStyles.shadows?.xl || '0 25px 50px rgba(0,0,0,0.25)',
    border: `1px solid ${TavariStyles.colors.gray300}`
  },
  inlineToolbar: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '14px 16px',
    borderBottom: `1px solid ${TavariStyles.colors.gray300}`,
    backgroundColor: TavariStyles.colors.white
  },
  inlineTitle: {
    margin: 0,
    fontSize: '1.125rem',
    fontWeight: 700,
    color: TavariStyles.colors.textPrimary || '#111'
  },
  inlineCloseButton: {
    padding: '10px 18px',
    fontSize: '1rem',
    fontWeight: 600,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    cursor: 'pointer'
  },
  inlineScroll: {
    flex: 1,
    overflow: 'auto',
    WebkitOverflowScrolling: 'touch',
    backgroundColor: '#fafafa',
    whiteSpace: 'break-spaces',
    wordBreak: 'break-word'
  }
};

export default ExistingWaiverViewStep;
