import React, { useCallback, useEffect, useState } from 'react';
import { useBookingDetailModal } from '../../contexts/BookingDetailModalContext';
import bookingService from '../../services/Bookings/BookingService';
import waiverSearchService from '../../services/Waivers/WaiverSearchService';
import camperRegistrationService from '../../services/Bookings/CamperRegistrationService';
import {
  getParticipantContactBits,
  getParticipantDisplayName,
  getViewableWaiverSignatureId,
  participantMinorFlags,
  participantTicketLabel,
} from '../../helpers/Bookings/participantIdentity';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiAlertCircle, FiCheck, FiCheckCircle, FiExternalLink, FiMail, FiPhone, FiSearch, FiUser, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import SecurityUtils from '../../Security/SecurityUtils';

function waiverVerifiedForDisplay(requiresWaiver, p) {
  if (!requiresWaiver) return true;
  return p.waiver_status === 'valid' || p.waiver_status === 'not_required';
}

function camperRegistrationVerifiedForDisplay(requiresCamperRegistration, p) {
  if (!requiresCamperRegistration) return true;
  if (!camperRegistrationService.participantRequiresCamperRegistration(p, true)) return true;
  return p.camper_registration_status === 'valid';
}

/**
 * Staff modal: check in participants individually, see waiver status, search & link waivers.
 */
const BookingParticipantCheckInModal = ({
  booking: bookingProp,
  onClose,
  onUpdated,
  canCheckIn = true,
  /** Opens the standard booking detail modal (closes this check-in modal first). */
  showBookingDetailsButton = true,
}) => {
  const { openBookingDetail } = useBookingDetailModal();
  const businessId = bookingProp?.business_id;
  const [booking, setBooking] = useState(bookingProp);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [searchText, setSearchText] = useState({});
  const [searchResults, setSearchResults] = useState({});
  const [viewRegistrationDocId, setViewRegistrationDocId] = useState(null);

  const requiresWaiver =
    Boolean(booking?.booking_activities?.requires_waiver) ||
    Boolean(booking?.booking_types?.requires_waiver);
  const requiresCamperRegistration =
    Boolean(booking?.booking_activities?.requires_camper_registration) ||
    Boolean(booking?.booking_types?.requires_camper_registration);

  const reload = useCallback(async () => {
    if (!bookingProp?.id || !businessId) return;
    bookingService.setBusinessId(businessId);
    const fresh = await bookingService.getBookingByIdWithMailNames(bookingProp.id);
    setBooking(fresh);
    return fresh;
  }, [bookingProp?.id, businessId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        bookingService.setBusinessId(businessId);
        waiverSearchService.setBusinessId(businessId);
        const fresh = await bookingService.getBookingByIdWithMailNames(bookingProp.id);
        if (!cancelled) setBooking(fresh);
      } catch (e) {
        toast.error(e?.message || 'Could not load booking');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingProp?.id, businessId]);

  const participants = booking?.booking_participants || [];
  const checkedCount = participants.filter((p) => p.checked_in_at).length;
  const totalCount = participants.length;

  const notifyParent = async () => {
    const fresh = await reload();
    onUpdated?.(fresh);
    return fresh;
  };

  const getCheckInAuditContext = useCallback(async () => {
    let updatedIp = null;
    try {
      updatedIp = await SecurityUtils.getClientIP();
    } catch {
      updatedIp = null;
    }
    const { data: { user } } = await supabase.auth.getUser();
    return {
      updatedBy: user?.id || null,
      updatedIp: updatedIp || null,
    };
  }, []);

  const handleViewBookingDetails = () => {
    if (!booking?.id) return;
    openBookingDetail(booking.id, { onUpdated: notifyParent });
    onClose?.();
  };

  const handleParticipantToggle = async (p) => {
    if (!canCheckIn) return;
    const id = p.id;
    const isIn = Boolean(p.checked_in_at);
    if (!isIn && !camperRegistrationVerifiedForDisplay(requiresCamperRegistration, p)) {
      toast.error('Annual camper registration must be completed before check-in.');
      return;
    }
    try {
      setBusyKey(`p-${id}`);
      bookingService.setBusinessId(businessId);
      const audit = await getCheckInAuditContext();
      if (isIn) {
        await bookingService.clearParticipantCheckIn(id, booking.id, businessId, audit);
        toast.success('Check-in cleared for participant');
      } else {
        await bookingService.checkInParticipant(id, booking.id, businessId, audit);
        toast.success('Participant checked in');
      }
      await notifyParent();
    } catch (e) {
      toast.error(e?.message || 'Could not update check-in');
    } finally {
      setBusyKey(null);
    }
  };

  const handleCheckInEveryone = async () => {
    if (!canCheckIn) return;
    if (requiresCamperRegistration) {
      const missingRegistration = participants.some(
        (p) => !p.checked_in_at && !camperRegistrationVerifiedForDisplay(requiresCamperRegistration, p)
      );
      if (missingRegistration) {
        toast.error('Some campers still need annual registration before check-in.');
        return;
      }
    }
    try {
      setBusyKey('all');
      bookingService.setBusinessId(businessId);
      const audit = await getCheckInAuditContext();
      await bookingService.checkInBooking(booking.id, businessId, audit);
      toast.success('All participants checked in');
      await notifyParent();
    } catch (e) {
      toast.error(e?.message || 'Could not check in booking');
    } finally {
      setBusyKey(null);
    }
  };

  const handleSearch = async (participantId, raw) => {
    const term = String(raw)
      .replace(/%/g, '')
      .replace(/,/g, ' ')
      .replace(/[()]/g, ' ')
      .trim();
    setSearchText((s) => ({ ...s, [participantId]: raw }));
    if (term.length < 2) {
      setSearchResults((r) => ({ ...r, [participantId]: [] }));
      return;
    }
    try {
      waiverSearchService.setBusinessId(businessId);
      const rows = await waiverSearchService.fuzzySearch(term);
      setSearchResults((r) => ({ ...r, [participantId]: (rows || []).slice(0, 20) }));
    } catch (e) {
      toast.error(e?.message || 'Waiver search failed');
    }
  };

  const handleLinkWaiver = async (participantId, waiverId) => {
    try {
      setBusyKey(`link-${participantId}`);
      bookingService.setBusinessId(businessId);
      await bookingService.linkParticipantWaiver(participantId, booking.id, waiverId, businessId);
      toast.success('Waiver linked to participant');
      setSearchResults((r) => ({ ...r, [participantId]: [] }));
      setSearchText((s) => ({ ...s, [participantId]: '' }));
      await notifyParent();
    } catch (e) {
      toast.error(e?.message || 'Could not link waiver');
    } finally {
      setBusyKey(null);
    }
  };

  const styles = {
    overlay: {
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.45)',
      zIndex: 10050,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    },
    panel: {
      backgroundColor: 'white',
      borderRadius: 12,
      maxWidth: 640,
      width: '100%',
      maxHeight: 'min(90vh, 820px)',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
    },
    header: {
      padding: '16px 20px',
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    title: {
      margin: 0,
      fontSize: 18,
      fontWeight: 700,
      color: TavariStyles.colors.gray900,
    },
    body: {
      padding: 16,
      overflowY: 'auto',
      flex: 1,
    },
    row: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: 10,
      padding: 12,
      marginBottom: 12,
      backgroundColor: TavariStyles.colors.gray50,
    },
    rowTop: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
    },
    waiverSearch: {
      marginTop: 10,
      paddingTop: 10,
      borderTop: `1px dashed ${TavariStyles.colors.gray300}`,
    },
  };

  return (
    <div
      style={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
      role="presentation"
    >
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>Check-in participants</h2>
            <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
              {booking?.booking_activities?.activity_name || 'Booking'}{' '}
              {booking?.booking_number ? `· #${booking.booking_number}` : ''}
            </div>
            {totalCount > 0 && (
              <div style={{ fontSize: 13, color: TavariStyles.colors.primary, marginTop: 6, fontWeight: 600 }}>
                Arrived {checkedCount} / {totalCount}
              </div>
            )}
            {booking?.requires_approval && !booking?.approved_at ? (
              <div style={{ fontSize: 13, color: '#92400e', marginTop: 8, lineHeight: 1.4 }}>
                This booking is still awaiting approval. Checking in guests here does not approve the booking.
              </div>
            ) : null}
            {showBookingDetailsButton && booking?.id ? (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={handleViewBookingDetails}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: `1px solid ${TavariStyles.colors.gray300}`,
                    background: '#fff',
                    color: TavariStyles.colors.gray800,
                    cursor: 'pointer',
                  }}
                >
                  <FiExternalLink size={15} aria-hidden />
                  View booking details
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: 8,
              borderRadius: 8,
            }}
          >
            <FiX size={22} />
          </button>
        </div>

        <div style={styles.body}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: TavariStyles.colors.gray600 }}>Loading…</div>
          ) : totalCount === 0 ? (
            <div>
              <p style={{ fontSize: 14, color: TavariStyles.colors.gray700, marginBottom: 16 }}>
                This booking has no participant rows. You can still mark the whole booking as checked in.
              </p>
              <button
                type="button"
                disabled={!canCheckIn || busyKey === 'legacy'}
                onClick={async () => {
                  try {
                    setBusyKey('legacy');
                    bookingService.setBusinessId(businessId);
                    const audit = await getCheckInAuditContext();
                    await bookingService.checkInBooking(booking.id, businessId, audit);
                    toast.success('Booking checked in');
                    await notifyParent();
                    onClose();
                  } catch (e) {
                    toast.error(e?.message || 'Check-in failed');
                  } finally {
                    setBusyKey(null);
                  }
                }}
                style={{
                  padding: '10px 18px',
                  backgroundColor: TavariStyles.colors.primary,
                  color: 'white',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: canCheckIn ? 'pointer' : 'not-allowed',
                  opacity: canCheckIn ? 1 : 0.6,
                }}
              >
                Check in entire booking
              </button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  disabled={!canCheckIn || busyKey === 'all'}
                  onClick={handleCheckInEveryone}
                  style={{
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: `1px solid ${TavariStyles.colors.primary}`,
                    background: 'white',
                    color: TavariStyles.colors.primary,
                    cursor: canCheckIn ? 'pointer' : 'not-allowed',
                  }}
                >
                  Check in everyone now
                </button>
                <span style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                  Or check in participants one at a time — this window stays open until you click Done.
                </span>
              </div>

              {participants.map((p, idx) => {
                const name = getParticipantDisplayName(p, idx);
                const ticket = participantTicketLabel(p);
                const { email, phone, dateOfBirth } = getParticipantContactBits(p);
                const { showBadge: showMinorBadge } = participantMinorFlags(p);
                const ok = waiverVerifiedForDisplay(requiresWaiver, p);
                const registrationOk = camperRegistrationVerifiedForDisplay(requiresCamperRegistration, p);
                const waiverViewId = getViewableWaiverSignatureId(p);
                const isIn = Boolean(p.checked_in_at);
                const canToggleThisParticipant =
                  canCheckIn && (isIn || registrationOk);
                const searching = searchText[p.id] ?? '';
                const results = searchResults[p.id] || [];

                return (
                  <div key={p.id} style={styles.row}>
                    <div style={styles.rowTop}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 15,
                            color: TavariStyles.colors.gray900,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                          }}
                        >
                          <FiUser size={16} aria-hidden style={{ opacity: 0.55 }} />
                          <span>{name}</span>
                          {showMinorBadge ? (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: '#b45309',
                                background: '#fffbeb',
                                padding: '2px 8px',
                                borderRadius: 6,
                              }}
                            >
                              Minor
                            </span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
                          Ticket: {ticket}
                        </div>
                        {requiresCamperRegistration &&
                        camperRegistrationService.participantRequiresCamperRegistration(p, true) ? (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 13,
                                fontWeight: 600,
                                color: registrationOk ? '#059669' : '#c2410c',
                              }}
                            >
                              {registrationOk ? (
                                <FiCheckCircle size={16} aria-hidden />
                              ) : (
                                <FiAlertCircle size={16} aria-hidden />
                              )}
                              {registrationOk
                                ? 'Annual camper registration complete'
                                : 'Annual camper registration required before check-in'}
                            </div>
                            {p.camper_registration_document_id ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewRegistrationDocId(p.camper_registration_document_id);
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  fontSize: 13,
                                  fontWeight: 600,
                                  border: 'none',
                                  background: 'transparent',
                                  padding: 0,
                                  cursor: 'pointer',
                                  color: TavariStyles.colors.primary,
                                  width: 'fit-content',
                                }}
                              >
                                <FiFileText size={14} aria-hidden />
                                <span style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}>
                                  View registration / print PDF
                                </span>
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {(email || phone) && (
                          <div
                            style={{
                              fontSize: 13,
                              color: TavariStyles.colors.gray700,
                              marginTop: 6,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                            }}
                          >
                            {email ? (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <FiMail size={13} aria-hidden style={{ opacity: 0.6 }} />
                                {email}
                              </span>
                            ) : null}
                            {phone ? (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <FiPhone size={13} aria-hidden style={{ opacity: 0.6 }} />
                                {phone}
                              </span>
                            ) : null}
                            {dateOfBirth ? (
                              <span style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                                DOB: {new Date(dateOfBirth).toLocaleDateString()}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
                          {!requiresWaiver ? (
                            <>
                              <FiCheckCircle size={18} color="#6b7280" aria-hidden />
                              <span style={{ color: '#6b7280' }}>Waiver not required</span>
                            </>
                          ) : waiverViewId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/dashboard/waivers/${waiverViewId}`);
                                onClose?.();
                              }}
                              title="Open signed waiver record"
                              aria-label={
                                ok ? 'View verified waiver in waivers module' : 'View waiver on file'
                              }
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 13,
                                fontWeight: 600,
                                border: 'none',
                                background: 'transparent',
                                padding: '6px 8px',
                                margin: '-6px -8px',
                                borderRadius: 8,
                                cursor: 'pointer',
                                color: ok ? '#059669' : '#c2410c',
                              }}
                            >
                              {ok ? (
                                <FiCheckCircle size={18} color="#059669" aria-hidden />
                              ) : (
                                <FiAlertCircle size={18} color="#c2410c" aria-hidden />
                              )}
                              <span style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}>
                                {ok ? 'Waiver verified' : 'Waiver not verified'}
                              </span>
                              <FiExternalLink size={14} aria-hidden style={{ opacity: 0.75 }} />
                            </button>
                          ) : ok ? (
                            <>
                              <FiCheckCircle size={18} color="#059669" aria-hidden />
                              <span style={{ color: '#059669' }}>Waiver verified</span>
                            </>
                          ) : (
                            <>
                              <FiAlertCircle size={18} color="#c2410c" aria-hidden />
                              <span style={{ color: '#c2410c' }}>Waiver not verified</span>
                            </>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={!canToggleThisParticipant || busyKey === `p-${p.id}`}
                          onClick={() => handleParticipantToggle(p)}
                          style={{
                            padding: '8px 14px',
                            fontSize: 13,
                            fontWeight: 600,
                            borderRadius: 8,
                            border: `1px solid ${isIn ? '#10b981' : TavariStyles.colors.primary}`,
                            background: isIn ? '#10b981' : 'white',
                            color: isIn ? 'white' : TavariStyles.colors.primary,
                            cursor: canToggleThisParticipant ? 'pointer' : 'not-allowed',
                            opacity: canToggleThisParticipant ? 1 : 0.6,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <FiCheck size={14} />
                          {busyKey === `p-${p.id}` ? 'Saving…' : isIn ? 'Undo check-in' : 'Check in'}
                        </button>
                      </div>
                    </div>

                    <div style={styles.waiverSearch}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: TavariStyles.colors.gray700 }}>
                        <FiSearch size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                        Find & link waiver
                      </div>
                      <input
                        type="search"
                        value={searching}
                        placeholder="Name, email, or phone…"
                        onChange={(e) => handleSearch(p.id, e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: `1px solid ${TavariStyles.colors.gray300}`,
                          fontSize: 13,
                          marginBottom: 8,
                          boxSizing: 'border-box',
                        }}
                      />
                      {results.length > 0 && (
                        <div
                          style={{
                            maxHeight: 160,
                            overflowY: 'auto',
                            border: `1px solid ${TavariStyles.colors.gray200}`,
                            borderRadius: 8,
                            background: 'white',
                          }}
                        >
                          {results.map((w) => (
                            <button
                              key={w.id}
                              type="button"
                              disabled={busyKey === `link-${p.id}`}
                              onClick={() => handleLinkWaiver(p.id, w.id)}
                              style={{
                                display: 'block',
                                width: '100%',
                                textAlign: 'left',
                                padding: '8px 10px',
                                fontSize: 13,
                                border: 'none',
                                borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
                                background: 'white',
                                cursor: 'pointer',
                              }}
                            >
                              <strong>
                                {w.first_name} {w.last_name}
                              </strong>
                              <div style={{ color: TavariStyles.colors.gray600 }}>
                                {w.email || '—'} · {w.phone_number || '—'}
                              </div>
                              <div style={{ fontSize: 11, color: TavariStyles.colors.gray500 }}>
                                Signed {w.signed_at ? new Date(w.signed_at).toLocaleString() : '—'} ·{' '}
                                {w.is_valid === false ? 'Invalid' : 'Valid'}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div
          style={{
            padding: '12px 16px',
            borderTop: `1px solid ${TavariStyles.colors.gray200}`,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: `1px solid ${TavariStyles.colors.gray300}`,
              background: 'white',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>

      {viewRegistrationDocId ? (
        <CamperRegistrationDocumentModal
          businessId={businessId}
          documentId={viewRegistrationDocId}
          onClose={() => setViewRegistrationDocId(null)}
        />
      ) : null}
    </div>
  );
};

export default BookingParticipantCheckInModal;
