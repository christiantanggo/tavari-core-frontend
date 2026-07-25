(function () {
  'use strict';

  var cfg = window.__TAVARI_LEGACY_PUNCHCLOCK__ || {};
  var SUPABASE_URL = String(cfg.supabaseUrl || '').replace(/\/$/, '');
  var ANON_KEY = String(cfg.anonKey || '');
  var DEFAULT_BUSINESS_ID = String(cfg.businessId || 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc');
  var businessId = getQuery('business') || getQuery('businessId') || DEFAULT_BUSINESS_ID;
  var PHOTO_BUCKET = 'time-clock-photos';
  var REQUEST_TIMEOUT_MS = 22000;
  var PHOTO_TIMEOUT_MS = 45000;
  var RESET_SUCCESS_MS = 2200;

  var state = {
    pin: '',
    loading: false,
    employee: null,
    employeeName: '',
    sessionToken: '',
    activeClock: null,
    activeBreak: null,
    shifts: [],
    allowUnscheduled: true,
    timezone: 'America/Toronto',
    selectedShift: null,
    photoDataUrl: null,
    currentSuccessAction: '',
    watchdog: null,
    cameraStream: null,
    cameraStarting: false,
    latestFrame: null,
    frameTimer: null,
    pendingPhotoCallback: null,
    lastCameraError: '',
    captureArmedAt: 0
  };

  var el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function init() {
    el.toast = $('toast');
    el.loading = $('loading');
    el.loadingText = $('loadingText');
    el.video = $('video');
    el.photoInput = $('photoInput');
    el.photoPreview = $('photoPreview');
    el.cameraNote = $('cameraNote');
    el.time = $('time');
    el.date = $('date');
    el.keypad = $('keypad');
    el.clearBtn = $('clearBtn');
    el.employee = $('employee');
    el.employeeName = $('employeeName');
    el.employeeStatus = $('employeeStatus');
    el.shiftPanel = $('shiftPanel');
    el.shiftList = $('shiftList');
    el.confirmPanel = $('confirmPanel');
    el.confirmDetails = $('confirmDetails');
    el.optionsPanel = $('optionsPanel');
    el.optionsTitle = $('optionsTitle');
    el.optionsButtons = $('optionsButtons');
    el.successPanel = $('successPanel');
    el.successTitle = $('successTitle');
    el.commentBlock = $('commentBlock');
    el.clockOutComment = $('clockOutComment');
    el.schedulePanel = $('schedulePanel');
    el.scheduleBody = $('scheduleBody');

    if (!SUPABASE_URL || !ANON_KEY) {
      toast('Legacy punch clock is missing Supabase config. Deploy/build env is incomplete.', 'error');
      return;
    }

    buildKeypad();
    bindEvents();
    tickClock();
    setInterval(tickClock, 1000);
    configureCaptureInput();
    updateCameraNote();
    // Live camera needs a user gesture on many tablets — primed on first PIN tap.
    if (canUseLiveCamera()) startLiveCamera(false);
    renderPin();
  }

  function bindEvents() {
    el.clearBtn.onclick = resetAll;
    $('shiftCancelBtn').onclick = resetAll;
    $('confirmBackBtn').onclick = function () {
      hide(el.confirmPanel);
      showShiftSelection();
    };
    $('confirmClockInBtn').onclick = function () {
      clockIn(state.selectedShift);
    };
    $('optionsCancelBtn').onclick = resetAll;
    $('successDoneBtn').onclick = successDone;
    $('scheduleBtn').onclick = openSchedule;
    $('scheduleCloseBtn').onclick = function () {
      hide(el.schedulePanel);
    };
    el.photoInput.onchange = onPhotoInputChange;
    window.addEventListener('focus', onWindowFocusAfterCapture, false);
    window.onbeforeunload = stopLiveCamera;
  }

  function buildKeypad() {
    var rows = [[1, 2, 3], [4, 5, 6], [7, 8, 9], ['', 0, 'back']];
    var html = '';
    for (var r = 0; r < rows.length; r += 1) {
      html += '<div class="keyrow">';
      for (var c = 0; c < rows[r].length; c += 1) {
        html += '<div class="keycell">';
        if (rows[r][c] === '') {
          html += '&nbsp;';
        } else if (rows[r][c] === 'back') {
          html += '<button class="key" type="button" data-key="back">⌫</button>';
        } else {
          html += '<button class="key" type="button" data-key="' + rows[r][c] + '">' + rows[r][c] + '</button>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    el.keypad.innerHTML = html;
    var buttons = el.keypad.getElementsByTagName('button');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].onclick = function () {
        pressKey(this.getAttribute('data-key'));
      };
    }
  }

  function pressKey(key) {
    if (state.loading || panelOpen()) return;
    primeCameraFromGesture();
    if (key === 'back') {
      state.pin = state.pin.slice(0, -1);
      renderPin();
      return;
    }
    if (state.pin.length >= 4) return;
    state.pin += String(key);
    renderPin();
    if (state.pin.length === 4) {
      loadSession();
    }
  }

  function renderPin() {
    var dots = document.getElementsByClassName('dot');
    for (var i = 0; i < dots.length; i += 1) {
      if (i < state.pin.length) addClass(dots[i], 'on');
      else removeClass(dots[i], 'on');
    }
  }

  function loadSession() {
    withLoading('Verifying PIN...', function (done) {
      rpc('time_clock_kiosk_load_session', {
        p_business_id: businessId,
        p_pin: state.pin
      }, function (err, payload) {
        done();
        if (err) {
          toast('Could not verify PIN. Tap Clear and try again.', 'error');
          return;
        }
        if (!payload || payload.error === 'invalid_pin' || !payload.employee || !payload.employee.id) {
          toast('Invalid PIN', 'error');
          state.pin = '';
          renderPin();
          return;
        }
        if (payload.error) {
          toast('Could not verify PIN. Tap Clear and try again.', 'error');
          return;
        }

        state.employee = payload.employee;
        state.employeeName = payload.employee.full_name || payload.employee.name || 'Employee';
        state.sessionToken = payload.sessionToken || '';
        state.activeClock = payload.activeClock || null;
        state.activeBreak = payload.activeBreak || null;
        state.timezone = payload.timezone || 'America/Toronto';
        state.allowUnscheduled = payload.allowUnscheduled !== false;
        state.shifts = payload.shifts && payload.shifts.length ? payload.shifts : [];
        showEmployee();

        if (state.activeClock) {
          if (state.activeBreak) showBreakOptions();
          else showClockedInOptions();
        } else {
          showShiftSelection();
        }
      });
    });
  }

  function showEmployee() {
    el.employee.style.display = 'block';
    el.employeeName.innerHTML = escapeHtml(state.employeeName);
    if (state.activeBreak) {
      el.employeeStatus.className = 'status break';
      el.employeeStatus.innerHTML = 'ON BREAK';
    } else if (state.activeClock) {
      el.employeeStatus.className = 'status';
      el.employeeStatus.innerHTML = 'CLOCKED IN';
    } else {
      el.employeeStatus.className = 'status out';
      el.employeeStatus.innerHTML = 'READY';
    }
  }

  function showShiftSelection() {
    var html = '';
    if (state.shifts.length) {
      for (var i = 0; i < state.shifts.length; i += 1) {
        var s = state.shifts[i];
        html += '<button type="button" class="shift" data-index="' + i + '">';
        html += '<strong>' + escapeHtml(formatTime(s.start_time) + ' - ' + formatTime(s.end_time)) + '</strong>';
        html += escapeHtml(s.position || 'No Position');
        if (s.notes_visible_to_staff === true && s.notes) {
          html += '<div class="note">' + escapeHtml(String(s.notes)) + '</div>';
        }
        html += '</button>';
      }
    }
    if (state.allowUnscheduled) {
      html += '<button type="button" class="shift" data-index="unscheduled"><strong>Clock In - Unscheduled</strong>No scheduled shift selected</button>';
    }
    if (!html) {
      html = '<p style="text-align:center;color:#64748b;font-weight:700">No scheduled shifts available. Please contact your manager.</p>';
    }
    el.shiftList.innerHTML = html;
    var buttons = el.shiftList.getElementsByTagName('button');
    for (var j = 0; j < buttons.length; j += 1) {
      buttons[j].onclick = function () {
        var idx = this.getAttribute('data-index');
        state.selectedShift = idx === 'unscheduled' ? null : state.shifts[parseInt(idx, 10)];
        showConfirm();
      };
    }
    show(el.shiftPanel);
  }

  function showConfirm() {
    hide(el.shiftPanel);
    var s = state.selectedShift;
    var html = '';
    if (s) {
      html += '<p style="text-align:center;font-size:20px"><strong>' + escapeHtml(formatTime(s.start_time) + ' - ' + formatTime(s.end_time)) + '</strong><br>' + escapeHtml(s.position || 'No Position') + '</p>';
      if (s.notes_visible_to_staff === true && s.notes) {
        html += '<div class="note"><strong>Message from your manager</strong><br>' + escapeHtml(String(s.notes)) + '</div>';
      }
    } else {
      html = '<p style="text-align:center;font-size:20px"><strong>Unscheduled Shift</strong></p>';
    }
    el.confirmDetails.innerHTML = html;
    show(el.confirmPanel);
  }

  function showClockedInOptions() {
    el.optionsTitle.innerHTML = 'You are already clocked in';
    el.optionsButtons.innerHTML =
      '<div class="action-row"><div class="action-cell"><button id="breakBtn" class="primary" type="button">Break Time</button></div><div class="action-cell"><button id="clockOutBtn" class="danger" type="button">Clock Out</button></div></div>';
    $('breakBtn').onclick = startBreak;
    $('clockOutBtn').onclick = clockOut;
    show(el.optionsPanel);
  }

  function showBreakOptions() {
    el.optionsTitle.innerHTML = 'You are on break';
    el.optionsButtons.innerHTML =
      '<div class="action-row"><div class="action-cell"><button id="endBreakBtn" class="success" type="button">End Break</button></div><div class="action-cell"><button id="clockOutBtn2" class="danger" type="button">Clock Out</button></div></div>';
    $('endBreakBtn').onclick = endBreak;
    $('clockOutBtn2').onclick = clockOut;
    show(el.optionsPanel);
  }

  function clockIn(shift) {
    requirePhoto(function (photo) {
      hide(el.confirmPanel);
      withLoading('Clocking in...', function (done) {
        var nowIso = new Date().toISOString();
        rpc('time_clock_kiosk_clock_in', {
          p_business_id: businessId,
          p_session_token: state.sessionToken,
          p_clock_in_time: nowIso
        }, function (err, clockId) {
          if (err || !clockId) {
            done();
            toast('Clock in failed. Tap Clear and try again.', 'error');
            return;
          }
          attachPhoto(photo, makePhotoName('clock_in'), 'scheduling_time_clocks', clockId, 'photo_verification_url', function () {
            done();
            state.activeClock = { id: clockId };
            success('Clocked In Successfully!', 'clockIn');
          });
        });
      });
    });
  }

  function clockOut() {
    if (!state.activeClock || !state.activeClock.id) {
      toast('No active clock found. Tap Clear and try again.', 'error');
      return;
    }
    requirePhoto(function (photo) {
      hide(el.optionsPanel);
      withLoading('Clocking out...', function (done) {
        rpc('time_clock_kiosk_clock_out', {
          p_business_id: businessId,
          p_session_token: state.sessionToken,
          p_clock_out_time: new Date().toISOString()
        }, function (err) {
          if (err) {
            done();
            toast('Clock out failed. Tap Clear and try again.', 'error');
            return;
          }
          attachPhoto(photo, makePhotoName('clock_out'), 'scheduling_time_clocks', state.activeClock.id, 'clock_out_photo_url', function () {
            done();
            success('Clocked Out Successfully!', 'clockOut');
          });
        });
      });
    });
  }

  function startBreak() {
    requirePhoto(function (photo) {
      hide(el.optionsPanel);
      withLoading('Starting break...', function (done) {
        rpc('time_clock_kiosk_start_break', {
          p_business_id: businessId,
          p_session_token: state.sessionToken,
          p_notes: 'Break started via legacy kiosk'
        }, function (err, breakId) {
          if (err || !breakId) {
            done();
            toast('Break start failed. Tap Clear and try again.', 'error');
            return;
          }
          state.activeBreak = { id: breakId };
          attachPhoto(photo, makePhotoName('break_start'), 'scheduling_break_tracking', breakId, 'photo_url_start', function () {
            done();
            success('Break Started Successfully!', 'break');
          });
        });
      });
    });
  }

  function endBreak() {
    if (!state.activeBreak || !state.activeBreak.id) {
      toast('No active break found. Tap Clear and try again.', 'error');
      return;
    }
    requirePhoto(function (photo) {
      hide(el.optionsPanel);
      withLoading('Ending break...', function (done) {
        rpc('time_clock_kiosk_end_break', {
          p_business_id: businessId,
          p_session_token: state.sessionToken,
          p_break_id: state.activeBreak.id,
          p_break_end_at: new Date().toISOString()
        }, function (err) {
          if (err) {
            done();
            toast('Break end failed. Tap Clear and try again.', 'error');
            return;
          }
          attachPhoto(photo, makePhotoName('break_end'), 'scheduling_break_tracking', state.activeBreak.id, 'photo_url_end', function () {
            done();
            success('Break Ended Successfully!', 'break');
          });
        });
      });
    });
  }

  function success(title, action) {
    state.currentSuccessAction = action;
    el.successTitle.innerHTML = escapeHtml(title);
    el.commentBlock.style.display = action === 'clockOut' ? 'block' : 'none';
    el.clockOutComment.value = '';
    show(el.successPanel);
    if (action !== 'clockOut') {
      setTimeout(resetAll, RESET_SUCCESS_MS);
    }
  }

  function successDone() {
    if (state.currentSuccessAction !== 'clockOut') {
      resetAll();
      return;
    }
    var notes = trim(el.clockOutComment.value);
    if (!notes) {
      resetAll();
      return;
    }
    withLoading('Saving note...', function (done) {
      rpc('time_clock_kiosk_set_notes_latest_clock_out', {
        p_business_id: businessId,
        p_session_token: state.sessionToken,
        p_notes: notes
      }, function () {
        done();
        resetAll();
      });
    });
  }

  function canUseLiveCamera() {
    var nav = navigator;
    return !!(
      (nav.mediaDevices && nav.mediaDevices.getUserMedia) ||
      nav.getUserMedia ||
      nav.webkitGetUserMedia ||
      nav.mozGetUserMedia ||
      nav.msGetUserMedia
    );
  }

  function configureCaptureInput() {
    if (!el.photoInput) return;
    // Old iOS uses capture="camera"; newer browsers understand "user".
    el.photoInput.setAttribute('accept', 'image/*');
    el.photoInput.setAttribute('capture', canUseLiveCamera() ? 'user' : 'camera');
  }

  function updateCameraNote() {
    if (!el.cameraNote) return;
    if (cameraTrackLive() && (state.latestFrame || el.video.videoWidth)) {
      el.cameraNote.innerHTML = 'Camera ready. Photos are taken automatically from this preview.';
      return;
    }
    if (canUseLiveCamera()) {
      el.cameraNote.innerHTML = 'Tap a PIN key and allow camera access. Preview must show before punching.';
      return;
    }
    el.cameraNote.innerHTML = 'This device will open the camera app automatically when you punch.';
  }

  function requirePhoto(callback) {
    el.video.style.display = 'inline-block';
    el.photoPreview.style.display = 'none';

    // Path A: live preview frame already available — fully automatic.
    var immediate = captureLiveVideo() || state.latestFrame;
    if (immediate && (cameraTrackLive() || state.latestFrame)) {
      finishPhotoCapture(immediate, callback);
      return;
    }

    // Path B: live getUserMedia — request NOW while we still have the tap gesture.
    if (canUseLiveCamera()) {
      setLoading(true, 'Capturing photo...');
      // Kick getUserMedia in this same call stack (required by Safari/iOS).
      restartLiveCamera(!cameraTrackLive(), function () {
        waitForLivePhoto(0, function (photo) {
          if (photo) {
            finishPhotoCapture(photo, callback);
            return;
          }
          // Live path failed after waiting — use camera-app capture while we still can only via error+retry.
          setLoading(false);
          state.lastCameraError = 'Live camera produced no frame';
          updateCameraNote();
          toast('Allow the camera, wait for the preview, then try again.', 'error');
        });
      });
      return;
    }

    // Path C: old iOS / no getUserMedia — open the camera app synchronously from this tap.
    // (Async clicks open a document/file picker instead of the camera.)
    state.pendingPhotoCallback = callback;
    state.captureArmedAt = Date.now();
    setLoading(true, 'Opening camera...');
    openLegacyCameraCaptureSync();
  }

  function openLegacyCameraCaptureSync() {
    configureCaptureInput();
    try {
      el.photoInput.value = '';
    } catch (e1) {}
    try {
      // Must stay synchronous with the user tap.
      el.photoInput.click();
    } catch (e2) {
      state.pendingPhotoCallback = null;
      setLoading(false);
      toast('Could not open camera on this device.', 'error');
    }
  }

  function onPhotoInputChange() {
    var file = el.photoInput.files && el.photoInput.files[0];
    if (!file) {
      if (state.pendingPhotoCallback) {
        state.pendingPhotoCallback = null;
        setLoading(false);
        toast('No photo taken. Try again.', 'error');
      }
      return;
    }
    var cb = state.pendingPhotoCallback;
    state.pendingPhotoCallback = null;
    state.captureArmedAt = 0;
    if (!cb) return;
    setLoading(true, 'Saving photo...');
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = String(reader.result || '');
      finishPhotoCapture(dataUrl, cb);
    };
    reader.onerror = function () {
      setLoading(false);
      toast('Could not read camera photo. Try again.', 'error');
    };
    reader.readAsDataURL(file);
  }

  function onWindowFocusAfterCapture() {
    if (!state.pendingPhotoCallback) return;
    if (!state.captureArmedAt) return;
    // User likely cancelled the camera app.
    window.setTimeout(function () {
      if (!state.pendingPhotoCallback) return;
      if (el.photoInput.files && el.photoInput.files[0]) return;
      if (Date.now() - state.captureArmedAt < 900) return;
      state.pendingPhotoCallback = null;
      state.captureArmedAt = 0;
      setLoading(false);
      toast('Photo cancelled. Try again.', 'error');
    }, 700);
  }

  function finishPhotoCapture(dataUrl, callback) {
    state.photoDataUrl = dataUrl;
    state.latestFrame = dataUrl;
    renderPhotoPreview(dataUrl);
    setLoading(false);
    callback(dataUrl);
  }

  function waitForLivePhoto(attempt, callback) {
    var photo = captureLiveVideo() || state.latestFrame;
    if (photo) {
      callback(photo);
      return;
    }
    if (attempt >= 56) {
      callback(null);
      return;
    }
    window.setTimeout(function () {
      waitForLivePhoto(attempt + 1, callback);
    }, 100);
  }

  function captureLiveVideo() {
    var v = el.video;
    if (!v) return null;
    if (v.paused && v.play) {
      var playPromise = v.play();
      if (playPromise && playPromise.catch) playPromise.catch(function () {});
    }
    var w = v.videoWidth || 0;
    var h = v.videoHeight || 0;
    var track = null;
    if (v.srcObject && v.srcObject.getVideoTracks) {
      track = v.srcObject.getVideoTracks()[0] || null;
    } else if (state.cameraStream && state.cameraStream.getVideoTracks) {
      track = state.cameraStream.getVideoTracks()[0] || null;
    }
    if ((!w || !h) && track && track.getSettings) {
      var settings = track.getSettings();
      if (settings) {
        w = settings.width || w;
        h = settings.height || h;
      }
    }
    if (!w || !h) return null;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      if (dataUrl && dataUrl.length > 500) {
        state.latestFrame = dataUrl;
        return dataUrl;
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function requestUserMedia(constraints, onSuccess, onError) {
    var nav = navigator;
    if (nav.mediaDevices && nav.mediaDevices.getUserMedia) {
      nav.mediaDevices.getUserMedia(constraints).then(onSuccess).catch(onError);
      return;
    }
    var legacy = nav.getUserMedia || nav.webkitGetUserMedia || nav.mozGetUserMedia || nav.msGetUserMedia;
    if (!legacy) {
      onError(new Error('getUserMedia unavailable'));
      return;
    }
    try {
      legacy.call(nav, constraints, onSuccess, onError);
    } catch (e) {
      onError(e);
    }
  }

  function attachStreamToVideo(stream) {
    state.cameraStream = stream;
    state.lastCameraError = '';
    el.video.setAttribute('playsinline', 'true');
    el.video.setAttribute('webkit-playsinline', 'true');
    el.video.muted = true;
    try { el.video.playsInline = true; } catch (e0) {}

    if ('srcObject' in el.video) {
      el.video.srcObject = stream;
    } else if (window.URL && window.URL.createObjectURL) {
      el.video.src = window.URL.createObjectURL(stream);
    } else if (window.webkitURL && window.webkitURL.createObjectURL) {
      el.video.src = window.webkitURL.createObjectURL(stream);
    }

    var p = el.video.play && el.video.play();
    if (p && p.catch) p.catch(function () {});
    startFrameSampler();
    updateCameraNote();
  }

  function startFrameSampler() {
    if (state.frameTimer) return;
    state.frameTimer = window.setInterval(function () {
      captureLiveVideo();
    }, 350);
  }

  function stopFrameSampler() {
    if (state.frameTimer) {
      window.clearInterval(state.frameTimer);
      state.frameTimer = null;
    }
  }

  function cameraTrackLive() {
    if (!state.cameraStream || !state.cameraStream.getVideoTracks) return false;
    var track = state.cameraStream.getVideoTracks()[0];
    return !!(track && track.readyState === 'live');
  }

  function primeCameraFromGesture() {
    if (!canUseLiveCamera()) {
      updateCameraNote();
      return;
    }
    if (cameraTrackLive() && (captureLiveVideo() || state.latestFrame)) {
      updateCameraNote();
      return;
    }
    startLiveCamera(true);
  }

  function startLiveCamera(forceRestart) {
    if (!canUseLiveCamera()) {
      updateCameraNote();
      return;
    }
    restartLiveCamera(!!forceRestart, function () {
      updateCameraNote();
    });
  }

  function restartLiveCamera(forceRestart, callback) {
    callback = callback || function () {};
    if (!canUseLiveCamera()) {
      callback(false);
      return;
    }

    if (!forceRestart && cameraTrackLive()) {
      waitForLivePhoto(0, function (photo) {
        callback(!!photo);
      });
      return;
    }

    if (state.cameraStarting && !forceRestart) {
      waitForLivePhoto(0, function (photo) {
        callback(!!photo);
      });
      return;
    }

    if (forceRestart) stopLiveCamera();

    state.cameraStarting = true;
    var attempts = [
      { video: { facingMode: 'user' }, audio: false },
      { video: { facingMode: { ideal: 'user' } }, audio: false },
      { video: true, audio: false }
    ];

    function tryConstraints(index) {
      if (index >= attempts.length) {
        state.cameraStarting = false;
        callback(false);
        updateCameraNote();
        return;
      }
      requestUserMedia(attempts[index], function (stream) {
        attachStreamToVideo(stream);
        waitForLivePhoto(0, function (photo) {
          state.cameraStarting = false;
          callback(!!photo || cameraTrackLive());
          updateCameraNote();
        });
      }, function (err) {
        state.lastCameraError = (err && (err.name || err.message)) || 'getUserMedia failed';
        tryConstraints(index + 1);
      });
    }

    tryConstraints(0);
  }

  function stopLiveCamera() {
    stopFrameSampler();
    var stream = state.cameraStream;
    state.cameraStream = null;
    state.cameraStarting = false;
    try {
      if ('srcObject' in el.video) el.video.srcObject = null;
      else el.video.removeAttribute('src');
    } catch (e) {}
    if (stream && stream.getTracks) {
      var tracks = stream.getTracks();
      for (var i = 0; i < tracks.length; i += 1) tracks[i].stop();
    }
  }

  function renderPhotoPreview(dataUrl) {
    if (!dataUrl) return;
    el.photoPreview.src = dataUrl;
    el.photoPreview.style.display = 'inline-block';
    el.video.style.display = 'none';
    el.cameraNote.innerHTML = 'Photo captured.';
  }

  function attachPhoto(photo, fileName, table, recordId, column, callback) {
    uploadPhoto(photo, fileName, function (err, url) {
      if (err || !url) {
        toast('Punch saved, but photo upload failed. Tell a manager.', 'error');
        callback();
        return;
      }
      var rpcName = table === 'scheduling_break_tracking'
        ? 'time_clock_kiosk_set_break_tracking_photo'
        : 'time_clock_kiosk_set_time_clock_photo';
      var body = table === 'scheduling_break_tracking'
        ? { p_business_id: businessId, p_break_id: recordId, p_column_name: column, p_photo_url: url, p_session_token: state.sessionToken }
        : { p_business_id: businessId, p_time_clock_id: recordId, p_column_name: column, p_photo_url: url, p_session_token: state.sessionToken };
      rpc(rpcName, body, function () {
        callback();
      });
    });
  }

  function uploadPhoto(dataUrl, fileName, callback) {
    var blob = dataUrlToBlob(dataUrl);
    if (!blob) {
      callback(new Error('invalid photo'));
      return;
    }
    var url = SUPABASE_URL + '/storage/v1/object/' + PHOTO_BUCKET + '/' + encodePath(fileName);
    xhr('POST', url, blob, {
      apikey: ANON_KEY,
      Authorization: 'Bearer ' + ANON_KEY,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'false'
    }, function (err) {
      if (err) {
        callback(err);
        return;
      }
      callback(null, SUPABASE_URL + '/storage/v1/object/public/' + PHOTO_BUCKET + '/' + encodePath(fileName));
    });
  }

  function dataUrlToBlob(dataUrl) {
    try {
      var parts = dataUrl.split(',');
      var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
      var binary = atob(parts[1]);
      var len = binary.length;
      var arr = new Uint8Array(len);
      for (var i = 0; i < len; i += 1) arr[i] = binary.charCodeAt(i);
      return new Blob([arr], { type: mime });
    } catch (e) {
      return null;
    }
  }

  function openSchedule() {
    show(el.schedulePanel);
    el.scheduleBody.innerHTML = '<p>Loading schedule...</p>';
    var weekStart = getWeekStart();
    rpc('time_clock_kiosk_fetch_team_schedule', {
      p_business_id: businessId,
      p_week_start: weekStart
    }, function (err, payload) {
      if (err || !payload || payload.error) {
        el.scheduleBody.innerHTML = '<p>Could not load the schedule. Try again.</p>';
        return;
      }
      renderSchedule(payload.shifts || [], payload.employees || []);
    });
  }

  function renderSchedule(shifts, employees) {
    var employeeById = {};
    for (var i = 0; i < employees.length; i += 1) {
      employeeById[employees[i].id] = employees[i];
    }
    var byDay = {};
    for (var j = 0; j < shifts.length; j += 1) {
      var s = shifts[j];
      var d = s.shift_date || 'Unscheduled';
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(s);
    }
    var days = keys(byDay).sort();
    if (!days.length) {
      el.scheduleBody.innerHTML = '<p>No shifts found for this week.</p>';
      return;
    }
    var html = '';
    for (var k = 0; k < days.length; k += 1) {
      var day = days[k];
      html += '<div class="day"><h3>' + escapeHtml(formatDateLabel(day)) + '</h3>';
      byDay[day].sort(function (a, b) {
        return String(a.start_time || '').localeCompare(String(b.start_time || ''));
      });
      for (var m = 0; m < byDay[day].length; m += 1) {
        var shift = byDay[day][m];
        var emp = employeeById[shift.employee_id] || {};
        var name = emp.full_name || emp.name || shift.employee_name || 'Staff';
        html += '<div style="padding:7px 0;border-top:1px solid #e5e7eb"><strong>' + escapeHtml(formatTime(shift.start_time) + ' - ' + formatTime(shift.end_time)) + '</strong> ';
        html += escapeHtml(name) + ' <span style="color:#64748b">' + escapeHtml(shift.position || '') + '</span></div>';
      }
      html += '</div>';
    }
    el.scheduleBody.innerHTML = html;
  }

  function rpc(name, body, callback) {
    xhr('POST', SUPABASE_URL + '/rest/v1/rpc/' + name, JSON.stringify(body || {}), {
      apikey: ANON_KEY,
      Authorization: 'Bearer ' + ANON_KEY,
      'Content-Type': 'application/json'
    }, function (err, text) {
      if (err) {
        callback(err);
        return;
      }
      try {
        callback(null, text ? JSON.parse(text) : null);
      } catch (e) {
        callback(null, text);
      }
    });
  }

  function xhr(method, url, body, headers, callback) {
    var req = new XMLHttpRequest();
    var timer = window.setTimeout(function () {
      try { req.abort(); } catch (e) {}
      callback(new Error('timeout'));
    }, REQUEST_TIMEOUT_MS);
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      window.clearTimeout(timer);
      if (req.status >= 200 && req.status < 300) callback(null, req.responseText);
      else callback(new Error(req.status + ' ' + req.responseText));
    };
    req.open(method, url, true);
    for (var k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k)) req.setRequestHeader(k, headers[k]);
    }
    req.send(body);
  }

  function withLoading(message, work) {
    setLoading(true, message);
    var finished = false;
    var done = function () {
      if (finished) return;
      finished = true;
      setLoading(false);
    };
    work(done);
  }

  function setLoading(on, message) {
    state.loading = !!on;
    if (on) {
      el.loadingText.innerHTML = escapeHtml(message || 'Working...');
      addClass(el.loading, 'show');
      window.clearTimeout(state.watchdog);
      state.watchdog = window.setTimeout(function () {
        state.loading = false;
        removeClass(el.loading, 'show');
        toast('This took too long and reset. Please try again.', 'error');
        resetAll();
      }, REQUEST_TIMEOUT_MS + 6000);
    } else {
      window.clearTimeout(state.watchdog);
      removeClass(el.loading, 'show');
    }
  }

  function resetAll() {
    hide(el.shiftPanel);
    hide(el.confirmPanel);
    hide(el.optionsPanel);
    hide(el.successPanel);
    setLoading(false);
    state.pin = '';
    state.employee = null;
    state.employeeName = '';
    state.sessionToken = '';
    state.activeClock = null;
    state.activeBreak = null;
    state.shifts = [];
    state.allowUnscheduled = true;
    state.selectedShift = null;
    state.photoDataUrl = null;
    state.latestFrame = null;
    state.currentSuccessAction = '';
    state.pendingPhotoCallback = null;
    state.captureArmedAt = 0;
    el.employee.style.display = 'none';
    el.photoPreview.style.display = 'none';
    el.photoPreview.src = '';
    el.video.style.display = 'inline-block';
    updateCameraNote();
    if (canUseLiveCamera()) {
      if (!cameraTrackLive()) startLiveCamera(false);
      else startFrameSampler();
    }
    renderPin();
  }

  function show(node) { addClass(node, 'show'); }
  function hide(node) { removeClass(node, 'show'); }
  function panelOpen() {
    return hasClass(el.shiftPanel, 'show') || hasClass(el.confirmPanel, 'show') || hasClass(el.optionsPanel, 'show') || hasClass(el.successPanel, 'show') || hasClass(el.schedulePanel, 'show');
  }

  function toast(message, type) {
    el.toast.className = 'toast show ' + (type === 'error' ? 'error' : 'ok');
    el.toast.innerHTML = escapeHtml(message);
    window.setTimeout(function () {
      removeClass(el.toast, 'show');
    }, 4500);
  }

  function tickClock() {
    var d = new Date();
    el.time.innerHTML = formatClock(d);
    el.date.innerHTML = formatDateLong(d);
  }

  function formatClock(d) {
    var h = d.getHours();
    var m = pad(d.getMinutes());
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return h + ':' + m + ' ' + ampm;
  }

  function formatDateLong(d) {
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function formatTime(t) {
    if (!t) return '';
    var p = String(t).split(':');
    var h = parseInt(p[0], 10);
    var m = p[1] || '00';
    if (isNaN(h)) return t;
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return h + ':' + m + ' ' + ap;
  }

  function getWeekStart() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function formatDateLabel(ymd) {
    var p = String(ymd).split('-');
    if (p.length !== 3) return ymd;
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    return formatDateLong(d);
  }

  function makePhotoName(kind) {
    var employeeId = state.employee && state.employee.id ? state.employee.id : 'employee';
    return 'legacy-kiosk/' + businessId + '/' + employeeId + '_' + kind + '_' + timestamp() + '.jpg';
  }

  function timestamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function getQuery(name) {
    var q = window.location.search ? window.location.search.substring(1).split('&') : [];
    for (var i = 0; i < q.length; i += 1) {
      var p = q[i].split('=');
      if (decodeURIComponent(p[0]) === name) return decodeURIComponent(p.slice(1).join('=') || '');
    }
    return '';
  }

  function encodePath(path) {
    var parts = String(path).split('/');
    for (var i = 0; i < parts.length; i += 1) parts[i] = encodeURIComponent(parts[i]);
    return parts.join('/');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function trim(s) {
    return String(s || '').replace(/^\s+|\s+$/g, '');
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function keys(obj) {
    var out = [];
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) out.push(k);
    }
    return out;
  }

  function addClass(node, cls) {
    if (!node) return;
    if (node.classList) node.classList.add(cls);
    else if (!hasClass(node, cls)) node.className += ' ' + cls;
  }

  function removeClass(node, cls) {
    if (!node) return;
    if (node.classList) node.classList.remove(cls);
    else node.className = node.className.replace(new RegExp('(^|\\s)' + cls + '(\\s|$)', 'g'), ' ');
  }

  function hasClass(node, cls) {
    if (!node) return false;
    if (node.classList) return node.classList.contains(cls);
    return new RegExp('(^| )' + cls + '( |$)', 'gi').test(node.className);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
