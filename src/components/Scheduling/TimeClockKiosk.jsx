// src/components/Scheduling/TimeClockKiosk.jsx
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase, supabasePunchClockKiosk } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { sendSchedulingNotification } from '../../helpers/Scheduling/schedulingNotificationService';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { FiPause, FiLogOut, FiPlay, FiClock, FiCheckCircle, FiCalendar, FiX } from 'react-icons/fi';
import SchedulesTab from './SchedulesTab';

dayjs.extend(timezone);
dayjs.extend(utc);
// Helper function to convert data URL to Blob
const dataURLtoBlob = (dataURL) => {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

// Helper function to format time to 12-hour format
const formatTime12Hour = (timeString) => {
  if (!timeString) return '';
  // Parse the time string (could be HH:mm:ss or HH:mm format)
  const parts = timeString.split(':');
  const hours = parseInt(parts[0]);
  const minutes = parts[1] || '00';
  
  if (isNaN(hours)) return timeString;
  
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
  
  return `${displayHours}:${minutes} ${period}`;
};

const uploadTimeClockPhoto = async (photo, fileName) => {
  if (!photo) return null;

  const { data: uploadData, error: uploadError } = await supabasePunchClockKiosk.storage
    .from('time-clock-photos')
    .upload(fileName, dataURLtoBlob(photo), {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (uploadError || !uploadData) {
    console.error('Time clock photo upload failed:', uploadError);
    throw uploadError || new Error('Time clock photo upload failed');
  }

  const { data: { publicUrl } } = supabasePunchClockKiosk.storage
    .from('time-clock-photos')
    .getPublicUrl(fileName);

  return publicUrl;
};

const kioskRpcAuthParams = (sessionToken, kioskPin) => {
  if (sessionToken) return { p_session_token: sessionToken };
  if (kioskPin != null && String(kioskPin).trim() !== '') return { p_pin: String(kioskPin) };
  return null;
};

const attachTimeClockPhoto = async ({ photo, fileName, table, recordId, column, businessId: bid, kioskPin, sessionToken }) => {
  const auth = kioskRpcAuthParams(sessionToken, kioskPin);
  if (!photo || !recordId || !bid || !auth) {
    throw new Error('Missing photo attachment details');
  }

  const photoUrl = await uploadTimeClockPhoto(photo, fileName);
  if (!photoUrl) throw new Error('Could not resolve time clock photo URL');

  if (table === 'scheduling_time_clocks') {
    const { error } = await supabasePunchClockKiosk.rpc('time_clock_kiosk_set_time_clock_photo', {
      p_business_id: bid,
      p_time_clock_id: recordId,
      p_column_name: column,
      p_photo_url: photoUrl,
      ...auth,
    });
    if (error) throw error;
    return photoUrl;
  }

  if (table === 'scheduling_break_tracking') {
    const { error } = await supabasePunchClockKiosk.rpc('time_clock_kiosk_set_break_tracking_photo', {
      p_business_id: bid,
      p_break_id: recordId,
      p_column_name: column,
      p_photo_url: photoUrl,
      ...auth,
    });
    if (error) throw error;
    return photoUrl;
  }

  throw new Error(`Unsupported time clock photo table: ${table}`);
};

/** Fire-and-forget photo save so staff are not blocked on upload latency. */
const attachTimeClockPhotoInBackground = (args) => {
  attachTimeClockPhoto(args).catch((error) => {
    console.error('Time clock photo background save failed:', error);
    toast.error('Punch saved, but the photo could not be stored. Tell a manager.');
  });
};

const KIOSK_LOAD_SESSION_TIMEOUT_MS = 25000;
/** When running parallel with PIN load, do not wait forever for laptop camera warmup. */
const CAMERA_READY_TIMEOUT_MS = 8000;
/** Brief defer after 4th digit so React attaches the stream to `<video>` before we wait. */
const CAMERA_PIN_DEFER_MS = 200;

function getVideoFrameMetrics(videoEl) {
  let w = videoEl.videoWidth;
  let h = videoEl.videoHeight;
  if (w > 0 && h > 0) return { w, h };
  try {
    const track = videoEl.srcObject?.getVideoTracks?.()?.[0];
    const s = track?.getSettings?.() ?? {};
    const tw = s.width || s.frameWidth;
    const th = s.height || s.frameHeight;
    if (tw > 0 && th > 0) return { w: tw, h: th };
  } catch {
    /* ignore */
  }
  return { w, h };
}

function waitNextPaintFrames(count = 2) {
  let chain = Promise.resolve();
  for (let i = 0; i < count; i += 1) {
    chain = chain.then(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => resolve());
        })
    );
  }
  return chain;
}

/** After metadata / playing, wait until a real frame is presented (helps laptop GPUs). */
function waitNextVideoFrame(videoEl) {
  return new Promise((resolve) => {
    if (videoEl && typeof videoEl.requestVideoFrameCallback === 'function') {
      videoEl.requestVideoFrameCallback(() => resolve());
    } else {
      waitNextPaintFrames(2).then(resolve);
    }
  });
}

/**
 * Wait until the preview has decodable dimensions. Uses track.getSettings() when videoWidth stays 0 (Windows drivers).
 */
function waitForVideoReady(videoEl, { timeoutMs = CAMERA_READY_TIMEOUT_MS, pollMs = 80 } = {}) {
  if (!videoEl) return Promise.reject(new Error('no video'));
  const isReady = () => {
    const { w, h } = getVideoFrameMetrics(videoEl);
    return videoEl.readyState >= 2 && w > 0 && h > 0;
  };

  if (isReady()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(iv);
      clearTimeout(to);
      videoEl.removeEventListener('loadeddata', tick);
      videoEl.removeEventListener('loadedmetadata', tick);
      videoEl.removeEventListener('canplay', tick);
      videoEl.removeEventListener('playing', tick);
      videoEl.removeEventListener('resize', tick);
    };
    const tick = () => {
      if (isReady()) {
        cleanup();
        resolve();
      }
    };
    videoEl.addEventListener('loadeddata', tick);
    videoEl.addEventListener('loadedmetadata', tick);
    videoEl.addEventListener('canplay', tick);
    videoEl.addEventListener('playing', tick);
    videoEl.addEventListener('resize', tick);
    const iv = setInterval(tick, pollMs);
    const to = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, timeoutMs);
    tick();
  });
}

async function grabKioskPhotoDataUrl(videoEl) {
  if (!videoEl?.srcObject) return null;

  if (videoEl.paused) {
    const p = videoEl.play?.();
    if (p?.catch) p.catch(() => {});
  }

  try {
    await waitForVideoReady(videoEl);
  } catch {
    /* timed out — still try canvas / ImageCapture (track may be live) */
  }

  try {
    await waitNextVideoFrame(videoEl);
  } catch {
    /* ignore */
  }
  await waitNextPaintFrames(1);

  let w = videoEl.videoWidth;
  let h = videoEl.videoHeight;
  const m = getVideoFrameMetrics(videoEl);
  if (!w || !h) {
    w = m.w;
    h = m.h;
  }

  let fromCanvas = null;
  if (w > 0 && h > 0) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      try {
        ctx.drawImage(videoEl, 0, 0, w, h);
        fromCanvas = canvas.toDataURL('image/jpeg', 0.85);
      } catch {
        fromCanvas = null;
      }
    }
  }

  if (fromCanvas && fromCanvas.length > 500) return fromCanvas;

  const track = videoEl.srcObject?.getVideoTracks?.()?.[0];
  const IC = typeof globalThis !== 'undefined' ? globalThis.ImageCapture : undefined;
  if (track && typeof IC === 'function') {
    try {
      const ic = new IC(track);
      const blob = await ic.takePhoto();
      const fromIc = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
        r.onerror = () => reject(new Error('read'));
        r.readAsDataURL(blob);
      });
      if (fromIc && fromIc.length > 500) return fromIc;
    } catch {
      /* ImageCapture unsupported or takePhoto failed */
    }
  }

  return fromCanvas || null;
}

/** Shown on browser/tablet punch clock so staff can confirm the build after deploy. */
const TIME_CLOCK_KIOSK_DEPLOYMENT_LABEL = 'July 2026 V15 (iPad 7 modern)';

const TimeClockKiosk = ({ businessId, onClose }) => {
  const [currentTime, setCurrentTime] = useState(dayjs());
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [clockStatus, setClockStatus] = useState(null); // 'in' or 'out'
  const [employeeName, setEmployeeName] = useState('');
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [showCamera, setShowCamera] = useState(false);
  const [employeeId, setEmployeeId] = useState(null);
  const [availableShifts, setAvailableShifts] = useState([]);
  const [showShiftSelection, setShowShiftSelection] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showClockInOptions, setShowClockInOptions] = useState(false);
  const [showBreakOptions, setShowBreakOptions] = useState(false);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [selectedShift, setSelectedShift] = useState(null);
  const [employeeData, setEmployeeData] = useState(null);
  const [allowUnscheduled, setAllowUnscheduled] = useState(true);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [successAction, setSuccessAction] = useState(''); // 'clockIn' or 'clockOut'
  const [clockOutComment, setClockOutComment] = useState('');
  const [businessTimeZone, setBusinessTimeZone] = useState('America/Toronto');
  const [viewport, setViewport] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768
  });
  const [showWeekSchedule, setShowWeekSchedule] = useState(false);
  const videoRef = React.useRef(null);
  /** Mirrors `capturedPhoto` for keypad handler (avoids stale closure on 4th digit). */
  const capturedPhotoRef = React.useRef(null);
  const currentPinRef = React.useRef('');
  /** PIN string that successfully resolved the current session (must match server RPCs). */
  const verifiedKioskPinRef = React.useRef('');
  /** Server session token: bcrypt PIN verified once; clock in/out/photos reuse this. */
  const kioskSessionTokenRef = React.useRef('');
  /** Active open clock row from load_session (avoids extra bootstrap RPC on clock out). */
  const activeClockCacheRef = React.useRef(null);
  /** Active open break row from load_session. */
  const activeBreakCacheRef = React.useRef(null);
  /** Bumped on Clear so delayed PIN capture + in-flight PIN loads cannot apply after reset. */
  const flowEpochRef = React.useRef(0);
  /** Invalidates in-flight getUserMedia when restarting or unmounting (avoids orphan streams). */
  const cameraGenRef = React.useRef(0);
  const useLandscapeLayout = viewport.width >= 760 && viewport.width > viewport.height;
  /** Narrow landscape tablets/phones: stack columns so keypad and schedule never overlap */
  const landscapeSingleColumn = useLandscapeLayout && viewport.width < 820;

  useEffect(() => {
    capturedPhotoRef.current = capturedPhoto;
  }, [capturedPhoto]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(dayjs());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const updateViewport = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    return () => {
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
    };
  }, []);

  // Start camera immediately when component mounts
  useEffect(() => {
    startCamera();
    return () => {
      cameraGenRef.current += 1;
      const stream = videoRef.current?.srcObject;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
      }
    };
  }, []);

  const stopCameraTracks = () => {
    const stream = videoRef.current?.srcObject;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    }
  };

  async function capturePhotoInBackground(flowSnapshot) {
    if (capturedPhotoRef.current || !videoRef.current) return;

    try {
      const photo = await grabKioskPhotoDataUrl(videoRef.current);
      if (flowEpochRef.current !== flowSnapshot) return;
      if (photo) {
        capturedPhotoRef.current = photo;
        setCapturedPhoto(photo);
      }
    } catch (error) {
      console.warn('Background kiosk photo capture failed:', error);
    }
  }

  async function handlePinComplete(pinToUse, flowSnapshot) {
    setLoading(true);
    capturePhotoInBackground(flowSnapshot);
    await loadEmployeeAndShifts(pinToUse, flowSnapshot);
  }

  const handleNumberPress = (num) => {
    setPin((prev) => {
      if (prev.length >= 4) return prev;
      const newPin = prev + String(num);
      currentPinRef.current = newPin;
      if (newPin.length === 4) {
        const epochAtPinComplete = flowEpochRef.current;
        setTimeout(() => {
          if (flowEpochRef.current !== epochAtPinComplete) return;
          handlePinComplete(newPin, epochAtPinComplete);
        }, CAMERA_PIN_DEFER_MS);
      }
      return newPin;
    });
  };

  const handleBackspace = () => {
    setPin((prev) => {
      const next = prev.slice(0, -1);
      currentPinRef.current = next;
      return next;
    });
  };

  const getSessionKioskPin = () => {
    const v = verifiedKioskPinRef.current;
    if (v != null && String(v).trim() !== '') return String(v);
    const c = currentPinRef.current;
    if (c != null && String(c).trim() !== '') return String(c);
    return pin != null ? String(pin) : '';
  };

  const handleClear = () => {
    flowEpochRef.current += 1;
    verifiedKioskPinRef.current = '';
    kioskSessionTokenRef.current = '';
    activeClockCacheRef.current = null;
    activeBreakCacheRef.current = null;
    capturedPhotoRef.current = null;
    setLoading(false);
    setPin('');
    currentPinRef.current = '';
    setEmployeeName('');
    setClockStatus(null);
    setCapturedPhoto(null);
    setShowShiftSelection(false);
    setShowConfirmation(false);
    setShowClockInOptions(false);
    setShowBreakOptions(false);
    setIsOnBreak(false);
    setSelectedShift(null);
    setAvailableShifts([]);
    setEmployeeId(null);
    setEmployeeData(null);
    setAllowUnscheduled(true);
    setShowSuccessModal(false);
    setSuccessMessage('');
    setSuccessAction('');
    setClockOutComment('');
    // Restart camera
    startCamera();
  };

  const handleSelectShift = async (shift = null) => {
    // shift is null for "Unscheduled shift"
    setSelectedShift(shift);
    setShowShiftSelection(false);
    setShowConfirmation(true);
  };

  const handleConfirmClockIn = async () => {
    await handleClockInOut(selectedShift);
  };

  const handleCancelConfirm = () => {
    setShowConfirmation(false);
    setSelectedShift(null);
    setShowShiftSelection(true);
  };

  const handleClockOut = async () => {
    console.log('🔄 handleClockOut called');
    console.log('👤 employeeId:', employeeId);
    console.log('🏢 businessId:', businessId);
    
    // Capture photo first
    console.log('📷 Calling capturePhotoOnly...');
    const photo = await capturePhotoOnly();
    console.log('📷 Photo captured:', !!photo);
    
    if (!photo) {
      console.error('❌ No photo captured');
      toast.error('Could not capture photo');
      return;
    }

    console.log('⏳ Setting loading state to true');
    setLoading(true);
    try {
      // PIN flow already resolved this user; anon kiosk cannot SELECT public.users under RLS.
      const employee =
        employeeData && employeeData.id === employeeId
          ? { id: employeeData.id, full_name: employeeData.full_name }
          : null;
      if (!employee?.id) {
        toast.error('Employee not found');
        setLoading(false);
        return;
      }

      const timestamp = dayjs().format('YYYYMMDDHHmmss');
      const photoFileName = `kiosk/${businessId}/${employeeId}_clock_out_${timestamp}.jpg`;
      const sessionToken = kioskSessionTokenRef.current;
      const activeClock = activeClockCacheRef.current;

      if (!activeClock?.id) {
        toast.error('No active clock found');
        setLoading(false);
        return;
      }

      const { error: coutErr } = await supabasePunchClockKiosk.rpc('time_clock_kiosk_clock_out', {
        p_business_id: businessId,
        p_session_token: sessionToken,
        p_clock_out_time: new Date().toISOString(),
      });
      if (coutErr) throw coutErr;

      attachTimeClockPhotoInBackground({
        photo,
        fileName: photoFileName,
        table: 'scheduling_time_clocks',
        recordId: activeClock.id,
        column: 'clock_out_photo_url',
        businessId,
        sessionToken,
      });
      
      toast.success('Clocked out successfully');
      setShowClockInOptions(false);
      setShowBreakOptions(false);
      
      // Show success modal with comment option
      setSuccessMessage('Clocked Out Successfully!');
      setSuccessAction('clockOut');
      setShowSuccessModal(true);
    } catch (error) {
      console.error('Clock out error:', error);
      toast.error('Error clocking out');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitClockOutComment = async () => {
    if (!clockOutComment.trim()) {
      // If no comment, just close and reset
      handleClear();
      return;
    }

    setLoading(true);
    try {
      const { error: noteErr } = await supabasePunchClockKiosk.rpc('time_clock_kiosk_set_notes_latest_clock_out', {
        p_business_id: businessId,
        p_session_token: kioskSessionTokenRef.current,
        p_notes: clockOutComment.trim(),
      });

      if (noteErr) {
        console.error('Error saving comment:', noteErr);
        toast.error('Error saving comment');
        handleClear();
        return;
      }

      toast.success('Comment saved');

      handleClear();
    } catch (error) {
      console.error('Error saving comment:', error);
      toast.error('Error saving comment');
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  const handleBreakTime = async () => {
    console.log('🔄 handleBreakTime called');
    console.log('📸 Current capturedPhoto:', !!capturedPhoto);
    console.log('👤 employeeId:', employeeId);
    console.log('🏢 businessId:', businessId);
    console.log('📹 Video ref exists:', !!videoRef.current);
    console.log('📹 Video readyState:', videoRef.current?.readyState);
    
    // Capture photo first
    console.log('📷 Calling capturePhotoOnly...');
    const photo = await capturePhotoOnly();
    console.log('📷 Photo captured:', !!photo);
    
    if (!photo) {
      console.error('❌ No photo captured');
      toast.error('Could not capture photo');
      return;
    }

    console.log('⏳ Setting loading state to true');
    setLoading(true);
    try {
      const timestamp = dayjs().format('YYYYMMDDHHmmss');
      const photoFileName = `kiosk/${businessId}/${employeeId}_break_start_${timestamp}.jpg`;
      const sessionToken = kioskSessionTokenRef.current;

      const { data: breakId, error: breakError } = await supabasePunchClockKiosk.rpc('time_clock_kiosk_start_break', {
        p_business_id: businessId,
        p_session_token: sessionToken,
        p_notes: 'Break started via kiosk',
      });

      if (breakError) {
        console.error('Break insert error details:', JSON.stringify(breakError, null, 2));
        throw breakError;
      }

      activeBreakCacheRef.current = { id: breakId };

      attachTimeClockPhotoInBackground({
        photo,
        fileName: photoFileName,
        table: 'scheduling_break_tracking',
        recordId: breakId,
        column: 'photo_url_start',
        businessId,
        sessionToken,
      });

      toast.success('Break started');
      setShowClockInOptions(false);
      setShowBreakOptions(false);
      
      // Show success modal
      setSuccessMessage('Break Started Successfully!');
      setSuccessAction('break');
      setShowSuccessModal(true);
      
      // Reset to home screen after 2 seconds
      setTimeout(() => {
        handleClear();
        setShowSuccessModal(false);
      }, 2000);
    } catch (error) {
      console.error('Break start error:', error);
      if (error.code === '42P01') {
        toast.error('Break tracking table not found. Please run the SQL in src/supabase/scheduling_break_tracking.sql');
      } else if (error.code === 'PGRST301' || error.status === 403) {
        toast.error('Permission denied. The break tracking table needs proper RLS policies.');
      } else {
        toast.error('Error starting break: ' + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEndBreak = async () => {
    // Capture photo first
    const photo = await capturePhotoOnly();
    if (!photo) {
      toast.error('Could not capture photo');
      return;
    }

    setLoading(true);
    try {
      const sessionToken = kioskSessionTokenRef.current;
      const breakRecord = activeBreakCacheRef.current;

      if (!breakRecord?.id) {
        toast.error('No active break found');
        return;
      }

      const { error: endErr } = await supabasePunchClockKiosk.rpc('time_clock_kiosk_end_break', {
        p_business_id: businessId,
        p_session_token: sessionToken,
        p_break_id: breakRecord.id,
        p_break_end_at: new Date().toISOString(),
      });
      if (endErr) throw endErr;

      const timestamp = dayjs().format('YYYYMMDDHHmmss');
      const photoFileName = `kiosk/${businessId}/${employeeId}_break_end_${timestamp}.jpg`;

      attachTimeClockPhotoInBackground({
        photo,
        fileName: photoFileName,
        table: 'scheduling_break_tracking',
        recordId: breakRecord.id,
        column: 'photo_url_end',
        businessId,
        sessionToken,
      });

      toast.success('Break ended');
      setShowBreakOptions(false);
      setShowClockInOptions(false);
      
      // Show success modal
      setSuccessMessage('Break Ended Successfully!');
      setSuccessAction('break');
      setShowSuccessModal(true);
      
      // Reset to home screen after 2 seconds
      setTimeout(() => {
        handleClear();
        setShowSuccessModal(false);
      }, 2000);
    } catch (error) {
      console.error('End break error:', error);
      if (error.code === '42P01') {
        toast.error('Break tracking table not found. Please run the SQL in src/supabase/scheduling_break_tracking.sql');
      } else if (error.code === 'PGRST301' || error.status === 403) {
        toast.error('Permission denied. The break tracking table needs proper RLS policies.');
      } else {
        toast.error('Error ending break: ' + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const startCamera = async () => {
    stopCameraTracks();
    const gen = ++cameraGenRef.current;
    try {
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false
        });
      } catch (e1) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch (e2) {
          console.warn('[TimeClockKiosk] getUserMedia facingMode failed, generic video failed:', e1, e2);
          throw e2;
        }
      }
      if (gen !== cameraGenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (videoRef.current) {
        const v = videoRef.current;
        v.srcObject = stream;
        const playAttempt = v.play?.();
        if (playAttempt?.catch) {
          playAttempt.catch(() => {
            /* autoplay policies: ignore */
          });
        }
      }
      setShowCamera(true);
    } catch (error) {
      console.error('Error accessing camera:', error);
      toast.error('Could not access camera. Please check permissions.');
    }
  };

  const capturePhoto = async (pinToUse = null) => {
    const actualPin = pinToUse || pin || currentPinRef.current;

    if (!videoRef.current) {
      toast.error('Camera not ready. Tap Clear and try again.');
      return;
    }

    setLoading(true);
    const flowSnapshot = flowEpochRef.current;
    try {
      const [photoData] = await Promise.all([
        grabKioskPhotoDataUrl(videoRef.current).then((photo) => {
          if (photo) {
            capturedPhotoRef.current = photo;
            setCapturedPhoto(photo);
          }
          return photo;
        }),
        loadEmployeeAndShifts(actualPin, flowSnapshot),
      ]);

      if (flowEpochRef.current !== flowSnapshot) return;

      if (!photoData) {
        toast.error(
          'Could not capture a camera image. Allow the camera, wait until you see the preview, tap Clear, and enter your PIN again.'
        );
        setLoading(false);
      }
    } catch (error) {
      console.error('capturePhoto / PIN flow:', error);
      if (flowEpochRef.current === flowSnapshot) {
        toast.error('Could not complete PIN step. Tap Clear and try again.');
        setLoading(false);
      }
    }
  };

  const capturePhotoOnly = async () => {
    if (!videoRef.current) {
      console.error('❌ capturePhotoOnly: no video element');
      return null;
    }
    const photoData = await grabKioskPhotoDataUrl(videoRef.current);
    if (photoData) {
      capturedPhotoRef.current = photoData;
      setCapturedPhoto(photoData);
    }
    return photoData;
  };

  const loadEmployeeAndShifts = async (pinToUse = null, flowSnapshot = null) => {
    const actualPin = pinToUse != null && pinToUse !== '' ? pinToUse : pin;
    const snap = flowSnapshot ?? flowEpochRef.current;
    const bailIfStale = () => {
      if (flowEpochRef.current !== snap) {
        setLoading(false);
        return true;
      }
      return false;
    };

    try {
      if (bailIfStale()) return;

      const rpcPromise = supabasePunchClockKiosk.rpc('time_clock_kiosk_load_session', {
        p_business_id: businessId,
        p_pin: actualPin,
      });
      let loadTimer = null;
      const timeoutPromise = new Promise((_, reject) => {
        loadTimer = setTimeout(() => reject(new Error('PIN_TIMEOUT')), KIOSK_LOAD_SESSION_TIMEOUT_MS);
      });

      let loadResult;
      try {
        loadResult = await Promise.race([rpcPromise, timeoutPromise]);
      } catch (e) {
        if (e?.message === 'PIN_TIMEOUT') {
          if (bailIfStale()) return;
          toast.error(
            'PIN check timed out (slow connection or many staff). Tap Clear and try again, or ask a manager for help.'
          );
          setLoading(false);
          return;
        }
        throw e;
      } finally {
        if (loadTimer) clearTimeout(loadTimer);
      }

      if (bailIfStale()) return;

      const { data: payload, error: loadError } = loadResult;
      if (loadError) throw loadError;

      if (payload?.error === 'invalid_pin') {
        toast.error('Invalid PIN');
        setLoading(false);
        return;
      }
      if (payload?.error) {
        toast.error('Could not verify PIN. Tap Clear and try again.');
        setLoading(false);
        return;
      }

      const employee = payload?.employee;
      if (!employee?.id) {
        toast.error('Invalid PIN');
        setLoading(false);
        return;
      }

      if (bailIfStale()) return;

      verifiedKioskPinRef.current = String(actualPin);
      kioskSessionTokenRef.current = payload.sessionToken || '';
      activeClockCacheRef.current = payload.activeClock ?? null;
      activeBreakCacheRef.current = payload.activeBreak ?? null;
      setEmployeeId(employee.id);
      setEmployeeData(employee);

      const activeClock = payload.activeClock ?? null;
      const breakFromBoot = payload.activeBreak ?? null;

      if (activeClock) {
        if (bailIfStale()) return;

        if (breakFromBoot) {
          setIsOnBreak(true);
          setShowBreakOptions(true);
        } else {
          setShowClockInOptions(true);
        }

        setLoading(false);
        return;
      }

      if (bailIfStale()) return;

      const timezone = payload.timezone || 'America/Toronto';
      setBusinessTimeZone(timezone);
      setAllowUnscheduled(payload.allowUnscheduled ?? true);

      const empShifts = Array.isArray(payload.shifts) ? payload.shifts : [];

      if (bailIfStale()) return;

      setAvailableShifts(empShifts);
      setShowShiftSelection(true);
      setLoading(false);
    } catch (error) {
      console.error('Error loading employee/shifts:', error);
      if (bailIfStale()) return;
      toast.error('Error loading shifts');
      setLoading(false);
      handleClear();
    }
  };

  const retakePhoto = () => {
    capturedPhotoRef.current = null;
    setCapturedPhoto(null);
    startCamera();
  };

  const handleClockInOut = async (selectedShift = null) => {
    const sessionPin = getSessionKioskPin();
    if (sessionPin.length !== 4) {
      toast.error('Please enter a 4-digit PIN');
      return;
    }

    let photoForAction = capturedPhotoRef.current || capturedPhoto;
    if (!photoForAction) {
      setLoading(true);
      photoForAction = await capturePhotoOnly();
      if (!photoForAction) {
        toast.error('Could not capture photo. Check the camera and try again.');
        startCamera();
        setLoading(false);
        return;
      }
    }

    if (!kioskSessionTokenRef.current) {
      toast.error('Session expired. Tap Clear and enter your PIN again.');
      return;
    }

    setLoading(true);
    try {
      const employee =
        employeeData && employeeData.id === employeeId
          ? { id: employeeData.id, full_name: employeeData.full_name }
          : null;
      if (!employee?.id) {
        toast.error('Employee not found');
        setLoading(false);
        return;
      }

      setEmployeeName(employee.full_name);

      const sessionToken = kioskSessionTokenRef.current;
      const timestamp = dayjs().format('YYYYMMDDHHmmss');
      const photoFileName = `kiosk/${businessId}/${employee.id}_${timestamp}.jpg`;
      const activeClock = activeClockCacheRef.current;

      if (activeClock?.id) {
        const { error: coutErr } = await supabasePunchClockKiosk.rpc('time_clock_kiosk_clock_out', {
          p_business_id: businessId,
          p_session_token: sessionToken,
          p_clock_out_time: new Date().toISOString(),
        });
        if (coutErr) throw coutErr;

        attachTimeClockPhotoInBackground({
          photo: photoForAction,
          fileName: photoFileName,
          table: 'scheduling_time_clocks',
          recordId: activeClock.id,
          column: 'clock_out_photo_url',
          businessId,
          sessionToken,
        });
        
        toast.success('Clocked out successfully');
        setShowShiftSelection(false);
        setShowConfirmation(false);
        
        setSuccessMessage('Clocked Out Successfully!');
        setSuccessAction('clockOut');
        setShowSuccessModal(true);
      } else {
        const clockInTime = new Date();
        const { data: newClockId, error: insertError } = await supabasePunchClockKiosk.rpc('time_clock_kiosk_clock_in', {
          p_business_id: businessId,
          p_session_token: sessionToken,
          p_clock_in_time: clockInTime.toISOString(),
        });
        if (insertError) throw insertError;

        attachTimeClockPhotoInBackground({
          photo: photoForAction,
          fileName: photoFileName,
          table: 'scheduling_time_clocks',
          recordId: newClockId,
          column: 'photo_verification_url',
          businessId,
          sessionToken,
        });
        if (selectedShift?.start_time) {
          const scheduledStart = dayjs.tz(`${selectedShift.shift_date}T${selectedShift.start_time}`, businessTimeZone);
          const minutesLate = dayjs(clockInTime).diff(scheduledStart, 'minute');
          if (minutesLate > 5) {
            await sendSchedulingNotification({
              supabaseClient: supabase,
              businessId,
              eventKey: 'late_clock_in',
              employeeId: employee.id,
              context: {
                employeeName: employee.full_name || employee.name,
                minutesLate,
                shiftId: selectedShift.id,
                scheduledStart: scheduledStart.toISOString(),
                actualClockIn: clockInTime.toISOString()
              }
            });
          }
        }
        
        toast.success('Clocked in successfully');
        setShowShiftSelection(false);
        setShowConfirmation(false);
        
        // Show success modal
        setSuccessMessage('Clocked In Successfully!');
        setSuccessAction('clockIn');
        setShowSuccessModal(true);
        
        // Reset to home screen after 2 seconds
        setTimeout(() => {
          handleClear();
          setShowSuccessModal(false);
        }, 2000);
      }
    } catch (error) {
      console.error('Clock error:', error);
      const detail =
        typeof error?.message === 'string' && error.message.trim()
          ? error.message.trim()
          : null;
      toast.error(detail ? `Clock error: ${detail}` : 'Error processing clock in/out');
    } finally {
      setLoading(false);
    }
  };

  const logoEl = (
    <div style={styles.logoContainer}>
      <img
        src="/tavari-logo.png"
        alt="Tavari"
        style={{ ...styles.logo, ...(useLandscapeLayout ? styles.logoLandscape : {}) }}
      />
    </div>
  );

  const cameraEl = (
    <div style={{ ...styles.cameraContainer, ...(useLandscapeLayout ? styles.cameraContainerLandscape : {}) }}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ ...styles.videoPreview, ...(useLandscapeLayout ? styles.videoPreviewLandscape : {}) }}
      />
      {capturedPhoto && (
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
            fontSize: '13px',
            color: '#10b981',
            fontWeight: '600',
            backgroundColor: 'rgba(255,255,255,0.9)',
            padding: '4px 12px',
            borderRadius: '6px',
            zIndex: 2
          }}
        >
          Photo Ready ✓
        </div>
      )}
    </div>
  );

  const dateTimeEl = (
    <div style={{ ...styles.dateTimeBlock, ...(useLandscapeLayout ? styles.dateTimeBlockLandscape : {}) }}>
      <div style={styles.clock}>{currentTime.format('h:mm A')}</div>
      <div style={styles.date}>{currentTime.format('dddd, MMMM D, YYYY')}</div>
      <button
        type="button"
        onClick={() => setShowWeekSchedule(true)}
        style={styles.weekScheduleButton}
        disabled={
          showShiftSelection ||
          showConfirmation ||
          showClockInOptions ||
          showBreakOptions ||
          showWeekSchedule
        }
        aria-label="View team schedule for the week"
      >
        <FiCalendar style={{ marginRight: '8px', flexShrink: 0 }} />
        Week schedule
      </button>
    </div>
  );

  const employeeBannerEl =
    employeeName ? (
      <div style={{ ...styles.employeeDisplay, ...(useLandscapeLayout ? styles.employeeDisplayGrid : {}) }}>
        {clockStatus && (
          <div style={{ ...styles.statusBadge, backgroundColor: clockStatus === 'in' ? '#10b981' : '#ef4444' }}>
            {clockStatus === 'in' ? 'CLOCKED IN' : 'CLOCKED OUT'}
          </div>
        )}
        <div style={styles.employeeName}>{employeeName}</div>
        {clockStatus && <div style={styles.employeeStatus}>{clockStatus === 'in' ? 'Started working' : 'Finished work'}</div>}
      </div>
    ) : null;

  const pinEl = (
    <div style={{ ...styles.pinContainer, ...(useLandscapeLayout ? styles.pinContainerGrid : {}) }}>
      <div style={styles.pinDisplay}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              ...styles.pinDot,
              backgroundColor: i < pin.length ? '#ffffff' : TavariStyles.colors.primary,
              border: `2px solid #ffffff`
            }}
          />
        ))}
      </div>
    </div>
  );

  const keypadEl = (
    <div style={{ ...styles.keypad, ...(useLandscapeLayout ? styles.keypadGrid : {}) }}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
        <button
          key={num}
          style={{ ...styles.keyButton, ...(useLandscapeLayout ? styles.keyButtonLandscape : {}) }}
          onClick={() => handleNumberPress(num)}
          disabled={
            loading ||
            pin.length >= 4 ||
            showShiftSelection ||
            showConfirmation ||
            showClockInOptions ||
            showBreakOptions ||
            showWeekSchedule
          }
        >
          {num}
        </button>
      ))}
      <div style={{ ...styles.keyButton, ...(useLandscapeLayout ? styles.keyButtonLandscape : {}) }} />
      <button
        style={{ ...styles.keyButton, ...(useLandscapeLayout ? styles.keyButtonLandscape : {}) }}
        onClick={() => handleNumberPress(0)}
        disabled={
          loading ||
          pin.length >= 4 ||
          showShiftSelection ||
          showConfirmation ||
          showClockInOptions ||
          showBreakOptions ||
          showWeekSchedule
        }
      >
        0
      </button>
      <button
        style={{
          ...styles.keyButton,
          ...(useLandscapeLayout ? styles.keyButtonLandscape : {}),
          fontSize: useLandscapeLayout ? 'clamp(20px, 4vh, 28px)' : '24px'
        }}
        onClick={handleBackspace}
        disabled={
          loading ||
          showShiftSelection ||
          showConfirmation ||
          showClockInOptions ||
          showBreakOptions ||
          showWeekSchedule
        }
      >
        ⌫
      </button>
    </div>
  );

  const actionsEl = (
    <div style={{ ...styles.actions, ...(useLandscapeLayout ? styles.actionsGrid : {}) }}>
      <button
        style={styles.clearButton}
        onClick={handleClear}
        disabled={
          loading ||
          showShiftSelection ||
          showConfirmation ||
          showClockInOptions ||
          showBreakOptions ||
          showWeekSchedule
        }
      >
        Clear
      </button>
    </div>
  );

  return (
    <div style={{ ...styles.container, ...(useLandscapeLayout ? styles.containerLandscape : {}) }}>
      <div style={styles.backgroundLayer} aria-hidden />
      <div style={{ ...styles.contentShell, ...(useLandscapeLayout ? styles.contentShellLandscape : {}) }}>
        {useLandscapeLayout ? (
          <div style={{ ...styles.landscapeGrid, ...(landscapeSingleColumn ? styles.landscapeGridStacked : {}) }}>
            <div style={styles.landscapeLeft}>
              {logoEl}
              {cameraEl}
              {dateTimeEl}
              {employeeBannerEl}
            </div>
            <div style={styles.landscapeRight}>
              {pinEl}
              {keypadEl}
              {actionsEl}
            </div>
          </div>
        ) : (
          <>
            <div style={styles.topRow}>
              {logoEl}
              {cameraEl}
              {dateTimeEl}
            </div>
            {employeeBannerEl}
            {pinEl}
            {keypadEl}
            {actionsEl}
          </>
        )}
      </div>

      <div style={styles.kioskDeploymentLabel} aria-hidden="true">
        {TIME_CLOCK_KIOSK_DEPLOYMENT_LABEL}
      </div>

      {loading && (
        <>
          <style>{'@keyframes tavari-kiosk-spin{to{transform:rotate(360deg)}}'}</style>
          <div style={styles.loadingOverlay} role="status" aria-live="polite" aria-busy="true">
            <div style={styles.loadingCard}>
              <div style={styles.loadingSpinner} />
              <p style={styles.loadingTitle}>Working on it…</p>
              <p style={styles.loadingSubtitle}>Verifying PIN and loading your shifts. This may take a few seconds.</p>
            </div>
          </div>
        </>
      )}

      {showWeekSchedule &&
        typeof document !== 'undefined' &&
        createPortal(
          <div style={styles.weekScheduleOverlay} role="dialog" aria-modal="true" aria-labelledby="week-schedule-title">
            <div style={styles.weekScheduleHeader}>
              <h2 id="week-schedule-title" style={styles.weekScheduleTitle}>
                Team schedule
              </h2>
              <button
                type="button"
                onClick={() => setShowWeekSchedule(false)}
                style={styles.weekScheduleClose}
              >
                Close
              </button>
            </div>
            <div style={styles.weekScheduleBody}>
              <SchedulesTab
                businessId={businessId}
                readOnly
                hideEmployeeHoursCap
                useKioskScheduleRpc
                supabaseClient={supabasePunchClockKiosk}
              />
            </div>
          </div>,
          document.body
        )}

      {/* Shift Selection Screen - Modal */}
      {showShiftSelection && !showConfirmation && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeaderWithClose}>
              <h2 style={styles.modalTitleWithClose}>Select Your Shift</h2>
              <button
                type="button"
                onClick={handleClear}
                disabled={loading}
                style={styles.modalCloseButton}
                aria-label="Close and clear PIN"
              >
                <FiX size={26} strokeWidth={2.5} />
              </button>
            </div>

          {availableShifts.length > 0 && (
            <div style={styles.shiftsList}>
              {availableShifts.map((shift) => (
                <button
                  key={shift.id}
                  onClick={() => handleSelectShift(shift)}
                  style={styles.shiftButton}
                  disabled={loading}
                >
                  <div style={styles.shiftInfo}>
                    <div style={styles.shiftTime}>
                      {formatTime12Hour(shift.start_time)} - {formatTime12Hour(shift.end_time)}
                    </div>
                    <div style={styles.shiftRole}>{shift.position || 'No Position'}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {allowUnscheduled && (
            <button
              onClick={() => handleSelectShift(null)}
              style={styles.unscheduledButton}
              disabled={loading}
            >
              {availableShifts.length > 0 ? 'Clock In - Unscheduled' : 'Clock In - Unscheduled'}
            </button>
          )}

          {!allowUnscheduled && availableShifts.length === 0 && (
            <div style={styles.noShiftMessage}>
              No scheduled shifts available. Please contact your manager.
            </div>
          )}
          </div>
        </div>
      )}

      {/* Confirmation Screen - Modal */}
      {showConfirmation && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeaderWithClose}>
              <h2 style={styles.modalTitleWithClose}>Confirm Clock In</h2>
              <button
                type="button"
                onClick={handleClear}
                disabled={loading}
                style={styles.modalCloseButton}
                aria-label="Close and clear PIN"
              >
                <FiX size={26} strokeWidth={2.5} />
              </button>
            </div>

          <div style={styles.confirmationDetails}>
            {selectedShift ? (
              <>
                <div style={styles.confirmationLabel}>Scheduled Shift</div>
                <div style={styles.confirmationValue}>
                  {formatTime12Hour(selectedShift.start_time)} - {formatTime12Hour(selectedShift.end_time)}
                </div>
                <div style={{ ...styles.confirmationValue, fontSize: '16px', color: '#6b7280' }}>
                  {selectedShift.position || 'No Position'}
                </div>
                {selectedShift.notes_visible_to_staff === true &&
                typeof selectedShift.notes === 'string' &&
                selectedShift.notes.trim() !== '' && (
                  <div
                    style={{
                      marginTop: '16px',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      backgroundColor: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e40af', marginBottom: '6px' }}>
                      Message from your manager
                    </div>
                    <div style={{ fontSize: '15px', color: '#1e293b', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {selectedShift.notes.trim()}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={styles.confirmationLabel}>Shift Type</div>
                <div style={styles.confirmationValue}>Unscheduled Shift</div>
              </>
            )}
          </div>

          <div style={styles.confirmationButtons}>
            <button
              onClick={handleCancelConfirm}
              style={styles.cancelConfirmButton}
              disabled={loading}
            >
              Back
            </button>
            <button
              onClick={handleConfirmClockIn}
              style={styles.confirmButton}
              disabled={loading}
            >
              {loading ? 'Processing...' : 'Confirm Clock In'}
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Clock In Options Screen - Modal */}
      {showClockInOptions && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <h2 style={styles.modalTitle}>You're Already Clocked In</h2>
          
          <div style={styles.optionsButtons}>
            <button
              onClick={handleBreakTime}
              style={styles.breakButton}
              disabled={loading}
            >
              <FiPause style={{ marginRight: '8px' }} />
              Break Time
            </button>
            <button
              onClick={handleClockOut}
              style={styles.clockOutButton}
              disabled={loading}
            >
              <FiLogOut style={{ marginRight: '8px' }} />
              Clock Out
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Break Options Screen - Modal */}
      {showBreakOptions && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <h2 style={styles.modalTitle}>You're On Break</h2>
          
          <div style={styles.optionsButtons}>
            <button
              onClick={handleEndBreak}
              style={styles.endBreakButton}
              disabled={loading}
            >
              <FiPlay style={{ marginRight: '8px' }} />
              End Break
            </button>
            <button
              onClick={handleClockOut}
              style={styles.clockOutButton}
              disabled={loading}
            >
              <FiLogOut style={{ marginRight: '8px' }} />
              Clock Out
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {showSuccessModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <h2 style={styles.modalTitle}>{successMessage}</h2>
            <div style={{ textAlign: 'center', fontSize: '48px', marginTop: '20px', color: '#10b981' }}>
              <FiCheckCircle />
            </div>
            
            {successAction === 'clockOut' && (
              <>
                <div style={{ marginTop: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#1f2937' }}>
                    Add a note (optional)
                  </label>
                  <textarea
                    value={clockOutComment}
                    onChange={(e) => setClockOutComment(e.target.value)}
                    placeholder="Enter any notes about your work..."
                    style={{
                      width: '90%',
                      minHeight: '100px',
                      padding: '12px',
                      borderRadius: '8px',
                      border: '2px solid #e5e7eb',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                      resize: 'vertical'
                    }}
                    disabled={loading}
                  />
                </div>
                <div style={styles.modalButtons}>
                  <button
                    style={{ ...styles.confirmButton, flex: 1 }}
                    onClick={handleSubmitClockOutComment}
                    disabled={loading}
                  >
                    {loading ? 'Submitting...' : 'Done'}
                  </button>
                </div>
              </>
            )}
            
            {successAction !== 'clockOut' && (
              <div style={{ marginTop: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                  Returning to home screen...
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    padding: 'clamp(8px, 2vh, 20px)',
    boxSizing: 'border-box',
    zIndex: 9999,
    overflow: 'auto',
    fontFamily: '"Rubrik", sans-serif',
    isolation: 'isolate'
  },
  /** Behind all interactive UI — swap to background-image here without affecting stacking */
  backgroundLayer: {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    backgroundColor: '#0f766e',
    pointerEvents: 'none'
  },
  /** All kiosk chrome sits above backgroundLayer only */
  contentShell: {
    position: 'relative',
    zIndex: 1,
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    minHeight: 0,
    overflow: 'auto',
    WebkitOverflowScrolling: 'touch'
  },
  contentShellLandscape: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 'clamp(6px, 1.5vh, 14px)'
  },
  kioskDeploymentLabel: {
    position: 'fixed',
    bottom: 'max(10px, env(safe-area-inset-bottom, 0px))',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 5,
    fontSize: 'clamp(10px, 1.8vw, 12px)',
    fontWeight: '600',
    letterSpacing: '0.06em',
    color: 'rgba(255,255,255,0.9)',
    textShadow: '0 1px 3px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    userSelect: 'none'
  },
  landscapeGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: 'clamp(12px, 3vw, 36px)',
    width: '100%',
    maxWidth: 'min(1400px, 100%)',
    alignItems: 'start',
    boxSizing: 'border-box',
    flex: '1 1 auto',
    minHeight: 0,
    margin: '0 auto'
  },
  landscapeGridStacked: {
    gridTemplateColumns: 'minmax(0, 1fr)',
    maxWidth: 'min(560px, 100%)'
  },
  landscapeLeft: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 'clamp(8px, 2vh, 18px)',
    minWidth: 0,
    width: '100%'
  },
  landscapeRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'clamp(6px, 1.5vh, 14px)',
    minWidth: 0,
    width: '100%'
  },
  containerLandscape: {
    overflow: 'hidden',
    padding: 'clamp(12px, 3vh, 28px)'
  },
  closeButton: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    fontSize: '48px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#6b7280',
    cursor: 'pointer',
    width: '60px',
    height: '60px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    transition: 'all 0.2s'
  },
  topRow: {
    width: '100%',
    maxWidth: '1200px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'clamp(8px, 2vw, 16px)',
    marginBottom: 'clamp(8px, 2vh, 20px)',
    padding: '0 clamp(6px, 2vw, 20px)',
    boxSizing: 'border-box',
    flexWrap: 'wrap'
  },
  logoContainer: {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start'
  },
  dateTimeBlock: {
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    color: '#f0fdfa',
    textAlign: 'right',
    gap: '4px',
    minWidth: '130px'
  },
  dateTimeBlockLandscape: {
    alignItems: 'center',
    textAlign: 'center',
    minWidth: 0
  },
  title: {
    fontSize: '33px',
    fontWeight: '700',
    color: '#f0fdfa',
    margin: '0 0 10px 0'
  },
  clock: {
    fontSize: 'clamp(24px, 4vw, 36px)',
    fontWeight: '600',
    color: '#a7f3d0',
    fontFamily: 'monospace',
    marginBottom: '4px'
  },
  date: {
    fontSize: 'clamp(11px, 1.6vw, 14px)',
    color: '#d1fae5'
  },
  weekScheduleButton: {
    marginTop: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px 16px',
    fontSize: 'clamp(13px, 2vw, 16px)',
    fontWeight: '600',
    color: '#0f766e',
    backgroundColor: '#ecfdf5',
    border: '2px solid #99f6e4',
    borderRadius: '10px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
    width: '100%',
    maxWidth: '280px'
  },
  weekScheduleOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 10050,
    backgroundColor: '#f8f9fa',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  weekScheduleHeader: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '12px 16px',
    backgroundColor: '#0f766e',
    color: '#ecfdf5',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
  },
  weekScheduleTitle: {
    margin: 0,
    fontSize: 'clamp(18px, 3vw, 22px)',
    fontWeight: '700'
  },
  weekScheduleClose: {
    padding: '10px 20px',
    fontSize: '16px',
    fontWeight: '600',
    color: '#0f766e',
    backgroundColor: '#ecfdf5',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  weekScheduleBody: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    WebkitOverflowScrolling: 'touch',
    padding: '8px'
  },
  employeeDisplay: {
    textAlign: 'center',
    marginBottom: '20px',
    padding: '16px',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(15,118,110,0.35)',
    minWidth: '300px',
    color: '#f0fdfa'
  },
  employeeDisplayGrid: {
    marginTop: 'clamp(4px, 1vh, 12px)',
    marginBottom: 0,
    width: '100%',
    maxWidth: '420px',
    alignSelf: 'stretch'
  },
  statusBadge: {
    display: 'inline-block',
    padding: '8px 24px',
    borderRadius: '20px',
    color: 'white',
    fontWeight: '700',
    fontSize: '16px',
    marginBottom: '12px'
  },
  employeeName: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '6px'
  },
  employeeStatus: {
    fontSize: '14px',
    color: '#6b7280'
  },
  pinContainer: {
    marginTop: 'clamp(4px, 1.2vh, 12px)',
    marginBottom: 'clamp(4px, 1.2vh, 12px)',
    textAlign: 'center'
  },
  pinContainerGrid: {
    marginTop: 0,
    marginBottom: 0,
    width: '100%',
    textAlign: 'center'
  },
  pinDisplay: {
    display: 'flex',
    gap: 'clamp(10px, 2vw, 20px)',
    justifyContent: 'center',
    marginBottom: 'clamp(8px, 2vh, 20px)'
  },
  pinDot: {
    width: 'clamp(16px, 3vh, 26px)',
    height: 'clamp(16px, 3vh, 26px)',
    borderRadius: '50%',
    transition: 'all 0.2s'
  },
  submitButton: {
    padding: '12px 36px',
    fontSize: '16px',
    fontWeight: '600',
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  keypad: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 'clamp(8px, 1.8vh, 16px)',
    width: 'min(100%, 520px)',
    maxWidth: 'calc(100vw - 24px)',
    marginBottom: 'clamp(8px, 1.8vh, 16px)'
  },
  keypadGrid: {
    width: '100%',
    maxWidth: 'min(520px, 100%)',
    marginBottom: 0,
    gap: 'clamp(8px, 1.8vh, 16px)'
  },
  keyButton: {
    height: 'clamp(48px, 8vh, 70px)',
    minHeight: 0,
    fontSize: 'clamp(22px, 4vh, 32px)',
    fontWeight: '700',
    color: '#ffffff',
    backgroundColor: 'rgba(255,255,255,0.1)',
    border: '2px solid rgba(255,255,255,0.3)',
    borderRadius: 'clamp(10px, 2vh, 16px)',
    cursor: 'pointer',
    transition: 'all 0.15s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  keyButtonLandscape: {
    height: 'clamp(50px, 12vh, 86px)',
    fontSize: 'clamp(24px, 5vh, 38px)'
  },
  actions: {
    display: 'flex',
    gap: 'clamp(10px, 2vw, 20px)',
    justifyContent: 'center',
    marginBottom: 'clamp(6px, 1.5vh, 14px)'
  },
  actionsGrid: {
    marginBottom: 0,
    width: '100%'
  },
  clearButton: {
    padding: 'clamp(10px, 2vh, 14px) clamp(28px, 6vw, 40px)',
    fontSize: 'clamp(14px, 2vh, 16px)',
    fontWeight: '600',
    backgroundColor: 'rgba(239, 68, 68, 0.85)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  photoSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    position: 'relative'
  },
  logo: {
    width: 'clamp(110px, 18vw, 180px)',
    opacity: 0.95
  },
  logoLandscape: {
    width: 'clamp(110px, 16vw, 190px)'
  },
  cameraButton: {
    padding: '12px 36px',
    fontSize: '18px',
    fontWeight: '600',
    backgroundColor: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  cameraContainer: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '1 1 220px',
    minWidth: '160px'
  },
  cameraContainerLandscape: {
    flex: '0 1 auto',
    width: '100%',
    minWidth: 0
  },
  videoPreview: {
    width: 'clamp(160px, 24vw, 270px)',
    height: 'clamp(120px, 18vw, 203px)',
    maxHeight: '28vh',
    objectFit: 'cover',
    borderRadius: '12px',
    border: '2px solid rgba(255,255,255,0.4)',
    backgroundColor: '#000'
  },
  videoPreviewLandscape: {
    width: 'min(100%, 48vh, 420px)',
    height: 'min(34vh, 315px)',
    maxHeight: '34vh'
  },
  captureButton: {
    padding: '12px 36px',
    fontSize: '16px',
    fontWeight: '600',
    backgroundColor: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  photoPreview: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px'
  },
  capturedImage: {
    width: '300px',
    maxWidth: '90vw',
    borderRadius: '12px',
    border: '2px solid #10b981'
  },
  retakeButton: {
    padding: '10px 30px',
    fontSize: '14px',
    fontWeight: '600',
    backgroundColor: '#6b7280',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  shiftSelectionContainer: {
    padding: '20px',
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    minWidth: '300px',
    maxWidth: '400px',
    marginBottom: '20px'
  },
  shiftSelectionTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '20px',
    textAlign: 'center'
  },
  shiftsList: {
    marginBottom: '20px'
  },
  shiftButton: {
    width: '100%',
    padding: '16px',
    marginBottom: '12px',
    backgroundColor: '#f9fafb',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'left'
  },
  shiftInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  shiftTime: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1f2937'
  },
  shiftRole: {
    fontSize: '14px',
    color: '#6b7280'
  },
  unscheduledButton: {
    width: '100%',
    padding: '16px',
    fontSize: '16px',
    fontWeight: '600',
    backgroundColor: '#6b7280',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  noShiftMessage: {
    textAlign: 'center',
    color: '#ef4444',
    fontSize: '14px',
    padding: '20px'
  },
  confirmationContainer: {
    padding: '20px',
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    minWidth: '300px',
    maxWidth: '400px',
    marginBottom: '20px'
  },
  confirmationTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '20px',
    textAlign: 'center'
  },
  confirmationDetails: {
    backgroundColor: '#f9fafb',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '20px',
    textAlign: 'center'
  },
  confirmationLabel: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '8px',
    fontWeight: '600'
  },
  confirmationValue: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: '4px'
  },
  confirmationButtons: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center'
  },
  confirmButton: {
    flex: 1,
    padding: '16px',
    fontSize: '18px',
    fontWeight: '600',
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  cancelConfirmButton: {
    flex: 1,
    padding: '16px',
    fontSize: '18px',
    fontWeight: '600',
    backgroundColor: '#6b7280',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  clockInOptionsContainer: {
    padding: '20px',
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    minWidth: '300px',
    maxWidth: '400px',
    marginBottom: '20px'
  },
  clockInOptionsTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '30px',
    textAlign: 'center'
  },
  breakOptionsContainer: {
    padding: '20px',
    backgroundColor: '#fef3c7',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    border: '2px solid #fbbf24',
    minWidth: '300px',
    maxWidth: '400px',
    marginBottom: '20px'
  },
  breakOptionsTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#92400e',
    marginBottom: '30px',
    textAlign: 'center'
  },
  optionsButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px'
  },
  breakButton: {
    width: '100%',
    padding: '20px',
    fontSize: '20px',
    fontWeight: '600',
    backgroundColor: '#fbbf24',
    color: '#92400e',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  endBreakButton: {
    width: '100%',
    padding: '20px',
    fontSize: '20px',
    fontWeight: '600',
    backgroundColor: '#fbbf24',
    color: '#92400e',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  clockOutButton: {
    width: '100%',
    padding: '20px',
    fontSize: '20px',
    fontWeight: '600',
    backgroundColor: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  // Modal overlay styles
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
    zIndex: 10000,
    padding: '20px'
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '20px',
    minWidth: '300px',
    maxWidth: '400px',
    width: '100%',
    maxHeight: '90vh',
    overflowY: 'auto',
    boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
  },
  modalHeaderWithClose: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '10px',
    marginBottom: '16px'
  },
  modalTitleWithClose: {
    flex: 1,
    margin: 0,
    paddingTop: '4px',
    fontSize: '20px',
    fontWeight: '600',
    color: '#1f2937',
    textAlign: 'center',
    lineHeight: 1.25
  },
  modalCloseButton: {
    flexShrink: 0,
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '10px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    cursor: 'pointer',
    transition: 'background-color 0.15s'
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '20px',
    textAlign: 'center'
  },
  modalButtons: {
    display: 'flex',
    gap: '12px',
    marginTop: '20px'
  },
  photoReadyBadge: {
    position: 'absolute',
    bottom: '60px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    padding: '8px 12px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    zIndex: 10,
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
  },
  loadingOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 10040,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    boxSizing: 'border-box',
  },
  loadingCard: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '28px 32px',
    maxWidth: '420px',
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
  },
  loadingSpinner: {
    width: '44px',
    height: '44px',
    margin: '0 auto 16px',
    borderRadius: '50%',
    border: '4px solid #e5e7eb',
    borderTopColor: TavariStyles.colors.primary,
    animation: 'tavari-kiosk-spin 0.85s linear infinite',
  },
  loadingTitle: {
    margin: '0 0 8px',
    fontSize: '18px',
    fontWeight: '700',
    color: '#111827',
  },
  loadingSubtitle: {
    margin: 0,
    fontSize: '14px',
    lineHeight: 1.5,
    color: '#6b7280',
  }
};

export default TimeClockKiosk;
