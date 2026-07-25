import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Clock, LocateFixed, LogOut, MapPin, Pause, Play, RefreshCw, ShieldCheck, Timer } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { getEmployeePortalSelectedBusinessId } from '../../utils/employeeProfileSelection';

const captureFrameFromVideo = (videoEl) => {
  if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth || !videoEl.videoHeight) return null;
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.8);
};

/** Rear / environment camera — run only after front stream is stopped (many phones allow one camera at a time). */
const captureRearEnvironmentPhotoFrame = async () => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  let stream = null;
  const video = document.createElement('video');
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    await new Promise((resolve) => {
      if (video.readyState >= 2) {
        resolve();
        return;
      }
      video.addEventListener('loadeddata', () => resolve(), { once: true });
      setTimeout(() => resolve(), 2500);
    });
    await new Promise((r) => setTimeout(r, 200));
    return captureFrameFromVideo(video);
  } catch (err) {
    console.warn('[PortalClock] rear camera capture failed:', err);
    return null;
  } finally {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    video.srcObject = null;
  }
};

const PortalClock = () => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [notes, setNotes] = useState('');
  const [managerShiftNoteModal, setManagerShiftNoteModal] = useState({ open: false, text: '' });
  const [showClockOutOptions, setShowClockOutOptions] = useState(false);

  const activeClock = status?.activeClock || null;
  const activeBreak = status?.activeBreak || null;
  const isOnBreak = Boolean(activeBreak?.id);
  const shifts = status?.shifts || [];
  const settings = status?.settings || {};
  const shiftsWithStaffNotes = useMemo(
    () => (shifts || []).filter((s) => typeof s.staff_visible_note === 'string' && s.staff_visible_note.trim() !== ''),
    [shifts]
  );

  const showGpsRetryButton = Boolean(locationError) || (Boolean(settings.geofenceEnabled) && !location);
  const gpsActionLabel = locationError ? 'Retry GPS' : 'Get location';

  const workedLabel = useMemo(() => {
    if (!activeClock?.clock_in_time) return null;
    const started = new Date(activeClock.clock_in_time);
    const diffMinutes = Math.max(0, Math.floor((Date.now() - started.getTime()) / 60000));
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }, [activeClock?.clock_in_time]);

  const breakLabel = useMemo(() => {
    if (!activeBreak?.break_start_at) return null;
    const started = new Date(activeBreak.break_start_at);
    const diffMinutes = Math.max(0, Math.floor((Date.now() - started.getTime()) / 60000));
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
  }, [activeBreak?.break_start_at]);

  const portalBusinessPayload = () => {
    const id = getEmployeePortalSelectedBusinessId();
    return id ? { business_id: id } : {};
  };

  const loadStatus = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const { data, error } = await supabase.functions.invoke('employee-time-clock-action', {
        body: { action: 'status', ...portalBusinessPayload() }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStatus(data);
    } catch (error) {
      console.error('[PortalClock] status failed:', error);
      toast.error(error.message || 'Could not load clock status');
    } finally {
      setLoading(false);
    }
  };

  const getLocation = () => {
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('GPS is not available on this device.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        setLocationError(error.message || 'Could not get your GPS location.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };

  useEffect(() => {
    loadStatus();
    getLocation();
    const onProfileChange = () => loadStatus({ silent: true });
    window.addEventListener('employee-profile-selection-changed', onProfileChange);
    return () => window.removeEventListener('employee-profile-selection-changed', onProfileChange);
  }, []);

  const stopCamera = () => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startCamera = async () => {
    setCameraError('');
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('[PortalClock] camera failed:', err);
      setCameraError('Camera access is required for a verification photo. Allow camera in your browser settings.');
    }
  };

  useEffect(() => {
    if (loading) return undefined;
    startCamera();
    return () => stopCamera();
  }, [loading]);

  const handleClockAction = async (action) => {
    if (settings.geofenceEnabled && !location) {
      toast.error('GPS location is required before clocking in or out');
      getLocation();
      return;
    }

    const photoDataUrl = captureFrameFromVideo(videoRef.current);
    if (!photoDataUrl) {
      toast.error(
        cameraError || 'Camera is not ready. Wait for the preview or tap Retry camera, then try again.'
      );
      return;
    }

    setShowClockOutOptions(false);
    setSubmitting(true);
    try {
      let environmentPhotoDataUrl = null;
      const needsEnvironmentPhoto = action === 'clock_in' || action === 'clock_out';
      if (needsEnvironmentPhoto) {
        try {
          stopCamera();
          environmentPhotoDataUrl = await captureRearEnvironmentPhotoFrame();
        } finally {
          await startCamera();
        }

        if (!environmentPhotoDataUrl) {
          toast(
            'Rear camera unavailable — your punch will be saved with the selfie only. Use a phone with a back camera for a workplace photo.',
            { duration: 5000 }
          );
        }
      }

      const { data, error } = await supabase.functions.invoke('employee-time-clock-action', {
        body: {
          action,
          location,
          notes,
          clock_photo_base64: photoDataUrl,
          clock_environment_photo_base64: environmentPhotoDataUrl,
          ...portalBusinessPayload(),
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const apiManagerNote =
        typeof data?.staff_visible_shift_note === 'string' ? data.staff_visible_shift_note.trim() : '';
      const resolvedNote =
        typeof data?.resolved_shift?.staff_visible_note === 'string'
          ? data.resolved_shift.staff_visible_note.trim()
          : '';
      const managerNoteAfterClockIn = apiManagerNote || resolvedNote;

      if (action === 'clock_in' && managerNoteAfterClockIn) {
        setNotes('');
        await loadStatus({ silent: true });
        setManagerShiftNoteModal({ open: true, text: managerNoteAfterClockIn });
      } else {
        const successByAction = {
          clock_in: 'Clocked in successfully',
          clock_out: 'Shift ended successfully',
          break_start: 'Break started — you are still on shift',
          break_end: 'Break ended — welcome back',
        };
        toast.success(successByAction[action] || 'Saved successfully');
        setNotes('');
        await loadStatus({ silent: true });
      }

      const pa = data?.photoAttachment;
      if (pa && !pa.skipped && pa.ok === false) {
        toast.error(
          pa.error ||
            'Your punch was saved, but the verification photo could not be stored. A manager can check Supabase logs for employee-time-clock-action.'
        );
      }

      const envPa = data?.environmentPhotoAttachment;
      if (envPa && !envPa.skipped && envPa.ok === false) {
        toast.error(
          envPa.error ||
            'Your punch was saved, but the workplace photo could not be stored. A manager can check Supabase logs for employee-time-clock-action.'
        );
      }
    } catch (error) {
      console.error('[PortalClock] action failed:', error);
      toast.error(error.message || 'Clock action failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrimaryButtonClick = () => {
    if (!activeClock) {
      handleClockAction('clock_in');
      return;
    }
    setShowClockOutOptions(true);
  };

  const styles = {
    page: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg,
      width: '100%',
      maxWidth: '900px',
      margin: '0 auto',
      minWidth: 0,
      boxSizing: 'border-box',
    },
    hero: {
      background: isOnBreak
        ? 'linear-gradient(135deg, #d97706, #b45309)'
        : activeClock
          ? 'linear-gradient(135deg, #16a34a, #0f766e)'
          : `linear-gradient(135deg, ${TavariStyles.colors.primary}, #0f766e)`,
      color: TavariStyles.colors.white,
      borderRadius: '24px',
      padding: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows?.lg || '0 10px 20px rgba(0,0,0,0.15)',
    },
    eyebrow: {
      opacity: 0.85,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.xs,
    },
    title: {
      margin: 0,
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
    },
    subtitle: {
      marginTop: TavariStyles.spacing.sm,
      opacity: 0.9,
    },
    card: {
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: '18px',
      padding: TavariStyles.spacing.lg,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      minWidth: 0,
      boxSizing: 'border-box',
    },
    row: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap',
    },
    label: {
      display: 'block',
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.xs,
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    select: {
      width: '100%',
      padding: '12px',
      borderRadius: '10px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      fontSize: TavariStyles.typography.fontSize.base,
      boxSizing: 'border-box',
    },
    textarea: {
      width: '100%',
      minHeight: '90px',
      padding: '12px',
      borderRadius: '10px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      fontSize: TavariStyles.typography.fontSize.base,
      boxSizing: 'border-box',
      resize: 'vertical',
    },
    actionButton: {
      width: '100%',
      padding: '16px 18px',
      border: 'none',
      borderRadius: '14px',
      color: TavariStyles.colors.white,
      backgroundColor: !activeClock ? '#16a34a' : isOnBreak ? '#d97706' : '#dc2626',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      fontSize: TavariStyles.typography.fontSize.lg,
      cursor: submitting ? 'not-allowed' : 'pointer',
      opacity: submitting ? 0.7 : 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.sm,
    },
    optionButton: {
      width: '100%',
      padding: '14px 16px',
      border: 'none',
      borderRadius: '12px',
      color: TavariStyles.colors.white,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      fontSize: TavariStyles.typography.fontSize.base,
      cursor: submitting ? 'not-allowed' : 'pointer',
      opacity: submitting ? 0.7 : 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.sm,
    },
    optionButtonBreak: {
      backgroundColor: '#d97706',
    },
    optionButtonEndShift: {
      backgroundColor: '#dc2626',
    },
    optionButtonResume: {
      backgroundColor: '#16a34a',
    },
    optionCancel: {
      width: '100%',
      padding: '12px 16px',
      borderRadius: '12px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: submitting ? 'not-allowed' : 'pointer',
    },
    secondaryButton: {
      padding: '10px 14px',
      borderRadius: '10px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    muted: {
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.sm,
      lineHeight: 1.5,
    },
    statusPill: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '7px 10px',
      borderRadius: '999px',
      backgroundColor: isOnBreak ? '#fef3c7' : activeClock ? '#dcfce7' : TavariStyles.colors.gray100,
      color: isOnBreak ? '#92400e' : activeClock ? '#166534' : TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    loading: {
      textAlign: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray600,
    },
    videoPreview: {
      width: '100%',
      maxWidth: '420px',
      marginTop: TavariStyles.spacing.sm,
      borderRadius: '12px',
      backgroundColor: '#0f172a',
      aspectRatio: '4 / 3',
      objectFit: 'cover',
      display: 'block',
    },
    noteModalOverlay: {
      position: 'fixed',
      inset: 0,
      zIndex: 10050,
      backgroundColor: 'rgba(15, 23, 42, 0.55)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: TavariStyles.spacing.lg,
      boxSizing: 'border-box',
    },
    noteModalCard: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: '16px',
      padding: TavariStyles.spacing.xl,
      maxWidth: '440px',
      width: '100%',
      boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
      boxSizing: 'border-box',
    },
    noteModalTitle: {
      margin: 0,
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
    },
    noteModalBody: {
      marginTop: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray800,
      lineHeight: 1.55,
      whiteSpace: 'pre-wrap',
    },
    noteModalButton: {
      marginTop: TavariStyles.spacing.lg,
      width: '100%',
      padding: '14px 18px',
      border: 'none',
      borderRadius: '12px',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      fontSize: TavariStyles.typography.fontSize.base,
      cursor: 'pointer',
    },
  };

  if (loading) return <div style={styles.loading}>Loading time clock...</div>;

  const dismissManagerShiftNoteModal = () => {
    setManagerShiftNoteModal({ open: false, text: '' });
    toast.success('Clocked in successfully');
  };

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div style={styles.eyebrow}>Employee Time Clock</div>
        <h1 style={styles.title}>
          {isOnBreak ? 'You are on break' : activeClock ? 'You are clocked in' : 'Ready to clock in?'}
        </h1>
        <div style={styles.subtitle}>
          {isOnBreak
            ? `Break started ${formatDateTime(activeBreak.break_start_at)}${breakLabel ? ` • ${breakLabel}` : ''}. End break when you return to work, or end shift if you are leaving.`
            : activeClock
              ? `Started ${formatDateTime(activeClock.clock_in_time)}${workedLabel ? ` • ${workedLabel}` : ''}. Tap Clock Out to start a break or end your shift.`
              : 'Use GPS (if required) and your camera so punches match the in-store punch clock.'}
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.row}>
          <span style={styles.statusPill}>
            <Clock size={16} />
            {isOnBreak ? 'On Break' : activeClock ? 'Clocked In' : 'Clocked Out'}
          </span>
          <button type="button" style={styles.secondaryButton} onClick={() => loadStatus({ silent: true })}>
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.row}>
          <div>
            <div style={{ fontWeight: 700, color: TavariStyles.colors.gray900, marginBottom: '4px' }}>
              GPS Location
            </div>
            <div style={styles.muted}>
              {location
                ? `Captured within about ${Math.round(location.accuracy || 0)}m accuracy.`
                : locationError ||
                  (settings.geofenceEnabled
                    ? 'GPS is required for geofence checks. We try automatically; use the button if needed.'
                    : 'Location is captured automatically when you open this page.')}
            </div>
            {settings.geofenceEnabled && (
              <div style={{ ...styles.muted, marginTop: '6px', color: '#0f766e' }}>
                Geofence required within {settings.geofenceRadiusMeters || 150}m.
              </div>
            )}
          </div>
          {showGpsRetryButton ? (
            <button type="button" style={styles.secondaryButton} onClick={getLocation}>
              <LocateFixed size={15} />
              {gpsActionLabel}
            </button>
          ) : null}
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.row}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                color: TavariStyles.colors.gray900,
                marginBottom: TavariStyles.spacing.sm,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Camera size={18} aria-hidden />
              Verification Photo
            </div>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={styles.videoPreview}
            />
          </div>
          <button type="button" style={styles.secondaryButton} onClick={startCamera}>
            <RefreshCw size={15} />
            Retry camera
          </button>
        </div>
      </div>

      {!activeClock && (
        <div style={styles.card}>
          <label style={styles.label}>Shift matching</label>
          <p style={{ ...styles.muted, marginTop: 0, marginBottom: TavariStyles.spacing.sm }}>
            You do not need to pick a shift. We automatically link your clock-in to the published shift that best
            matches right now (today’s shift, the shift you’re inside, or the closest one). If nothing is published in
            the next few days, your punch is still saved without a shift link.
          </p>
          {shiftsWithStaffNotes.length > 0 ? (
            <div style={{ marginTop: TavariStyles.spacing.sm }}>
              <div
                style={{
                  fontWeight: TavariStyles.typography.fontWeight.bold,
                  color: TavariStyles.colors.gray900,
                  fontSize: TavariStyles.typography.fontSize.sm,
                  marginBottom: TavariStyles.spacing.xs,
                }}
              >
                Manager messages on upcoming shifts
              </div>
              {shiftsWithStaffNotes.map((shift) => (
                <div
                  key={shift.id}
                  style={{
                    marginTop: TavariStyles.spacing.sm,
                    padding: TavariStyles.spacing.md,
                    borderRadius: '12px',
                    border: '1px solid #fcd34d',
                    backgroundColor: '#fffbeb',
                  }}
                >
                  <div style={{ fontWeight: 600, color: '#92400e', fontSize: TavariStyles.typography.fontSize.sm }}>
                    {formatShiftSummary(shift)}
                  </div>
                  <div style={{ ...styles.muted, color: '#78350f', whiteSpace: 'pre-wrap', marginBottom: 0, marginTop: '6px' }}>
                    {shift.staff_visible_note}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <div style={styles.card}>
        <label style={styles.label}>Note for manager (optional)</label>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          style={styles.textarea}
          placeholder={
            isOnBreak
              ? 'Anything your manager should know about this break or clock-out?'
              : activeClock
                ? 'Anything your manager should know about your break or clock-out?'
                : 'Anything your manager should know about this clock-in?'
          }
        />
      </div>

      <button
        type="button"
        style={styles.actionButton}
        disabled={submitting}
        onClick={handlePrimaryButtonClick}
      >
        {!activeClock ? <MapPin size={22} /> : isOnBreak ? <Pause size={22} /> : <Timer size={22} />}
        {submitting ? 'Saving...' : !activeClock ? 'Clock In' : 'Clock Out'}
      </button>

      <div style={styles.card}>
        <div style={styles.row}>
          <ShieldCheck size={22} style={{ color: TavariStyles.colors.primary }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: TavariStyles.colors.gray900 }}>Late and early alerts</div>
            <div style={styles.muted}>
              Late clock-ins and early clock-outs use the shift we matched automatically (or no shift if none was found).
            </div>
          </div>
        </div>
      </div>

      {showClockOutOptions ? (
        <div
          style={styles.noteModalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="portal-clock-out-options-title"
        >
          <div style={styles.noteModalCard}>
            <h2 id="portal-clock-out-options-title" style={styles.noteModalTitle}>
              {isOnBreak ? 'You are on break' : 'What would you like to do?'}
            </h2>
            <p style={{ ...styles.muted, marginTop: TavariStyles.spacing.sm, marginBottom: TavariStyles.spacing.md }}>
              {isOnBreak
                ? 'End your break when you return to work, or end your shift if you are leaving for the day.'
                : 'Start a break to pause work without ending your shift, or end shift when you are done for the day.'}
            </p>
            {isOnBreak ? (
              <button
                type="button"
                style={{ ...styles.optionButton, ...styles.optionButtonResume }}
                disabled={submitting}
                onClick={() => handleClockAction('break_end')}
              >
                <Play size={18} />
                End Break
              </button>
            ) : (
              <button
                type="button"
                style={{ ...styles.optionButton, ...styles.optionButtonBreak }}
                disabled={submitting}
                onClick={() => handleClockAction('break_start')}
              >
                <Pause size={18} />
                Start Break
              </button>
            )}
            <button
              type="button"
              style={{ ...styles.optionButton, ...styles.optionButtonEndShift }}
              disabled={submitting}
              onClick={() => handleClockAction('clock_out')}
            >
              <LogOut size={18} />
              End Shift
            </button>
            <button
              type="button"
              style={styles.optionCancel}
              disabled={submitting}
              onClick={() => setShowClockOutOptions(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {managerShiftNoteModal.open ? (
        <div
          style={styles.noteModalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="portal-manager-shift-note-title"
        >
          <div style={styles.noteModalCard}>
            <h2 id="portal-manager-shift-note-title" style={styles.noteModalTitle}>
              Message from your manager
            </h2>
            <div style={styles.noteModalBody}>{managerShiftNoteModal.text}</div>
            <button type="button" style={styles.noteModalButton} onClick={dismissManagerShiftNoteModal}>
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const formatDateTime = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatTime = (value) => {
  if (!value) return 'TBD';
  const [hours, minutes] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
};

const formatShiftSummary = (shift) => {
  const date = shift.shift_date
    ? new Date(`${shift.shift_date}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'Shift';
  return `${date} • ${formatTime(shift.start_time)} - ${formatTime(shift.end_time)}${shift.position ? ` • ${shift.position}` : ''}`;
};

export default PortalClock;
