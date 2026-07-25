/* eslint-disable */
(function () {
  var app = document.getElementById('app');
  if (!app) return;
  var STATION_STORAGE_KEY = 'tavari_waiver_browser_kiosk_business_id';
  var INACTIVITY_IDLE_SECONDS = 20;
  var INACTIVITY_WARNING_SECONDS = 10;
  var INACTIVITY_TIMEOUT_SECONDS = INACTIVITY_IDLE_SECONDS + INACTIVITY_WARNING_SECONDS;
  /** OTP email can be slow; longer idle on verify screen only (then warning, then session end). */
  var INACTIVITY_OTP_IDLE_SECONDS = 60;
  var INACTIVITY_OTP_WARNING_SECONDS = 20;
  /** Refresh signed kiosk ad URLs before Supabase expiry (overnight kiosks). */
  var KIOSK_IDLE_AD_REFRESH_MS = 4 * 60 * 60 * 1000;
  var idleAdRefreshInterval = null;
  var activeIdleSeconds = INACTIVITY_IDLE_SECONDS;
  var activeWarningSeconds = INACTIVITY_WARNING_SECONDS;
  function getActiveInactivityTotalSeconds() {
    return activeIdleSeconds + activeWarningSeconds;
  }
  var inactivityInterval = null;
  var inactivityEnabled = false;
  var inactivitySecondsRemaining = getActiveInactivityTotalSeconds();
  var inactivityTimeoutHandler = null;
  var inactivityListenersBound = false;
  var completionResetTimeout = null;
  var outboxDrainInProgress = false;

  var state = {
    businessId: '',
    stationLockedFromUrl: false,
    businessName: 'Our Facility',
    businessLogo: '',
    businessTimezone: 'America/Toronto',
    idleAds: [],
    idleAdIndex: 0,
    stationMode: 'single',
    templateOptions: [],
    template: null,
    templateId: null,
    settings: {},
    phoneDisplay: '',
    normalizedPhone: '',
    otpTargetEmail: '',
    customerId: null,
    existingWaiver: null,
    existingWaiverHistory: [],
    existingWaiverViewerAccess: 'signer',
    existingWaiverViewerParticipantId: null,
    existingWaiverOtpMatch: null,
    locationData: null,
    archiveEmailStatus: null,
    participants: [],
    currentParticipantIndex: 0,
    consentStates: {
      marketing: true,
      photography: false
    },
    additionalAdultIntentAcknowledgments: [],
    returnToReview: false,
    childrenContinueConfirm: false,
    participantModal: {
      open: false,
      index: null,
      isNew: false
    }
  };

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeHtml(html) {
    return String(html || '').replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }

  function plainTextToPreservedHtml(text) {
    return esc(text)
      .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
      .replace(/ {2,}/g, function (spaces) {
        return new Array(spaces.length + 1).join('&nbsp;');
      })
      .replace(/\r\n|\r|\n/g, '<br />');
  }

  function waiverContentHtml(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (/<\s*[a-z][\s\S]*>/i.test(text)) return safeHtml(text);
    return plainTextToPreservedHtml(text);
  }

  function getQuery(name) {
    var q = window.location.search.replace(/^\?/, '');
    var parts = q ? q.split('&') : [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].split('=');
      if (decodeURIComponent(p[0] || '') === name) {
        return decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
      }
    }
    return '';
  }

  function looksLikeUuid(s) {
    s = (s || '').trim();
    return !!(
      s &&
      ((s.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) ||
        (s.length === 32 && /^[0-9a-f]{32}$/i.test(s)))
    );
  }

  function normalizePhone(value) {
    var d = String(value || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d.slice(0, 10);
  }

  function formatPhone(value) {
    var digits = normalizePhone(value);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return '(' + digits.slice(0, 3) + ') ' + digits.slice(3);
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  }

  function parseSettingValue(value) {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    if (typeof value === 'boolean' || typeof value === 'number') return value;
    var text = String(value).trim();
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text !== '' && !isNaN(Number(text))) return Number(text);
    return text;
  }

  function latestTemplatesByKey(templates) {
    var seen = {};
    var latest = [];
    var i;
    for (i = 0; i < (templates || []).length; i++) {
      var template = templates[i];
      if (!template) continue;
      var key = template.template_key || template.id;
      if (!key || seen[key]) continue;
      seen[key] = true;
      latest.push(template);
    }
    return latest;
  }

  function buildStationTemplateOptions(templates, settings) {
    var configured = settings && settings.waiver_station_templates && settings.waiver_station_templates.length
      ? settings.waiver_station_templates
      : [];
    var out = [];
    var i;
    for (i = 0; i < configured.length; i++) {
      var item = configured[i] || {};
      var match = null;
      var j;
      for (j = 0; j < (templates || []).length; j++) {
        var template = templates[j];
        if (!template) continue;
        if ((item.templateId && template.id === item.templateId) ||
            (item.templateKey && template.template_key === item.templateKey)) {
          match = template;
          break;
        }
      }
      if (!match) continue;
      out.push({
        templateId: match.id,
        templateKey: match.template_key,
        displayName:
          String(item.displayName || '').trim() ||
          String(match.waiver_title || '').trim() ||
          String(match.template_name || '').trim() ||
          String(match.template_key || '').trim(),
        template: match
      });
    }
    return out;
  }

  function setActiveTemplate(template) {
    state.template = template || null;
    state.templateId = state.template && state.template.id ? state.template.id : null;
  }

  function resolveDefaultTemplate(templates, settings, options) {
    var stationMode = settings && settings.waiver_station_mode === 'multi' ? 'multi' : 'single';
    var defaultTemplateKey = settings && settings.waiver_station_default_template_key
      ? String(settings.waiver_station_default_template_key).trim()
      : '';
    var i;
    if (stationMode === 'multi' && options && options.length === 1) {
      return options[0].template || null;
    }
    if (defaultTemplateKey) {
      for (i = 0; i < (templates || []).length; i++) {
        if (templates[i] && templates[i].template_key === defaultTemplateKey) {
          return templates[i];
        }
      }
    }
    return templates && templates.length ? templates[0] : null;
  }

  function hasStartableWaiver() {
    return (state.stationMode === 'multi' && state.templateOptions && state.templateOptions.length > 0) || !!state.templateId;
  }

  function formatDateTime(value) {
    if (!value) return 'Not available';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    try {
      return new Intl.DateTimeFormat('en-CA', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: getValidBusinessTimezone(state.businessTimezone)
      }).format(d);
    } catch (e) {
      return d.toLocaleString();
    }
  }

  function formatDateOnly(value) {
    if (!value) return 'Not provided';
    var isoMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      var monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      var monthIndex = Number(isoMatch[2]) - 1;
      var day = Number(isoMatch[3]);
      if (monthIndex >= 0 && monthIndex < monthNames.length && day >= 1 && day <= 31) {
        return monthNames[monthIndex] + ' ' + day + ', ' + isoMatch[1];
      }
    }
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    try {
      return new Intl.DateTimeFormat('en-CA', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: getValidBusinessTimezone(state.businessTimezone)
      }).format(d);
    } catch (e) {
      return d.toLocaleDateString();
    }
  }

  function getValidBusinessTimezone(timezone) {
    var tz = timezone || 'America/Toronto';
    try {
      Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
      return tz;
    } catch (e) {
      return 'America/Toronto';
    }
  }

  function getCurrentBusinessDateIso() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: getValidBusinessTimezone(state.businessTimezone)
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString().split('T')[0];
    }
  }

  function parseIsoDateParts(value) {
    var text = String(value || '').trim();
    var match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    var y = parseInt(match[1], 10);
    var m = parseInt(match[2], 10);
    var d = parseInt(match[3], 10);
    if (!y || !m || !d) return null;
    var date = new Date(y, m - 1, d, 12, 0, 0, 0);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return { y: y, m: m, d: d };
  }

  function isoDateFromLocalDate(date) {
    if (!date || isNaN(date.getTime())) return '';
    var y = String(date.getFullYear());
    var m = String(date.getMonth() + 1);
    var d = String(date.getDate());
    return (
      y +
      '-' +
      (m.length === 1 ? '0' + m : m) +
      '-' +
      (d.length === 1 ? '0' + d : d)
    );
  }

  function shiftIsoDate(value, years, days) {
    var parts = parseIsoDateParts(value);
    if (!parts) return '';
    var date = new Date(parts.y, parts.m - 1, parts.d, 12, 0, 0, 0);
    if (years) date.setFullYear(date.getFullYear() + years);
    if (days) date.setDate(date.getDate() + days);
    return isoDateFromLocalDate(date);
  }

  function getMinorAgeThreshold() {
    var templateValue = state.template && state.template.minor_age_threshold != null ? Number(state.template.minor_age_threshold) : NaN;
    if (isFinite(templateValue) && templateValue > 0) return templateValue;
    var settingsValue = state.settings && state.settings.minor_age_threshold != null ? Number(state.settings.minor_age_threshold) : NaN;
    if (isFinite(settingsValue) && settingsValue > 0) return settingsValue;
    return 18;
  }

  function calculateAgeOnBusinessDate(dateOfBirthIso) {
    var dob = parseIsoDateParts(dateOfBirthIso);
    var today = parseIsoDateParts(getCurrentBusinessDateIso());
    if (!dob || !today) return null;
    var age = today.y - dob.y;
    if (today.m < dob.m || (today.m === dob.m && today.d < dob.d)) age -= 1;
    return age;
  }

  function getBirthdateConstraints(participantType) {
    var todayIso = getCurrentBusinessDateIso();
    var threshold = getMinorAgeThreshold();
    var adultCutoffIso = shiftIsoDate(todayIso, -threshold, 0);
    if (participantType === 'minor') {
      return {
        min: shiftIsoDate(adultCutoffIso, 0, 1),
        max: todayIso
      };
    }
    return {
      min: '1900-01-01',
      max: adultCutoffIso
    };
  }

  function getBirthdateValidationMessage(participantType, dateOfBirthIso) {
    if (!dateOfBirthIso) return 'Date of birth is required.';
    var dob = parseIsoDateParts(dateOfBirthIso);
    if (!dob) return 'Enter a valid date of birth.';
    var today = parseIsoDateParts(getCurrentBusinessDateIso());
    if (!today) return '';
    if (
      dob.y > today.y ||
      (dob.y === today.y && dob.m > today.m) ||
      (dob.y === today.y && dob.m === today.m && dob.d > today.d)
    ) {
      return 'Date of birth cannot be in the future.';
    }
    var age = calculateAgeOnBusinessDate(dateOfBirthIso);
    var threshold = getMinorAgeThreshold();
    if (age == null) return 'Enter a valid date of birth.';
    if (participantType === 'minor' && age >= threshold) {
      return 'Select a valid date of birth for this child.';
    }
    if (participantType !== 'minor' && age < threshold) {
      return 'Select a valid date of birth for this adult.';
    }
    return '';
  }

  function padBirthdatePart(value) {
    var text = String(value || '');
    return text.length === 1 ? '0' + text : text;
  }

  function combineBirthdateParts(year, month, day) {
    var y = String(year || '').trim();
    var m = padBirthdatePart(String(month || '').trim());
    var d = padBirthdatePart(String(day || '').trim());
    if (!y || !m || !d) return '';
    var iso = y + '-' + m + '-' + d;
    return parseIsoDateParts(iso) ? iso : '';
  }

  function compareDateParts(a, b) {
    if (!a || !b) return 0;
    if (a.y !== b.y) return a.y < b.y ? -1 : 1;
    if (a.m !== b.m) return a.m < b.m ? -1 : 1;
    if (a.d !== b.d) return a.d < b.d ? -1 : 1;
    return 0;
  }

  function daysInMonth(year, month) {
    return new Date(Number(year), Number(month), 0).getDate();
  }

  function buildSelectOptions(options, selectedValue, placeholder) {
    var html = '<option value="">' + esc(placeholder) + '</option>';
    for (var i = 0; i < options.length; i++) {
      var option = options[i];
      var value = String(option.value);
      html +=
        '<option value="' +
        esc(value) +
        '"' +
        (String(selectedValue || '') === value ? ' selected' : '') +
        '>' +
        esc(option.label) +
        '</option>';
    }
    return html;
  }

  function getBirthdateSelectState(participantType, currentIso, partialState) {
    var constraints = getBirthdateConstraints(participantType);
    var minParts = parseIsoDateParts(constraints.min);
    var maxParts = parseIsoDateParts(constraints.max);
    var currentParts = parseIsoDateParts(currentIso);
    partialState = partialState || {};
    if (
      currentParts &&
      ((minParts && compareDateParts(currentParts, minParts) < 0) ||
        (maxParts && compareDateParts(currentParts, maxParts) > 0))
    ) {
      currentParts = null;
    }
    var years = [];
    if (minParts && maxParts) {
      for (var y = maxParts.y; y >= minParts.y; y--) {
        years.push({ value: String(y), label: String(y) });
      }
    }
    var selectedYear = String(partialState.birthYear || (currentParts ? String(currentParts.y) : '') || '');
    var months = [];
    if (selectedYear && minParts && maxParts) {
      for (var m = 1; m <= 12; m++) {
        var monthStart = { y: Number(selectedYear), m: m, d: 1 };
        var monthEnd = { y: Number(selectedYear), m: m, d: daysInMonth(selectedYear, m) };
        if (compareDateParts(monthEnd, minParts) < 0) continue;
        if (compareDateParts(monthStart, maxParts) > 0) continue;
        months.push({
          value: padBirthdatePart(m),
          label: [
            'January',
            'February',
            'March',
            'April',
            'May',
            'June',
            'July',
            'August',
            'September',
            'October',
            'November',
            'December'
          ][m - 1]
        });
      }
    }
    var selectedMonth = String(partialState.birthMonth || (currentParts ? padBirthdatePart(currentParts.m) : '') || '');
    var monthStillAllowed = false;
    for (var i = 0; i < months.length; i++) {
      if (months[i].value === selectedMonth) {
        monthStillAllowed = true;
        break;
      }
    }
    if (!monthStillAllowed) selectedMonth = '';
    var days = [];
    if (selectedYear && selectedMonth && minParts && maxParts) {
      var maxDay = daysInMonth(selectedYear, selectedMonth);
      for (var d = 1; d <= maxDay; d++) {
        var parts = { y: Number(selectedYear), m: Number(selectedMonth), d: d };
        if (compareDateParts(parts, minParts) < 0) continue;
        if (compareDateParts(parts, maxParts) > 0) continue;
        days.push({ value: padBirthdatePart(d), label: String(d) });
      }
    }
    var selectedDay = String(partialState.birthDay || (currentParts ? padBirthdatePart(currentParts.d) : '') || '');
    var dayStillAllowed = false;
    for (var j = 0; j < days.length; j++) {
      if (days[j].value === selectedDay) {
        dayStillAllowed = true;
        break;
      }
    }
    if (!dayStillAllowed) selectedDay = '';
    return {
      years: years,
      months: months,
      days: days,
      selectedYear: selectedYear,
      selectedMonth: selectedMonth,
      selectedDay: selectedDay,
      value: combineBirthdateParts(selectedYear, selectedMonth, selectedDay)
    };
  }

  function birthdateFieldHtml(participantType, participantData) {
    participantData = participantData || {};
    var state = getBirthdateSelectState(participantType, participantData.dateOfBirth, participantData);
    return (
      '<div><label class="pw-label">Date of birth</label>' +
      '<input id="dateOfBirth" type="hidden" value="' +
      esc(state.value) +
      '" />' +
      '<div style="display:flex;gap:8px;flex-wrap:nowrap;">' +
      '<select id="birthYear" class="pw-select">' +
      buildSelectOptions(state.years, state.selectedYear, 'Year') +
      '</select>' +
      '<select id="birthMonth" class="pw-select">' +
      buildSelectOptions(state.months, state.selectedMonth, 'Month') +
      '</select>' +
      '<select id="birthDay" class="pw-select">' +
      buildSelectOptions(state.days, state.selectedDay, 'Day') +
      '</select>' +
      '</div></div>'
    );
  }

  function normalizeEnteredPhone(value) {
    var d = normalizePhone(value);
    return d && d.length >= 10 ? d : '';
  }

  function participantPhoneDigits(row) {
    if (!row) return '';
    return normalizeEnteredPhone(
      row.phone_number || row.phone || row.customer_phone || (row.data && row.data.phoneNumber) || ''
    );
  }

  function isAdditionalAdultParticipant(row) {
    return !!row && String(row.participant_type || row.type || '').toLowerCase() === 'additional_adult';
  }

  function isMinorParticipant(row) {
    return !!row && String(row.participant_type || row.type || '').toLowerCase() === 'minor';
  }

  function resolveWaiverViewerAccess(waiver, participants, normalizedEnteredPhone) {
    var entered = normalizeEnteredPhone(normalizedEnteredPhone);
    var sigPhone = normalizeEnteredPhone(waiver && waiver.phone_number);
    var i;
    if (entered && sigPhone && entered === sigPhone) {
      return { mode: 'signer', participantId: null };
    }
    for (i = 0; i < (participants || []).length; i++) {
      if (!isAdditionalAdultParticipant(participants[i])) continue;
      if (participantPhoneDigits(participants[i]) === entered) {
        var raw = participants[i].participant_portal_access || 'full_view';
        return {
          mode: raw === 'co_primary' ? 'co_primary' : raw === 'self_only' ? 'self_only' : 'full_view',
          participantId: participants[i].id || null
        };
      }
    }
    return { mode: 'signer', participantId: null };
  }

  function resolveOtpDeliveryForExistingWaiver(waiver, participants, normalizedEnteredPhone) {
    var entered = normalizeEnteredPhone(normalizedEnteredPhone);
    var sigPhone = normalizeEnteredPhone(waiver && waiver.phone_number);
    var i;
    if (entered && sigPhone && entered === sigPhone) {
      return {
        email: (waiver && waiver.email ? String(waiver.email).trim() : '') || null,
        matched: 'signature'
      };
    }
    for (i = 0; i < (participants || []).length; i++) {
      if (!isAdditionalAdultParticipant(participants[i])) continue;
      if (participantPhoneDigits(participants[i]) === entered) {
        return {
          email: (participants[i].email ? String(participants[i].email).trim() : '') || null,
          matched: 'additional_adult'
        };
      }
    }
    return { email: null, matched: null };
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl || '').split(',');
    var meta = parts[0] || '';
    var body = parts[1] || '';
    var mimeMatch = meta.match(/data:([^;]+);base64/);
    var mime = mimeMatch ? mimeMatch[1] : 'image/png';
    var binary = atob(body);
    var len = binary.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  function postStorageWaiversObject(filePath, blob, useUpsert, cb) {
    var c = getConfig();
    if (!c.supabaseUrl || !c.anonKey) {
      cb(new Error('Kiosk not configured'));
      return;
    }
    var xhr = new XMLHttpRequest();
    var settled = false;
    function settle(err, publicUrl) {
      if (settled) return;
      settled = true;
      if (err) {
        cb(err);
        return;
      }
      cb(null, publicUrl);
    }
    xhr.open('POST', c.supabaseUrl.replace(/\/$/, '') + '/storage/v1/object/waivers/' + filePath, true);
    xhr.setRequestHeader('apikey', c.anonKey);
    xhr.setRequestHeader('Authorization', 'Bearer ' + c.anonKey);
    xhr.setRequestHeader('x-upsert', useUpsert ? 'true' : 'false');
    xhr.setRequestHeader('Content-Type', blob && blob.type ? blob.type : 'image/png');
    xhr.timeout = 180000;
    xhr.ontimeout = function () {
      settle(new Error('Signature upload timed out (network too slow or interrupted).'));
    };
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        settle(null, c.supabaseUrl.replace(/\/$/, '') + '/storage/v1/object/public/waivers/' + filePath);
        return;
      }
      var detail = (xhr.responseText || '').slice(0, 300);
      settle(new Error('Signature upload failed (' + xhr.status + ')' + (detail ? ': ' + detail : '')));
    };
    xhr.send(blob);
  }

  function uploadSignatureImage(dataUrl, businessId, waiverId, prefix, cb) {
    if (!dataUrl) {
      cb(null, null);
      return;
    }
    var filePath =
      'signatures/' +
      businessId +
      '/' +
      (waiverId || 'draft') +
      '-' +
      prefix +
      '-' +
      Date.now() +
      '.png';
    postStorageWaiversObject(filePath, dataUrlToBlob(dataUrl), false, cb);
  }

  var OUTBOX_DB_NAME = 'tavari_waiver_kiosk_outbox_v1';
  var OUTBOX_STORE_NAME = 'jobs';
  var OUTBOX_MAX_ATTEMPTS = 28;

  function openOutboxDb(cb) {
    try {
      if (!window.indexedDB) {
        cb(null);
        return;
      }
      var req = window.indexedDB.open(OUTBOX_DB_NAME, 1);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(OUTBOX_STORE_NAME)) {
          db.createObjectStore(OUTBOX_STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onerror = function () {
        cb(null);
      };
      req.onsuccess = function () {
        cb(req.result);
      };
    } catch (e) {
      cb(null);
    }
  }

  function outboxPut(job, cb) {
    cb = cb || function () {};
    openOutboxDb(function (db) {
      if (!db) {
        cb(new Error('no outbox'));
        return;
      }
      var tx = db.transaction(OUTBOX_STORE_NAME, 'readwrite');
      tx.oncomplete = function () {
        cb(null);
      };
      tx.onerror = function () {
        cb(tx.error || new Error('outbox write'));
      };
      tx.objectStore(OUTBOX_STORE_NAME).put(job);
    });
  }

  function outboxDelete(id, cb) {
    cb = cb || function () {};
    openOutboxDb(function (db) {
      if (!db) {
        cb(null);
        return;
      }
      var tx = db.transaction(OUTBOX_STORE_NAME, 'readwrite');
      tx.oncomplete = function () {
        cb(null);
      };
      tx.onerror = function () {
        cb(tx.error || new Error('outbox delete'));
      };
      tx.objectStore(OUTBOX_STORE_NAME).delete(id);
    });
  }

  function outboxEnqueue(job, cb) {
    cb = cb || function () {};
    job.id = job.id || 'wk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    if (job.attempts == null) job.attempts = 0;
    if (job.createdAt == null) job.createdAt = Date.now();
    outboxPut(job, cb);
  }

  function processOutboxJobRecord(job, cb) {
    if (!job || !job.kind) {
      cb(new Error('bad job'));
      return;
    }
    if (job.kind === 'archive_email') {
      var ap = job.payload || {};
      callArchiveEmailEndpoint(ap.waiverId, ap.signatureToken, { businessId: ap.businessId }, function (err) {
        cb(err || null);
      });
      return;
    }
    if (job.kind === 'rest_patch') {
      var rp = job.payload || {};
      restPatch(rp.path, rp.body, function (err) {
        cb(err || null);
      });
      return;
    }
    if (job.kind === 'signature_delivery') {
      var spec = job.payload || {};
      var safeId = String(job.id || 'id').replace(/[^a-z0-9_-]/gi, '').slice(-28);
      var filePath =
        'signatures/' +
        spec.businessId +
        '/' +
        (spec.waiverId || 'draft') +
        '-' +
        (spec.prefix || 'sig') +
        '-q-' +
        safeId +
        '.png';
      var blob;
      try {
        blob = dataUrlToBlob(spec.dataUrl);
      } catch (e1) {
        cb(new Error('bad signature data'));
        return;
      }
      postStorageWaiversObject(filePath, blob, true, function (err, url) {
        if (err) {
          cb(err);
          return;
        }
        var patchPath =
          spec.target === 'waiver_participant'
            ? '/rest/v1/waiver_participants?id=eq.' + encodeURIComponent(spec.rowId)
            : '/rest/v1/waiver_signatures?id=eq.' + encodeURIComponent(spec.rowId);
        restPatch(patchPath, { signature_image_url: url }, function (pErr) {
          cb(pErr || null);
        });
      });
      return;
    }
    cb(new Error('unknown job kind'));
  }

  function drainOutboxJobList(jobs, index, done) {
    if (index >= jobs.length) {
      outboxDrainInProgress = false;
      if (typeof done === 'function') done();
      return;
    }
    var job = jobs[index];
    processOutboxJobRecord(job, function (err) {
      if (!err) {
        outboxDelete(job.id, function () {
          drainOutboxJobList(jobs, index + 1, done);
        });
        return;
      }
      job.attempts = (job.attempts || 0) + 1;
      if (job.attempts >= OUTBOX_MAX_ATTEMPTS) {
        outboxDelete(job.id, function () {
          drainOutboxJobList(jobs, index + 1, done);
        });
        return;
      }
      outboxPut(job, function () {
        drainOutboxJobList(jobs, index + 1, done);
      });
    });
  }

  function drainOutbox(done) {
    if (outboxDrainInProgress) {
      if (typeof done === 'function') done();
      return;
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (typeof done === 'function') done();
        return;
      }
    } catch (e0) {}
    outboxDrainInProgress = true;
    openOutboxDb(function (db) {
      if (!db) {
        outboxDrainInProgress = false;
        if (typeof done === 'function') done();
        return;
      }
      try {
        var tx = db.transaction(OUTBOX_STORE_NAME, 'readonly');
        var req = tx.objectStore(OUTBOX_STORE_NAME).getAll();
        req.onsuccess = function () {
          var jobs = req.result || [];
          jobs.sort(function (a, b) {
            return (a.createdAt || 0) - (b.createdAt || 0);
          });
          if (!jobs.length) {
            outboxDrainInProgress = false;
            if (typeof done === 'function') done();
            return;
          }
          drainOutboxJobList(jobs, 0, done);
        };
        req.onerror = function () {
          outboxDrainInProgress = false;
          if (typeof done === 'function') done();
        };
      } catch (e2) {
        outboxDrainInProgress = false;
        if (typeof done === 'function') done();
      }
    });
  }

  function restPatchWithRetry(path, body, maxAttempts, cb, fast) {
    var n = 0;
    var base = fast ? 60 : 500;
    var step = fast ? 90 : 400;
    function attempt() {
      n++;
      restPatch(path, body, function (err) {
        if (!err) {
          cb(null);
          return;
        }
        if (n >= maxAttempts) {
          cb(err);
          return;
        }
        setTimeout(attempt, base + step * n);
      });
    }
    attempt();
  }

  function resilientSignatureDelivery(spec, onDone, counterRush) {
    var uploadTries = 0;
    var maxUploadTries = counterRush ? 6 : 4;
    var patchAttempts = counterRush ? 6 : 4;
    function runUpload() {
      uploadTries++;
      uploadSignatureImage(spec.dataUrl, spec.businessId, spec.waiverId, spec.prefix, function (err, url) {
        if (!err && url) {
          var patchPath =
            spec.target === 'waiver_participant'
              ? '/rest/v1/waiver_participants?id=eq.' + encodeURIComponent(spec.rowId)
              : '/rest/v1/waiver_signatures?id=eq.' + encodeURIComponent(spec.rowId);
          restPatchWithRetry(patchPath, { signature_image_url: url }, patchAttempts, function (pErr) {
            if (!pErr) {
              onDone();
              return;
            }
            outboxEnqueue(
              {
                kind: 'rest_patch',
                payload: { path: patchPath, body: { signature_image_url: url } }
              },
              function () {
                onDone();
              }
            );
          }, counterRush);
          return;
        }
        if (uploadTries >= maxUploadTries) {
          outboxEnqueue({ kind: 'signature_delivery', payload: spec }, function () {
            onDone();
          });
          return;
        }
        setTimeout(runUpload, counterRush ? 70 + 110 * uploadTries : 500 + 450 * uploadTries);
      });
    }
    runUpload();
  }

  function callArchiveEmailWithOutbox(waiverId, signatureToken, businessId, resultCb, counterRush) {
    var tries = 0;
    var maxTries = counterRush ? 5 : 4;
    function go() {
      tries++;
      callArchiveEmailEndpoint(waiverId, signatureToken, { businessId: businessId }, function (err, data) {
        if (!err) {
          resultCb(null, data || {});
          return;
        }
        if (tries >= maxTries) {
          outboxEnqueue(
            {
              id: 'ar_' + String(waiverId).replace(/-/g, '') + '_' + Date.now(),
              kind: 'archive_email',
              payload: {
                waiverId: waiverId,
                signatureToken: signatureToken,
                businessId: businessId
              }
            },
            function (enqErr) {
              if (enqErr) {
                resultCb(err, null);
                return;
              }
              resultCb(null, { deferred: true, emailed: false, archived: false });
            }
          );
          return;
        }
        setTimeout(go, counterRush ? 100 + 140 * tries : 500 + 500 * tries);
      });
    }
    go();
  }

  function initWaiverNetworkOutbox() {
    if (window.__tavariWaiverKioskOutboxInit) return;
    window.__tavariWaiverKioskOutboxInit = true;
    window.addEventListener('online', function () {
      setTimeout(function () {
        drainOutbox();
      }, 500);
    });
    setInterval(function () {
      try {
        if (typeof navigator === 'undefined' || navigator.onLine !== false) {
          drainOutbox();
        }
      } catch (e3) {}
    }, 45000);
    setTimeout(function () {
      drainOutbox();
    }, 4000);
  }

  function pickPublicBusinessName(row, fallback) {
    if (!row) return fallback || 'Our Facility';
    var bn = row.business_name && String(row.business_name).trim();
    var n = row.name && String(row.name).trim();
    return bn || n || fallback || 'Our Facility';
  }

  function getConfig() {
    return window.__TAVARI_WAIVER_BROWSER_KIOSK__ || window.__TAVARI_LEGACY_WAIVER__ || {};
  }

  function getStoredStationBusinessId() {
    try {
      return (window.localStorage.getItem(STATION_STORAGE_KEY) || '').trim();
    } catch (e) {
      return '';
    }
  }

  function setStoredStationBusinessId(value) {
    try {
      if (value) window.localStorage.setItem(STATION_STORAGE_KEY, value);
    } catch (e) {}
  }

  function clearStoredStationBusinessId() {
    try {
      window.localStorage.removeItem(STATION_STORAGE_KEY);
    } catch (e) {}
  }

  function trimTrailingSlash(value) {
    return String(value || '').trim().replace(/\/$/, '');
  }

  /** Local / LAN dev hosts: never bounce to production waiver subdomain (generated config always sets subdomainUrl). */
  function isLikelyLocalDevHost(hostname) {
    var h = String(hostname || '').toLowerCase();
    if (!h) return false;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1') return true;
    if (h.slice(-6) === '.local') return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    return /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h);
  }

  function redirectToWaiverSubdomainIfConfigured() {
    var cfg = getConfig();
    var subdomainUrl = trimTrailingSlash(cfg.subdomainUrl || cfg.cutoverUrl || '');
    if (!subdomainUrl) return false;
    try {
      var current = trimTrailingSlash(window.location.origin);
      if (!current) return false;
      if (current.toLowerCase() === subdomainUrl.toLowerCase()) return false;
      if (isLikelyLocalDevHost(window.location.hostname)) return false;
      var target = subdomainUrl + window.location.pathname + window.location.search + window.location.hash;
      window.location.replace(target);
      return true;
    } catch (e) {
      return false;
    }
  }

  function request(method, path, body, cb, extraHeaders) {
    var c = getConfig();
    if (!c.supabaseUrl || !c.anonKey) {
      cb(new Error('This kiosk is not configured with Supabase settings.'));
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open(method, c.supabaseUrl.replace(/\/$/, '') + path, true);
    xhr.setRequestHeader('apikey', c.anonKey);
    xhr.setRequestHeader('Authorization', 'Bearer ' + c.anonKey);
    xhr.setRequestHeader('Accept', 'application/json');
    if (body != null) xhr.setRequestHeader('Content-Type', 'application/json');
    if (extraHeaders) {
      for (var key in extraHeaders) {
        if (Object.prototype.hasOwnProperty.call(extraHeaders, key)) {
          xhr.setRequestHeader(key, extraHeaders[key]);
        }
      }
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var text = xhr.responseText || '';
      var data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        data = text;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        cb(null, data);
        return;
      }
      var msg =
        (data && (data.message || data.error_description || data.error)) ||
        text ||
        'Request failed';
      cb(new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)));
    };
    xhr.send(body != null ? JSON.stringify(body) : null);
  }

  function restGet(path, cb) {
    request('GET', path, null, function (err, data) {
      cb(err, data || []);
    });
  }

  function restInsert(path, body, cb) {
    request('POST', path, body, cb, {
      Prefer: 'return=representation'
    });
  }

  function restPatch(path, body, cb) {
    request('PATCH', path, body, cb, {
      Prefer: 'return=representation'
    });
  }

  function rpc(name, payload, cb) {
    request('POST', '/rest/v1/rpc/' + name, payload, cb);
  }

  /** PostgREST: SETOF / single record both arrive as array or one object. */
  function firstRpcRowFromPostgrest(data) {
    if (data == null) return null;
    if (Object.prototype.toString.call(data) === '[object Array]') {
      return data[0] || null;
    }
    return data;
  }

  function getIp(cb) {
    request('GET', 'https://api.ipify.org?format=json'.replace(/^https:\/\/[^/]+/, ''), null, function () {
      cb('unknown');
    });
  }

  function externalJson(url, cb, timeoutMs) {
    var xhr = new XMLHttpRequest();
    var finished = false;
    var timer = null;
    function complete(err, data) {
      if (finished) return;
      finished = true;
      if (timer) {
        try {
          clearTimeout(timer);
        } catch (e) {}
        timer = null;
      }
      if (err) {
        cb(err);
        return;
      }
      cb(null, data);
    }
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          complete(null, JSON.parse(xhr.responseText || '{}'));
          return;
        } catch (e) {}
      }
      complete(new Error('request failed'));
    };
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(function () {
        try {
          xhr.abort();
        } catch (e) {}
        complete(new Error('timeout'));
      }, timeoutMs);
    }
    xhr.send();
  }

  function fetchIp(cb) {
    externalJson(
      'https://api.ipify.org?format=json',
      function (err, data) {
        cb(!err && data && data.ip ? data.ip : 'unknown');
      },
      8000
    );
  }

  /** Wait for in-flight kiosk pre-uploads so inserts can include signature_image_url when possible. */
  function flushEarlySignatureUploadsThen(cb) {
    var deadline = Date.now() + 60000;
    (function poll() {
      var i;
      for (i = 0; i < state.participants.length; i++) {
        if (state.participants[i] && state.participants[i].signaturePregenInFlight) {
          if (Date.now() > deadline) {
            cb();
            return;
          }
          setTimeout(poll, 150);
          return;
        }
      }
      cb();
    })();
  }

  function fetchBusinessMeta(bid, cb) {
    var name = 'Our Facility';
    var logo = '';
    var timezone = 'America/Toronto';
    restGet('/rest/v1/businesses?id=eq.' + encodeURIComponent(bid) + '&select=name,timezone&limit=1', function (err, rows) {
      if (!err && rows && rows[0]) {
        name = pickPublicBusinessName(rows[0], name);
        timezone = rows[0].timezone || timezone;
      }
      restGet('/rest/v1/app_branding?business_id=eq.' + encodeURIComponent(bid) + '&select=logo_url&limit=1', function (err2, brands) {
        if (!err2 && brands && brands[0] && brands[0].logo_url) {
          logo = brands[0].logo_url;
        }
        cb({
          name: name,
          logo: logo,
          timezone: timezone
        });
      });
    });
  }

  function loadSettings(cb) {
    restGet(
      '/rest/v1/waiver_settings?business_id=eq.' + encodeURIComponent(state.businessId) + '&select=setting_key,setting_value,is_global,template_id',
      function (err, rows) {
        var out = {
          auto_click_marketing: true,
          require_photography_consent: false,
          default_expiry_days: null,
          waiver_station_mode: 'single',
          waiver_station_default_template_key: '',
          waiver_station_templates: [],
          waiver_kiosk_ad_slide_seconds: 8
        };
        if (!err && rows && rows.length) {
          for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (!row || !row.setting_key) continue;
            if (row.is_global === true || (state.templateId && row.template_id === state.templateId)) {
              out[row.setting_key] = parseSettingValue(row.setting_value);
            }
          }
        }
        state.settings = out;
        if (state.settings.auto_click_marketing !== false) {
          state.consentStates.marketing = true;
        }
        cb();
      }
    );
  }

  /** Signed kiosk ad URLs via Edge Function (service role); avoids storage.objects RLS. */
  function loadIdleAds(cb) {
    state.idleAds = [];
    var c = getConfig();
    if (!c.supabaseUrl || !c.anonKey || !state.businessId) {
      cb();
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open(
      'POST',
      String(c.supabaseUrl).replace(/\/$/, '') + '/functions/v1/waiver-kiosk-ad-urls',
      true
    );
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('apikey', c.anonKey);
    xhr.setRequestHeader('Authorization', 'Bearer ' + c.anonKey);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      try {
        var body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        if (xhr.status >= 200 && xhr.status < 300 && body.ok && body.ads) {
          state.idleAds = (body.ads || []).filter(function (a) {
            return a && a.imageUrl;
          });
        }
      } catch (e) {
        state.idleAds = [];
      }
      cb();
    };
    xhr.send(JSON.stringify({ business_id: state.businessId }));
  }

  function loadKioskContext(cb) {
    fetchBusinessMeta(state.businessId, function (meta) {
      state.businessName = meta.name;
      state.businessLogo = meta.logo || '';
      state.businessTimezone = meta.timezone || 'America/Toronto';
      setActiveTemplate(null);
      loadIdleAds(function () {
        loadSettings(function () {
          restGet(
            '/rest/v1/waiver_templates?business_id=eq.' +
              encodeURIComponent(state.businessId) +
              '&is_active=eq.true&select=id,template_key,template_name,waiver_title,waiver_content,expiry_days,minor_age_threshold,version,fields_config&order=version.desc,created_at.desc',
            function (err, rows) {
              var latestTemplates = latestTemplatesByKey(!err && rows ? rows : []);
              state.stationMode = state.settings && state.settings.waiver_station_mode === 'multi' ? 'multi' : 'single';
              state.templateOptions = buildStationTemplateOptions(latestTemplates, state.settings);
              if (state.stationMode === 'multi' && state.templateOptions.length > 1) {
                setActiveTemplate(null);
                cb();
                return;
              }
              setActiveTemplate(resolveDefaultTemplate(latestTemplates, state.settings, state.templateOptions));
              loadSettings(function () {
                cb();
              });
            }
          );
        });
      });
    });
  }

  function isWaiverExpired(expiresAt) {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  }

  function waiverRowValid(w) {
    if (!w) return false;
    if (w.is_valid === false) return false;
    if (w.expires_at && isWaiverExpired(w.expires_at)) return false;
    return true;
  }

  function waiverPhoneDigits(w) {
    return normalizePhone(w && w.phone_number ? w.phone_number : '');
  }

  function signedAtMs(w) {
    return w && w.signed_at ? new Date(w.signed_at).getTime() : 0;
  }

  function pickLatestWaiver(pool, tid) {
    var filtered = [];
    var i;
    for (i = 0; i < pool.length; i++) {
      if (waiverRowValid(pool[i])) filtered.push(pool[i]);
    }
    if (tid) {
      var same = [];
      for (i = 0; i < filtered.length; i++) {
        if (filtered[i].template_id === tid) same.push(filtered[i]);
      }
      if (same.length) filtered = same;
    }
    filtered.sort(function (a, b) {
      return signedAtMs(b) - signedAtMs(a);
    });
    return filtered[0] || null;
  }

  function searchExistingValidWaiver(digits, cb) {
    var path =
      '/rest/v1/waiver_signatures?business_id=eq.' +
      encodeURIComponent(state.businessId) +
      '&select=id,phone_number,email,customer_id,signed_at,expires_at,is_valid,template_id,signature_token,first_name,last_name&order=signed_at.desc.nullslast&limit=120';
    restGet(path, function (err, rows) {
      var bySig = [];
      var i;
      if (!err && rows && rows.length) {
        for (i = 0; i < rows.length; i++) {
          if (waiverPhoneDigits(rows[i]) === digits) bySig.push(rows[i]);
        }
      }
      rpc('waivers_find_ids_by_additional_adult_phone', { p_business_id: state.businessId, p_normalized_phone: digits }, function (err2, parts) {
        var seen = {};
        var merged = bySig.slice();
        for (i = 0; i < merged.length; i++) seen[merged[i].id] = true;
        var extraIds = [];
        if (!err2 && parts && parts.length) {
          for (i = 0; i < parts.length; i++) {
            if (parts[i].waiver_id && !seen[parts[i].waiver_id]) {
              seen[parts[i].waiver_id] = true;
              extraIds.push(parts[i].waiver_id);
            }
          }
        }
        if (!extraIds.length) {
          merged.sort(function (a, b) {
            return signedAtMs(b) - signedAtMs(a);
          });
          cb(null, pickLatestWaiver(merged, state.templateId), merged);
          return;
        }
        restGet(
          '/rest/v1/waiver_signatures?business_id=eq.' +
            encodeURIComponent(state.businessId) +
            '&id=in.(' +
            extraIds.map(encodeURIComponent).join(',') +
            ')&select=id,phone_number,email,customer_id,signed_at,expires_at,is_valid,template_id,signature_token,first_name,last_name',
          function (err3, more) {
            if (!err3 && more && more.length) {
              for (i = 0; i < more.length; i++) merged.push(more[i]);
            }
            merged.sort(function (a, b) {
              return signedAtMs(b) - signedAtMs(a);
            });
            cb(null, pickLatestWaiver(merged, state.templateId), merged);
          }
        );
      });
    });
  }

  function lookupLoyaltyByPhone(digits, cb) {
    if (!state.businessId || !digits || String(digits).length < 10) {
      cb(null, null);
      return;
    }
    rpc(
      'bookings_get_portal_customer_by_phone',
      { p_business_id: state.businessId, p_phone_number: digits },
      function (err, data) {
        if (err) {
          cb(null, null);
          return;
        }
        var row = firstRpcRowFromPostgrest(data);
        if (row && row.id) {
          cb(null, row);
        } else {
          cb(null, null);
        }
      }
    );
  }

  function lookupLoyaltyEmailByCustomerId(customerId, cb) {
    if (!customerId) {
      cb(null);
      return;
    }
    restGet(
      '/rest/v1/pos_loyalty_accounts?id=eq.' + encodeURIComponent(customerId) + '&select=id,customer_email&limit=1',
      function (err, rows) {
        if (err || !rows || !rows[0]) {
          cb(null);
          return;
        }
        cb(rows[0].customer_email || null);
      }
    );
  }

  function otpCodeToString(data) {
    if (data == null) return '';
    return String(data).replace(/\D/g, '').slice(0, 6);
  }

  function sendOtpEmail(otpCode, toEmail, phoneDigits, cb) {
    var c = getConfig();
    var url = c.supabaseUrl.replace(/\/$/, '') + '/functions/v1/mail-send';
    var payload = {
      businessId: state.businessId,
      campaignId: 'waiver-otp-' + phoneDigits + '-' + Date.now(),
      contactId: null,
      emailType: 'transactional',
      to: toEmail,
      fromEmail: 'noreply@tavarios.ca',
      fromName: (state.businessName || 'Tavari') + ' - Waiver Verification',
      subject: 'Your Waiver OTP Code - ' + state.businessName,
      text:
        'Your OTP code for waiver signing is: ' +
        otpCode +
        '\n\nThis code will expire in 10 minutes.\n\nIf you did not request this code, please ignore this email.\n\nThank you,\n' +
        state.businessName,
      html:
        '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;line-height:1.6">' +
        '<p>Your OTP code for waiver signing is:</p>' +
        '<div style="font-size:32px;font-weight:bold;text-align:center;padding:20px;background:#f5f5f5;border:2px solid #333;border-radius:8px;margin:20px 0;letter-spacing:8px">' +
        esc(otpCode) +
        '</div>' +
        '<p>This code will expire in 10 minutes.</p>' +
        '</body></html>'
    };
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('apikey', c.anonKey);
    xhr.setRequestHeader('Authorization', 'Bearer ' + c.anonKey);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        cb(null);
        return;
      }
      cb(new Error('Email could not be sent.'));
    };
    xhr.send(JSON.stringify(payload));
  }

  function otpVerifyResultOk(data) {
    if (data == null) return false;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        return false;
      }
    }
    if (Object.prototype.toString.call(data) === '[object Array]' && data.length) {
      data = data[0];
    }
    return !!(data && (data.valid === true || data.valid === 'true' || data.valid === 1 || data.valid === '1'));
  }

  function getLogoHtml() {
    if (!state.businessLogo) return '';
    return '<img class="pw-logo" src="' + esc(state.businessLogo) + '" alt="" />';
  }

  function renderCard(title, subtitle, bodyHtml, compact) {
    if (completionResetTimeout) {
      clearTimeout(completionResetTimeout);
      completionResetTimeout = null;
    }
    app.innerHTML =
      '<div class="pw-card' +
      (compact ? ' pw-card--compact' : '') +
      '">' +
      '<div class="pw-header">' +
      getLogoHtml() +
      '<h1 class="pw-title">' +
      esc(title) +
      '</h1>' +
      (subtitle
        ? '<p class="pw-subtitle">' +
          esc(subtitle) +
          '</p>'
        : '') +
      '</div>' +
      '<div class="pw-body">' +
      bodyHtml +
      '</div>' +
      '</div>';
  }

  function closeInactivityWarningModal() {
    var existing = document.getElementById('pwInactivityModal');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function closeIdleAdOverlay() {
    var existing = document.getElementById('pwIdleAdOverlay');
    if (existing) {
      if (existing._pwIdleCarouselTimer) {
        clearInterval(existing._pwIdleCarouselTimer);
        existing._pwIdleCarouselTimer = null;
      }
      if (existing.parentNode) existing.parentNode.removeChild(existing);
    }
  }

  function refreshIdleAdOverlayIfOpen() {
    var overlay = document.getElementById('pwIdleAdOverlay');
    if (!overlay || !state.idleAds || !state.idleAds.length) return;
    var img = overlay.querySelector('img');
    if (!img) return;
    var ad = state.idleAds[state.idleAdIndex];
    if (ad && ad.imageUrl) {
      img.src = ad.imageUrl;
    }
  }

  function handleIdleAdImageLoadFailure() {
    loadIdleAds(function () {
      if (state.idleAds && state.idleAds.length) {
        refreshIdleAdOverlayIfOpen();
        return;
      }
      closeIdleAdOverlay();
      renderWelcome();
    });
  }

  function initIdleAdRefreshScheduler() {
    if (idleAdRefreshInterval) return;
    idleAdRefreshInterval = setInterval(function () {
      loadIdleAds(function () {
        refreshIdleAdOverlayIfOpen();
      });
    }, KIOSK_IDLE_AD_REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        loadIdleAds(function () {
          refreshIdleAdOverlayIfOpen();
        });
      }
    });
  }

  function renderWelcomeWithIdleAttract() {
    renderWelcome();
    if (state.idleAds && state.idleAds.length) {
      openIdleAdOverlay();
    }
  }

  function clampKioskSlideSeconds(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 8;
    n = Math.round(n);
    if (n < 2) n = 2;
    if (n > 120) n = 120;
    return n;
  }

  function openIdleAdOverlay() {
    closeIdleAdOverlay();
    if (!state.idleAds || !state.idleAds.length) return;

    if (state.idleAds.length === 1) {
      state.idleAdIndex = 0;
    } else {
      state.idleAdIndex = (state.idleAdIndex + 1) % state.idleAds.length;
    }

    var ads = state.idleAds;
    var idx = state.idleAdIndex;
    var slideSec = clampKioskSlideSeconds(
      state.settings && state.settings.waiver_kiosk_ad_slide_seconds
    );
    var slideMs = slideSec * 1000;

    var overlay = document.createElement('div');
    overlay.id = 'pwIdleAdOverlay';
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = '#000';
    overlay.style.zIndex = '99999';
    overlay.style.cursor = 'pointer';
    overlay.style.overflow = 'hidden';

    var img = document.createElement('img');
    img.draggable = false;
    img.style.width = '100vw';
    img.style.height = '100vh';
    img.style.objectFit = 'cover';
    img.style.display = 'block';
    img.style.background = '#000';

    var dotsWrap = document.createElement('div');
    dotsWrap.className = 'pw-idle-control';
    dotsWrap.setAttribute('data-pw-idle-control', '1');
    dotsWrap.style.cssText =
      'position:absolute;left:50%;bottom:5.5rem;transform:translateX(-50%);display:flex;gap:10px;' +
      'align-items:center;z-index:100000;padding:6px 14px;border-radius:999px;background:rgba(0,0,0,0.35)';

    var prompt = document.createElement('div');
    prompt.style.cssText =
      'position:absolute;left:50%;bottom:24px;transform:translateX(-50%);pointer-events:none;' +
      'background:rgba(0,0,0,0.62);color:#fff;padding:14px 22px;border-radius:999px;' +
      'font-size:18px;font-weight:700;text-align:center;max-width:92vw';

    function renderSlide() {
      var ad = ads[idx];
      if (!ad || !ad.imageUrl) return;
      img.onerror = function () {
        handleIdleAdImageLoadFailure();
      };
      img.src = ad.imageUrl;
      img.alt = ad.name || 'Kiosk image';
      var i;
      dotsWrap.innerHTML = '';
      for (i = 0; i < ads.length; i++) {
        (function (dotIndex) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'pw-idle-control';
          b.setAttribute('data-pw-idle-control', '1');
          b.style.cssText =
            'width:12px;height:12px;border-radius:50%;border:2px solid rgba(255,255,255,0.9);cursor:pointer;padding:0;' +
            (dotIndex === idx
              ? 'background:#fff;opacity:1;transform:scale(1.12)'
              : 'background:transparent;opacity:0.55');
          b.onclick = function (ev) {
            if (ev) {
              ev.preventDefault();
              ev.stopPropagation();
            }
            idx = dotIndex;
            restartCarousel();
            renderSlide();
          };
          dotsWrap.appendChild(b);
        })(i);
      }
    }

    function restartCarousel() {
      if (overlay._pwIdleCarouselTimer) {
        clearInterval(overlay._pwIdleCarouselTimer);
        overlay._pwIdleCarouselTimer = null;
      }
      if (ads.length <= 1) return;
      overlay._pwIdleCarouselTimer = setInterval(function () {
        idx = (idx + 1) % ads.length;
        renderSlide();
      }, slideMs);
    }

    function makeArrow(side) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-idle-control';
      btn.setAttribute('data-pw-idle-control', '1');
      btn.setAttribute('aria-label', side === 'left' ? 'Previous image' : 'Next image');
      btn.style.cssText =
        'position:absolute;top:50%;transform:translateY(-50%);' +
        (side === 'left' ? 'left:0;border-radius:0 12px 12px 0' : 'right:0;border-radius:12px 0 0 12px') +
        ';width:min(72px,14vw);height:min(120px,22vh);border:none;background:rgba(0,0,0,0.45);' +
        'color:#fff;font-size:42px;line-height:1;cursor:pointer;z-index:100000;padding:0';
      btn.textContent = side === 'left' ? '\u2039' : '\u203a';
      btn.onclick = function (ev) {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        idx = (idx + (side === 'left' ? -1 : 1) + ads.length) % ads.length;
        restartCarousel();
        renderSlide();
      };
      return btn;
    }

    var idleDismissed = false;
    function dismissIdleAd(event) {
      if (idleDismissed) return;
      idleDismissed = true;
      if (event && event.preventDefault) event.preventDefault();
      if (event && event.stopPropagation) event.stopPropagation();
      closeIdleAdOverlay();
      renderWelcome();
    }

    function maybeDismissFromOverlay(ev) {
      var t = ev && ev.target;
      if (t && t.closest && t.closest('[data-pw-idle-control="1"]')) return;
      dismissIdleAd(ev);
    }

    overlay.appendChild(img);
    if (ads.length > 1) {
      overlay.appendChild(makeArrow('left'));
      overlay.appendChild(makeArrow('right'));
      overlay.appendChild(dotsWrap);
    }
    overlay.appendChild(prompt);
    prompt.textContent = 'Tap anywhere to start your waiver';

    overlay.addEventListener('click', maybeDismissFromOverlay);
    overlay.addEventListener(
      'touchend',
      function (ev) {
        maybeDismissFromOverlay(ev);
      },
      { passive: false }
    );

    document.body.appendChild(overlay);
    renderSlide();
    restartCarousel();
  }

  function bindInactivityListeners() {
    if (inactivityListenersBound) return;
    var handleInteraction = function () {
      if (!inactivityEnabled) return;
      inactivitySecondsRemaining = getActiveInactivityTotalSeconds();
      closeInactivityWarningModal();
    };
    window.addEventListener('mousedown', handleInteraction);
    window.addEventListener('mousemove', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);
    window.addEventListener('touchmove', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    window.addEventListener('scroll', handleInteraction);
    window.addEventListener('click', handleInteraction);
    inactivityListenersBound = true;
  }

  function disableInactivityProtection() {
    inactivityEnabled = false;
    inactivityTimeoutHandler = null;
    inactivitySecondsRemaining = getActiveInactivityTotalSeconds();
    closeInactivityWarningModal();
    if (inactivityInterval) {
      clearInterval(inactivityInterval);
      inactivityInterval = null;
    }
  }

  function triggerInactivityTimeout() {
    var handler = inactivityTimeoutHandler;
    disableInactivityProtection();
    if (typeof handler === 'function') handler();
  }

  function openInactivityWarningModal() {
    var existing = document.getElementById('pwInactivityModal');
    var warningSecondsRemaining =
      inactivitySecondsRemaining > activeWarningSeconds
        ? activeWarningSeconds
        : inactivitySecondsRemaining;
    var progressPercent = Math.max(
      0,
      Math.min(100, (warningSecondsRemaining / activeWarningSeconds) * 100)
    );
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'pwInactivityModal';
      existing.className = 'pw-modal-backdrop';
      document.body.appendChild(existing);
    }
    existing.innerHTML =
      '<div class="pw-modal" role="dialog" aria-modal="true" aria-labelledby="pwInactivityTitle">' +
      '<h2 id="pwInactivityTitle" class="pw-section-title">Session Closing</h2>' +
      '<div class="pw-warning">This waiver screen will close in ' +
      warningSecondsRemaining +
      ' seconds due to inactivity so another guest cannot view personal information.</div>' +
      '<div class="pw-progress-wrap" aria-hidden="true">' +
      '<div class="pw-progress-track"><div class="pw-progress-fill" style="width:' +
      progressPercent +
      '%;"></div></div>' +
      '<div class="pw-progress-label">' +
      warningSecondsRemaining +
      ' second' +
      (warningSecondsRemaining === 1 ? '' : 's') +
      ' remaining</div>' +
      '</div>' +
      '<div class="pw-actions">' +
      '<button id="pwInactivityCloseNow" type="button" class="pw-btn-secondary">End session</button>' +
      '<button id="pwInactivityExtend" type="button" class="pw-btn">Extend session</button>' +
      '</div>' +
      '</div>';
    document.getElementById('pwInactivityCloseNow').onclick = function () {
      triggerInactivityTimeout();
    };
    document.getElementById('pwInactivityExtend').onclick = function () {
      inactivitySecondsRemaining = getActiveInactivityTotalSeconds();
      closeInactivityWarningModal();
    };
  }

  function enableInactivityProtection(onTimeout, opts) {
    opts = opts || {};
    activeIdleSeconds =
      opts.idleSeconds != null ? opts.idleSeconds : INACTIVITY_IDLE_SECONDS;
    activeWarningSeconds =
      opts.warningSeconds != null ? opts.warningSeconds : INACTIVITY_WARNING_SECONDS;
    bindInactivityListeners();
    inactivityEnabled = true;
    inactivityTimeoutHandler = onTimeout;
    inactivitySecondsRemaining = getActiveInactivityTotalSeconds();
    closeInactivityWarningModal();
    if (inactivityInterval) clearInterval(inactivityInterval);
    inactivityInterval = setInterval(function () {
      if (!inactivityEnabled) return;
      inactivitySecondsRemaining -= 1;
      if (inactivitySecondsRemaining <= 0) {
        triggerInactivityTimeout();
        return;
      }
      if (inactivitySecondsRemaining <= activeWarningSeconds) {
        openInactivityWarningModal();
      } else {
        closeInactivityWarningModal();
      }
    }, 1000);
  }

  function handleSensitiveScreenTimeout() {
    closeStationAdminModal();
    resetFlow(true);
  }

  function printCurrentPage() {
    try {
      window.print();
    } catch (e) {}
  }

  /** Anonymous GET requires .../object/public/{bucket}/... ; .../object/waivers/ without /public/ returns 400 in browser. */
  function normalizePublicStorageObjectUrl(url) {
    var s = String(url || '').trim();
    if (!s) return '';
    if (/\/storage\/v1\/object\/public\//i.test(s)) return s;
    if (/\/storage\/v1\/object\/waivers\//i.test(s)) {
      return s.replace(/\/storage\/v1\/object\/waivers\//i, '/storage/v1/object/public/waivers/');
    }
    return s;
  }

  function getSignatureDisplaySrc(signatureUrl, signatureData) {
    var direct = normalizePublicStorageObjectUrl(String(signatureUrl || '').trim());
    if (direct) return direct;
    if (!signatureData) return '';
    if (typeof signatureData === 'string') {
      var trimmed = signatureData.trim();
      if (/^data:/i.test(trimmed)) return trimmed;
      if (/^https?:\/\//i.test(trimmed)) return normalizePublicStorageObjectUrl(trimmed);
      if ((trimmed.charAt(0) === '{' && trimmed.charAt(trimmed.length - 1) === '}') ||
          (trimmed.charAt(0) === '[' && trimmed.charAt(trimmed.length - 1) === ']')) {
        try {
          return getSignatureDisplaySrc('', JSON.parse(trimmed));
        } catch (e) {}
      }
      return '';
    }
    if (typeof signatureData === 'object') {
      var maybeImageUrl = String(signatureData.imageUrl || '').trim();
      if (/^data:/i.test(maybeImageUrl)) return maybeImageUrl;
      if (/^https?:\/\//i.test(maybeImageUrl)) return normalizePublicStorageObjectUrl(maybeImageUrl);
      var maybeImageData = String(signatureData.imageData || '').trim();
      if (/^data:/i.test(maybeImageData)) return maybeImageData;
      if (/^https?:\/\//i.test(maybeImageData)) return normalizePublicStorageObjectUrl(maybeImageData);
      var maybePublicUrl = String(signatureData.publicUrl || signatureData.fileUrl || signatureData.file_url || '').trim();
      if (/^data:/i.test(maybePublicUrl)) return maybePublicUrl;
      if (/^https?:\/\//i.test(maybePublicUrl)) return normalizePublicStorageObjectUrl(maybePublicUrl);
    }
    return '';
  }

  function renderSignatureImageHtml(signatureUrl, altText, signatureData) {
    var src = getSignatureDisplaySrc(signatureUrl, signatureData);
    if (!src) {
      return '<div class="pw-note">No signature image on file.</div>';
    }
    return (
      '<div class="pw-signature-block">' +
      '<img src="' +
      esc(src) +
      '" alt="' +
      esc(altText || 'Signature') +
      '" style="max-width:280px;max-height:120px;border:1px solid #d1d5db;border-radius:8px;background:#fff" crossorigin="anonymous" />' +
      '</div>'
    );
  }

  function getExistingWaiverExpiresAt(waiver) {
    if (!waiver) return null;
    if (waiver.expires_at) return waiver.expires_at;
    var expiryDays = state.settings ? state.settings.default_expiry_days : null;
    if ((expiryDays == null || expiryDays === '') && waiver.waiver_templates && waiver.waiver_templates.expiry_days != null) {
      expiryDays = waiver.waiver_templates.expiry_days;
    }
    expiryDays = parseSettingValue(expiryDays);
    if ((!expiryDays || isNaN(Number(expiryDays)) || Number(expiryDays) <= 0) && waiver.signed_at) {
      expiryDays = 365;
    }
    if (!expiryDays || isNaN(Number(expiryDays)) || Number(expiryDays) <= 0 || !waiver.signed_at) return null;
    var signedAt = new Date(waiver.signed_at);
    if (isNaN(signedAt.getTime())) return null;
    return new Date(signedAt.getTime() + Number(expiryDays) * 24 * 60 * 60 * 1000).toISOString();
  }

  function buildExistingWaiverPrintHtml(waiver, businessName) {
    var rows = waiver && waiver.participants ? waiver.participants : [];
    var waiverText =
      (waiver && waiver.waiver_templates && waiver.waiver_templates.waiver_content) ||
      (state.template && state.template.waiver_content) ||
      '';
    var primaryParticipant = null;
    var participantHtml = '';
    var i;
    for (i = 0; i < rows.length; i++) {
      var rowType = String(rows[i].participant_type || '').toLowerCase();
      if (rowType === 'primary' && !primaryParticipant) primaryParticipant = rows[i];
      participantHtml +=
        '<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;">' +
        '<div><strong>' +
        esc((rows[i].first_name || '') + ' ' + (rows[i].last_name || '')) +
        '</strong> (' +
        esc(rows[i].participant_type || 'participant') +
        ')</div>' +
        '<div style="margin-top:4px;font-size:12px;color:#374151;">Date of birth: ' +
        esc(formatDateOnly(rows[i].date_of_birth)) +
        '</div>' +
        '<div style="margin-top:2px;font-size:12px;color:#374151;">Email: ' +
        esc(rows[i].email || 'Not provided') +
        '</div>' +
        '<div style="margin-top:2px;font-size:12px;color:#374151;">Phone: ' +
        esc(formatPhone(rows[i].phone_number || '')) +
        '</div>' +
        '<div style="margin-top:8px;">' +
        renderSignatureImageHtml(rows[i].signature_image_url, 'Participant signature', rows[i].signature_data) +
        '</div>' +
        '</div>';
    }
    var primarySignatureUrl = (waiver && waiver.signature_image_url) || (primaryParticipant && primaryParticipant.signature_image_url) || '';
    return (
      '<!DOCTYPE html><html><head><meta charset="UTF-8" />' +
      '<title>Signed Waiver</title>' +
      '<style>' +
      'body{font-family:Arial,sans-serif;color:#111827;margin:0;padding:24px;line-height:1.5;}' +
      'h1,h2{margin:0 0 12px 0;} .section{margin-top:24px;} .waiver-body{margin-top:12px;} .waiver-body p{margin:0.5em 0;}' +
      '</style></head><body>' +
      '<div style="border-bottom:2px solid #111827;padding-bottom:12px;margin-bottom:20px;">' +
      '<div style="font-size:22px;font-weight:bold;">' + esc(businessName || state.businessName || 'Business') + '</div>' +
      '<div style="font-size:18px;margin-top:8px;">' + esc((waiver.waiver_templates && (waiver.waiver_templates.waiver_title || waiver.waiver_templates.template_name)) || 'Waiver') + '</div>' +
      '</div>' +
      '<div class="section">' +
      '<h2>Primary signer</h2>' +
      '<div><strong>Name:</strong> ' + esc((waiver.first_name || '') + ' ' + (waiver.last_name || '')) + '</div>' +
      '<div><strong>Email:</strong> ' + esc(waiver.email || 'Not provided') + '</div>' +
      '<div><strong>Phone:</strong> ' + esc(formatPhone(waiver.phone_number || '')) + '</div>' +
      '<div><strong>Date of birth:</strong> ' + esc(formatDateOnly(waiver.date_of_birth || (primaryParticipant && primaryParticipant.date_of_birth))) + '</div>' +
      '<div><strong>Signed:</strong> ' + esc(formatDateTime(waiver.signed_at)) + '</div>' +
      '<div style="margin-top:10px;">' + renderSignatureImageHtml(primarySignatureUrl, 'Primary signature', waiver.signature_data || (primaryParticipant && primaryParticipant.signature_data)) + '</div>' +
      '</div>' +
      '<div class="section"><h2>Waiver content</h2><div class="waiver-body">' + safeHtml(waiverText) + '</div></div>' +
      '<div class="section"><h2>Participants on this waiver</h2>' +
      (participantHtml || '<div>No participant rows were found.</div>') +
      '</div>' +
      '</body></html>'
    );
  }

  function printExistingWaiver(waiver) {
    try {
      var printWindow = window.open('', '_blank');
      if (!printWindow) {
        printCurrentPage();
        return;
      }
      printWindow.document.open();
      printWindow.document.write(buildExistingWaiverPrintHtml(waiver || {}, state.businessName || 'Business'));
      printWindow.document.close();
      printWindow.focus();
      setTimeout(function () {
        try {
          printWindow.print();
        } catch (e) {}
      }, 300);
    } catch (e) {
      printCurrentPage();
    }
  }

  function renderMisconfig() {
    disableInactivityProtection();
    renderCard(
      'Unavailable',
      'This kiosk is missing its Supabase configuration.',
      '<div class="pw-error">Ask your administrator to redeploy this static waiver browser app.</div>',
      true
    );
  }

  function renderNeedStation() {
    disableInactivityProtection();
    renderCard(
      'Station Setup',
      'This tablet needs the business location key before guests can use it.',
      '<div class="pw-form">' +
        '<div class="pw-note">Managers: paste the business ID from the Tavari waiver kiosk screen.</div>' +
        '<div><label class="pw-label">Business ID</label><input id="stationId" class="pw-input" type="text" autocomplete="off" placeholder="Business UUID" /></div>' +
        '<div id="stationMsg"></div>' +
        '<div class="pw-actions"><button id="stationSave" type="button" class="pw-btn">Save and continue</button></div>' +
        '</div>',
      true
    );
    document.getElementById('stationSave').onclick = function () {
      var msg = document.getElementById('stationMsg');
      var value = (document.getElementById('stationId').value || '').trim();
      msg.innerHTML = '';
      if (!looksLikeUuid(value)) {
        msg.innerHTML = '<div class="pw-error">Enter a valid business UUID.</div>';
        return;
      }
      state.businessId = value;
      setStoredStationBusinessId(value);
      loadKioskContext(function () {
        renderWelcome();
      });
    };
  }

  function closeStationAdminModal() {
    var existing = document.getElementById('stationAdminModal');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function ensureStationAdminModal() {
    var wrap = document.getElementById('stationAdminModal');
    if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.id = 'stationAdminModal';
    wrap.className = 'pw-modal-backdrop';
    wrap.onclick = function (e) {
      if (e.target === wrap) closeStationAdminModal();
    };
    document.body.appendChild(wrap);
    return wrap;
  }

  function verifyManagerPin(pinInput, cb) {
    if (!state.businessId) {
      cb(new Error('No location is currently assigned.'));
      return;
    }
    if (!pinInput || String(pinInput).length < 4) {
      cb(new Error('Enter your manager PIN.'));
      return;
    }
    var c = getConfig();
    var xhr = new XMLHttpRequest();
    xhr.open('POST', c.supabaseUrl.replace(/\/$/, '') + '/functions/v1/waiver-manager-pin-verify', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('apikey', c.anonKey);
    xhr.setRequestHeader('Authorization', 'Bearer ' + c.anonKey);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var text = xhr.responseText || '';
      var data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        data = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        cb(new Error((data && data.error) || 'Manager PIN verification failed.'));
        return;
      }
      if (!data || data.verified !== true) {
        cb(new Error('Invalid manager PIN.'));
        return;
      }
      cb(null, data);
    };
    xhr.send(
      JSON.stringify({
        businessId: state.businessId,
        pin: String(pinInput).trim()
      })
    );
  }

  function openStationLocationModal() {
    var wrap = ensureStationAdminModal();
    wrap.innerHTML =
      '<div class="pw-modal" role="dialog" aria-modal="true" aria-labelledby="stationAdminTitle">' +
      '<h2 id="stationAdminTitle" class="pw-section-title">Change Location Key</h2>' +
      '<div class="pw-form">' +
      '<div><label class="pw-label">Location key</label><input id="stationAdminBusinessId" class="pw-input" type="text" autocomplete="off" value="' +
      esc(state.businessId || '') +
      '" placeholder="Business UUID" /></div>' +
      '<div id="stationAdminMsg"></div>' +
      '<div class="pw-actions"><button id="stationAdminCancel" type="button" class="pw-btn-secondary">Cancel</button><button id="stationAdminSave" type="button" class="pw-btn">Save</button></div>' +
      '</div>' +
      '</div>';
    document.getElementById('stationAdminCancel').onclick = closeStationAdminModal;
    document.getElementById('stationAdminSave').onclick = function () {
      var businessEl = document.getElementById('stationAdminBusinessId');
      var msgEl = document.getElementById('stationAdminMsg');
      var saveBtn = document.getElementById('stationAdminSave');
      var nextBusinessId = (businessEl.value || '').trim();
      msgEl.innerHTML = '';
      if (!looksLikeUuid(nextBusinessId)) {
        msgEl.innerHTML = '<div class="pw-error">Enter a valid business UUID.</div>';
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      state.businessId = nextBusinessId;
      clearStoredStationBusinessId();
      setStoredStationBusinessId(nextBusinessId);
      closeStationAdminModal();
      loadKioskContext(function () {
        renderWelcome();
      });
    };
    var businessInput = document.getElementById('stationAdminBusinessId');
    if (businessInput && businessInput.focus) businessInput.focus();
  }

  function openStationAdminModal() {
    if (state.stationLockedFromUrl) return;
    var wrap = ensureStationAdminModal();
    wrap.innerHTML =
      '<div class="pw-modal" role="dialog" aria-modal="true" aria-labelledby="stationAdminTitle">' +
      '<h2 id="stationAdminTitle" class="pw-section-title">Manager Access</h2>' +
      '<div class="pw-form">' +
      '<div><label class="pw-label">Manager PIN</label><input id="stationAdminPin" class="pw-input" type="password" inputmode="numeric" autocomplete="off" placeholder="Enter your manager PIN" /></div>' +
      '<div id="stationAdminMsg"></div>' +
      '<div class="pw-actions"><button id="stationAdminCancel" type="button" class="pw-btn-secondary">Cancel</button><button id="stationAdminContinue" type="button" class="pw-btn">Continue</button></div>' +
      '</div>' +
      '</div>';
    document.getElementById('stationAdminCancel').onclick = closeStationAdminModal;
    document.getElementById('stationAdminContinue').onclick = function () {
      var pinEl = document.getElementById('stationAdminPin');
      var msgEl = document.getElementById('stationAdminMsg');
      var continueBtn = document.getElementById('stationAdminContinue');
      msgEl.innerHTML = '';
      continueBtn.disabled = true;
      continueBtn.textContent = 'Verifying...';
      verifyManagerPin((pinEl.value || '').trim(), function (err) {
        if (err) {
          continueBtn.disabled = false;
          continueBtn.textContent = 'Continue';
          msgEl.innerHTML = '<div class="pw-error">' + esc(err.message || 'Invalid manager PIN.') + '</div>';
          return;
        }
        openStationLocationModal();
      });
    };
    var pinInput = document.getElementById('stationAdminPin');
    if (pinInput && pinInput.focus) pinInput.focus();
  }

  function renderWelcome() {
    closeIdleAdOverlay();
    renderCard(
      'Welcome to ' + state.businessName,
      'Please complete the waiver to continue',
      '<div class="pw-form">' +
        (hasStartableWaiver()
          ? ''
          : '<div class="pw-warning">No active waiver template was found for this business. The kiosk cannot accept new waivers until one is active.</div>') +
        '<div class="pw-actions" style="justify-content:center;">' +
        '<button id="startBtn" type="button" class="pw-btn"' +
        (!hasStartableWaiver() ? ' disabled' : '') +
        '>Start waiver</button>' +
        '</div>' +
        '</div>',
      true
    );
    var startBtn = document.getElementById('startBtn');
    if (startBtn) startBtn.onclick = function () {
      if (state.stationMode === 'multi' && state.templateOptions && state.templateOptions.length > 1) {
        renderTemplateSelect();
        return;
      }
      renderPhone();
    };
    if (!state.stationLockedFromUrl) {
      var logoEl = app.querySelector('.pw-logo');
      if (logoEl) {
        logoEl.className += ' pw-logo-button';
        logoEl.setAttribute('role', 'button');
        logoEl.setAttribute('tabindex', '0');
        logoEl.setAttribute('aria-label', 'Manager access');
        logoEl.onclick = openStationAdminModal;
        logoEl.onkeydown = function (e) {
          var key = e && (e.key || e.keyCode);
          if (key === 'Enter' || key === ' ' || key === 13 || key === 32) {
            if (e && e.preventDefault) e.preventDefault();
            openStationAdminModal();
          }
        };
      }
    }
    enableInactivityProtection(handleSensitiveScreenTimeout);
  }

  function renderTemplateSelect() {
    closeIdleAdOverlay();
    var html =
      '<div class="pw-form">' +
      '<div class="pw-actions pw-template-select-list">';
    var i;
    for (i = 0; i < (state.templateOptions || []).length; i++) {
      var option = state.templateOptions[i];
      html +=
        '<button type="button" class="pw-btn-secondary pw-template-option" data-template-key="' +
        esc(option.templateKey) +
        '" style="width:100%;text-align:center;justify-content:center;font-size:18px;padding:18px 16px;">' +
        esc(option.displayName) +
        '</button>';
    }
    html +=
      '</div>' +
      '<div class="pw-actions" style="justify-content:center;margin-top:16px;">' +
      '<button id="templateSelectBack" type="button" class="pw-btn-secondary">Back</button>' +
      '</div>' +
      '</div>';

    renderCard(
      'Choose Your Activity',
      'Select the activity you are participating in so we can show you the correct waiver.',
      html,
      true
    );

    var buttons = app.querySelectorAll('.pw-template-option');
    for (i = 0; i < buttons.length; i++) {
      buttons[i].onclick = function () {
        var selectedKey = this.getAttribute('data-template-key') || '';
        var selectedOption = null;
        var j;
        for (j = 0; j < (state.templateOptions || []).length; j++) {
          if (String(state.templateOptions[j].templateKey || '') === String(selectedKey)) {
            selectedOption = state.templateOptions[j];
            break;
          }
        }
        if (!selectedOption || !selectedOption.template) return;
        setActiveTemplate(selectedOption.template);
        loadSettings(function () {
          renderPhone();
        });
      };
    }

    var backBtn = document.getElementById('templateSelectBack');
    if (backBtn) backBtn.onclick = function () { renderWelcome(); };
    enableInactivityProtection(handleSensitiveScreenTimeout);
  }

  function resetNewWaiverState() {
    state.participants = [];
    state.currentParticipantIndex = 0;
    state.additionalAdultIntentAcknowledgments = [];
    state.returnToReview = false;
    state.childrenContinueConfirm = false;
    state.participantModal = {
      open: false,
      index: null,
      isNew: false
    };
    state.consentStates = {
      marketing: state.settings.auto_click_marketing !== false,
      photography: false
    };
  }

  function createParticipant(type, defaults) {
    var defaultDob = defaults && defaults.dateOfBirth ? parseIsoDateParts(defaults.dateOfBirth) : null;
    var hasDefaultMarketing = !!(defaults && Object.prototype.hasOwnProperty.call(defaults, 'marketing'));
    var defaultMarketing = hasDefaultMarketing
      ? !!defaults.marketing
      : (type === 'additional_adult' && state.settings.auto_click_marketing !== false);
    return {
      type: type,
      signed: false,
      signatureData: null,
      signedAt: null,
      portalAccess: defaults && Object.prototype.hasOwnProperty.call(defaults, 'portalAccess') ? (defaults.portalAccess || '') : '',
      usePrimaryAddress: defaults && defaults.usePrimaryAddress !== undefined ? !!defaults.usePrimaryAddress : true,
      acknowledgments: {
        waiverTerms: defaults && defaults.waiverTerms ? true : false,
        electronicSignature: defaults && defaults.electronicSignature ? true : false,
        selfSignerConfirmed: defaults && defaults.selfSignerConfirmed ? true : false,
        marketing: defaultMarketing
      },
      data: {
        firstName: defaults && defaults.firstName ? defaults.firstName : '',
        lastName: defaults && defaults.lastName ? defaults.lastName : '',
        dateOfBirth: defaults && defaults.dateOfBirth ? defaults.dateOfBirth : '',
        birthYear: defaults && defaults.birthYear ? String(defaults.birthYear) : defaultDob ? String(defaultDob.y) : '',
        birthMonth: defaults && defaults.birthMonth ? padBirthdatePart(defaults.birthMonth) : defaultDob ? padBirthdatePart(defaultDob.m) : '',
        birthDay: defaults && defaults.birthDay ? padBirthdatePart(defaults.birthDay) : defaultDob ? padBirthdatePart(defaultDob.d) : '',
        phoneNumber: defaults && defaults.phoneNumber ? defaults.phoneNumber : '',
        email: defaults && defaults.email ? defaults.email : '',
        address: defaults && defaults.address ? defaults.address : '',
        city: defaults && defaults.city ? defaults.city : '',
        postalCode: defaults && defaults.postalCode ? defaults.postalCode : '',
        relationshipToMinor: defaults && defaults.relationshipToMinor ? defaults.relationshipToMinor : ''
      }
    };
  }

  function ensureParticipantAcknowledgments(participant) {
    if (!participant) return { waiverTerms: false, electronicSignature: false, selfSignerConfirmed: false, marketing: false };
    if (!participant.acknowledgments) {
      participant.acknowledgments = {
        waiverTerms: false,
        electronicSignature: false,
        selfSignerConfirmed: false,
        marketing: false
      };
    }
    if (!Object.prototype.hasOwnProperty.call(participant.acknowledgments, 'marketing')) {
      participant.acknowledgments.marketing =
        participant.type === 'additional_adult' && state.settings.auto_click_marketing !== false;
    }
    return participant.acknowledgments;
  }

  function getTemplateFieldsConfig() {
    var cfg = (state.template && state.template.fields_config) || {};
    var settingsCfg = (state.settings && state.settings.participant_fields_config) || {};
    var templateParticipantFields = Object.assign({}, cfg.participantFields || {});
    var settingsParticipantFields = Object.assign({}, settingsCfg.participantFields || {});
    var templateMinorFields = Object.assign({}, cfg.minorFields || {});
    var settingsMinorFields = Object.assign({}, settingsCfg.minorFields || {});
    var participantFieldKeys = ['firstName', 'lastName', 'birthdate', 'phoneNumber', 'emailAddress', 'address', 'city', 'postalCode'];
    for (var i = 0; i < participantFieldKeys.length; i += 1) {
      var key = participantFieldKeys[i];
      if (Object.prototype.hasOwnProperty.call(cfg, key) && !Object.prototype.hasOwnProperty.call(templateParticipantFields, key)) {
        templateParticipantFields[key] = cfg[key];
      }
      if (Object.prototype.hasOwnProperty.call(settingsCfg, key) && !Object.prototype.hasOwnProperty.call(settingsParticipantFields, key)) {
        settingsParticipantFields[key] = settingsCfg[key];
      }
    }
    return {
      participantFields: Object.assign(
        {
          firstName: true,
          lastName: true,
          birthdate: true,
          phoneNumber: true,
          emailAddress: true,
          address: true,
          city: true,
          postalCode: true
        },
        templateParticipantFields,
        settingsParticipantFields
      ),
      minorFields: Object.assign({}, templateMinorFields, settingsMinorFields)
    };
  }

  function isParticipantFieldEnabled(participantType, fieldName) {
    var cfg = getTemplateFieldsConfig();
    if (participantType === 'minor') {
      if (fieldName === 'firstName' || fieldName === 'lastName' || fieldName === 'birthdate') {
        return cfg.minorFields[fieldName] !== false;
      }
      return false;
    }
    if (fieldName === 'city') {
      if (Object.prototype.hasOwnProperty.call(cfg.participantFields, 'city')) {
        return !!cfg.participantFields.city;
      }
      return !!cfg.participantFields.address;
    }
    if (fieldName === 'firstName' || fieldName === 'lastName' || fieldName === 'birthdate') {
      return cfg.participantFields[fieldName] !== false;
    }
    return !!cfg.participantFields[fieldName];
  }

  function primaryAddressDefaults() {
    var primary = getPrimaryParticipant();
    return {
      address: (primary && primary.data && primary.data.address) || '',
      city: (primary && primary.data && primary.data.city) || '',
      postalCode: (primary && primary.data && primary.data.postalCode) || ''
    };
  }

  function shouldShowSharedAddressToggle(participant) {
    if (!participant || participant.type !== 'additional_adult') return false;
    if (!isParticipantFieldEnabled(participant.type, 'address') && !isParticipantFieldEnabled(participant.type, 'postalCode')) return false;
    var primaryAddress = primaryAddressDefaults();
    return !!(primaryAddress.address || primaryAddress.city || primaryAddress.postalCode);
  }

  function getFieldValue(id) {
    var el = document.getElementById(id);
    return el ? (el.value || '') : '';
  }

  function syncParticipantFormFields(participant, options) {
    if (!participant) return;
    options = options || {};
    var clearDisabled = !!options.clearDisabled;
    var showFirstName = isParticipantFieldEnabled(participant.type, 'firstName');
    var showLastName = isParticipantFieldEnabled(participant.type, 'lastName');
    var showBirthdate = isParticipantFieldEnabled(participant.type, 'birthdate');
    var showPhone = isParticipantFieldEnabled(participant.type, 'phoneNumber');
    var showEmail = isParticipantFieldEnabled(participant.type, 'emailAddress');
    var showAddress = isParticipantFieldEnabled(participant.type, 'address');
    var showCity = isParticipantFieldEnabled(participant.type, 'city');
    var showPostalCode = isParticipantFieldEnabled(participant.type, 'postalCode');
    var addressToggleEl = document.getElementById('usePrimaryAddress');
    var usePrimaryAddress = !!(addressToggleEl && addressToggleEl.checked);
    var primaryAddress = primaryAddressDefaults();
    participant.usePrimaryAddress = usePrimaryAddress;
    if (showFirstName && document.getElementById('firstName')) {
      participant.data.firstName = getFieldValue('firstName').trim();
    } else if (clearDisabled) {
      participant.data.firstName = '';
    }
    if (showLastName && document.getElementById('lastName')) {
      participant.data.lastName = getFieldValue('lastName').trim();
    } else if (clearDisabled) {
      participant.data.lastName = '';
    }
    if (showBirthdate) {
      participant.data.birthYear = getFieldValue('birthYear').trim();
      participant.data.birthMonth = getFieldValue('birthMonth').trim();
      participant.data.birthDay = getFieldValue('birthDay').trim();
      participant.data.dateOfBirth =
        combineBirthdateParts(participant.data.birthYear, participant.data.birthMonth, participant.data.birthDay) || '';
    } else if (clearDisabled) {
      participant.data.dateOfBirth = '';
      participant.data.birthYear = '';
      participant.data.birthMonth = '';
      participant.data.birthDay = '';
    }
    if (showPhone && document.getElementById('phoneNumber')) {
      participant.data.phoneNumber = normalizePhone(getFieldValue('phoneNumber'));
    } else if (clearDisabled) {
      participant.data.phoneNumber = '';
    }
    if (showEmail && document.getElementById('email')) {
      participant.data.email = getFieldValue('email').trim();
    } else if (clearDisabled) {
      participant.data.email = '';
    }
    if (showAddress && document.getElementById('address')) {
      participant.data.address = usePrimaryAddress ? primaryAddress.address : getFieldValue('address').trim();
    } else if (clearDisabled) {
      participant.data.address = '';
    }
    if (showCity && document.getElementById('city')) {
      participant.data.city = usePrimaryAddress ? primaryAddress.city : getFieldValue('city').trim();
    } else if (clearDisabled) {
      participant.data.city = '';
    }
    if (showPostalCode && document.getElementById('postalCode')) {
      participant.data.postalCode = usePrimaryAddress ? primaryAddress.postalCode : getFieldValue('postalCode').trim();
    } else if (clearDisabled) {
      participant.data.postalCode = '';
    }
    if (participant.type === 'minor') {
      participant.data.relationshipToMinor = '';
    }
    if (participant.type === 'additional_adult' && document.getElementById('portalAccess')) {
      participant.portalAccess = document.getElementById('portalAccess').value || '';
    }
  }

  function bindParticipantFormInputs(participant, rerender) {
    if (document.getElementById('phoneNumber')) {
      document.getElementById('phoneNumber').oninput = function () {
        this.value = formatPhone(this.value);
      };
    }
    if (document.getElementById('usePrimaryAddress')) {
      document.getElementById('usePrimaryAddress').onchange = function () {
        syncParticipantFormFields(participant);
        rerender();
      };
    }
    var birthYearEl = document.getElementById('birthYear');
    var birthMonthEl = document.getElementById('birthMonth');
    var birthDayEl = document.getElementById('birthDay');
    function handleBirthdateChange() {
      syncParticipantFormFields(participant);
      rerender();
    }
    if (birthYearEl) birthYearEl.onchange = handleBirthdateChange;
    if (birthMonthEl) birthMonthEl.onchange = handleBirthdateChange;
    if (birthDayEl) birthDayEl.onchange = handleBirthdateChange;
  }

  function getPrimaryParticipant() {
    return state.participants.length ? state.participants[0] : null;
  }

  function getOrderedParticipants() {
    var primary = [];
    var minors = [];
    var adults = [];
    for (var i = 0; i < state.participants.length; i++) {
      if (state.participants[i].type === 'primary') primary.push(state.participants[i]);
      else if (state.participants[i].type === 'minor') minors.push(state.participants[i]);
      else adults.push(state.participants[i]);
    }
    return primary.concat(minors).concat(adults);
  }

  function participantTitle(p, index) {
    if (!p) return 'Participant';
    if (p.type === 'primary') return 'Primary adult';
    if (p.type === 'minor') return 'Minor #' + index;
    return 'Additional adult';
  }

  function reindexParticipants() {
    for (var i = 0; i < state.participants.length; i++) {
      state.participants[i].index = i;
    }
  }

  function participantHasMeaningfulData(participant) {
    if (!participant) return false;
    if (participant.signed || participant.signatureData) return true;
    if (participant.portalAccess) return true;
    var data = participant.data || {};
    for (var key in data) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
      if (String(data[key] || '').trim() !== '') return true;
    }
    return false;
  }

  function closeParticipantModal(removeIfBlank) {
    var modal = document.getElementById('pwParticipantModal');
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    if (state.participantModal.open && state.participantModal.isNew && removeIfBlank !== false) {
      var participant = state.participants[state.participantModal.index];
      if (participant && !participantHasMeaningfulData(participant)) {
        state.participants.splice(state.participantModal.index, 1);
        reindexParticipants();
      }
    }
    state.participantModal = { open: false, index: null, isNew: false };
    state.currentParticipantIndex = 0;
  }

  function removeParticipantAt(index) {
    var targetIndex = parseInt(index, 10);
    if (isNaN(targetIndex) || targetIndex <= 0 || targetIndex >= state.participants.length) return false;
    state.participants.splice(targetIndex, 1);
    reindexParticipants();
    if (state.participantModal.open) {
      if (state.participantModal.index === targetIndex) {
        closeParticipantModal(false);
      } else if (state.participantModal.index > targetIndex) {
        state.participantModal.index -= 1;
      }
    }
    if (state.currentParticipantIndex >= state.participants.length) {
      state.currentParticipantIndex = state.participants.length - 1;
    }
    if (state.currentParticipantIndex < 0) state.currentParticipantIndex = 0;
    return true;
  }

  function showParticipantEntryRequiredModal(message, onConfirm) {
    showActionModal({
      title: 'Complete this person first',
      message: message || 'Please finish entering the information before continuing.',
      cancelLabel: 'Close',
      confirmLabel: 'OK',
      onConfirm: function () {
        if (typeof onConfirm === 'function') onConfirm();
      }
    });
  }

  /** Large centered modal so kiosk guests notice validation (scroll / agree / consent). */
  function closeBlockingNoticeModal() {
    var el = document.getElementById('pwBlockingNoticeModal');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function showBlockingNoticeModal(title, bodyText, okLabel, onAfterClose) {
    closeBlockingNoticeModal();
    var overlay = document.createElement('div');
    overlay.id = 'pwBlockingNoticeModal';
    overlay.className = 'pw-modal-backdrop';
    overlay.innerHTML =
      '<div class="pw-modal pw-modal--alert" role="alertdialog" aria-modal="true" aria-labelledby="pwBlockingNoticeTitle">' +
      '<h2 id="pwBlockingNoticeTitle">' +
      esc(title || 'Before you continue') +
      '</h2>' +
      '<p class="pw-modal-alert-body">' +
      esc(bodyText || '') +
      '</p>' +
      '<div class="pw-actions pw-modal-alert-actions">' +
      '<button id="pwBlockingNoticeOk" type="button" class="pw-btn pw-btn--alert-ok">' +
      esc(okLabel || 'OK') +
      '</button>' +
      '</div>' +
      '</div>';
    overlay.onclick = function (e) {
      if (e.target === overlay) {
        closeBlockingNoticeModal();
        if (typeof onAfterClose === 'function') onAfterClose();
      }
    };
    document.body.appendChild(overlay);
    document.getElementById('pwBlockingNoticeOk').onclick = function () {
      closeBlockingNoticeModal();
      if (typeof onAfterClose === 'function') onAfterClose();
    };
    try {
      document.getElementById('pwBlockingNoticeOk').focus();
    } catch (e) {}
  }

  function showActionModal(options) {
    var existing = document.getElementById('pwActionModal');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var overlay = document.createElement('div');
    overlay.id = 'pwActionModal';
    overlay.className = 'pw-modal-backdrop';
    var checkboxHtml = options.checkboxLabel
      ? '<label class="pw-check" style="margin:16px 0;"><input id="pwActionModalCheck" type="checkbox" /><span>' + esc(options.checkboxLabel) + '</span></label><div id="pwActionModalMsg"></div>'
      : '';
    overlay.innerHTML =
      '<div class="pw-modal pw-modal--wide" role="dialog" aria-modal="true">' +
      '<h2>' + esc(options.title || 'Confirm') + '</h2>' +
      '<p style="margin:0 0 12px 0;line-height:1.6;color:#111827;">' + esc(options.message || '') + '</p>' +
      checkboxHtml +
      '<div class="pw-actions" style="justify-content:flex-end;">' +
      '<button id="pwActionModalCancel" type="button" class="pw-btn-secondary">' + esc(options.cancelLabel || 'Back') + '</button>' +
      '<button id="pwActionModalConfirm" type="button" class="pw-btn">' + esc(options.confirmLabel || 'Continue') + '</button>' +
      '</div>' +
      '</div>';
    overlay.onclick = function (e) {
      if (e.target === overlay) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
    };
    document.body.appendChild(overlay);
    document.getElementById('pwActionModalCancel').onclick = function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };
    document.getElementById('pwActionModalConfirm').onclick = function () {
      if (options.checkboxLabel) {
        var box = document.getElementById('pwActionModalCheck');
        var msg = document.getElementById('pwActionModalMsg');
        if (msg) msg.innerHTML = '';
        if (!box || !box.checked) {
          if (msg) msg.innerHTML = '<div class="pw-error">This confirmation is required before continuing.</div>';
          return;
        }
      }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (typeof options.onConfirm === 'function') options.onConfirm();
    };
  }

  function participantManagementSummaryHtml() {
    if (!state.participants || !state.participants.length) return '';
    var html = '<div class="pw-section"><h2 class="pw-section-title">Added so far</h2>';
    for (var i = 0; i < state.participants.length; i++) {
      var participant = state.participants[i];
      var name = ((participant.data.firstName || '') + ' ' + (participant.data.lastName || '')).replace(/\s+/g, ' ').trim();
      var label = participant.type === 'primary'
        ? 'Primary Adult'
        : participant.type === 'minor'
          ? 'Child'
          : 'Additional Adult';
      html += '<div class="pw-summary-line">' +
        '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">' +
        '<div><strong>' + esc(label) + ':</strong> ' + esc(name || 'Information not entered yet') + '</div>' +
        (participant.type !== 'primary'
          ? '<button type="button" class="pw-link" data-remove-participant-index="' + i + '">Delete</button>'
          : '') +
        '</div>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  function formatPortalAccessLabel(value) {
    var raw = String(value || '').toLowerCase();
    if (raw === 'co_primary') return 'Can view and manage this waiver';
    if (raw === 'full_view') return 'Can view everyone on this waiver';
    if (raw === 'self_only') return 'Can only view their own waiver details';
    return value ? String(value) : 'Not selected';
  }

  function yesNoLabel(value) {
    return value ? 'Yes' : 'No';
  }

  function agreedLabel(value) {
    return value ? 'Agreed' : 'Not Agreed';
  }

  function reviewMetaItem(label, value) {
    return '<div class="pw-review-meta-item"><strong>' + esc(label) + '</strong>' + esc(value || 'Not provided') + '</div>';
  }

  function getExistingPrimaryDefaults(existingWaiver) {
    var waiver = existingWaiver || {};
    var rows = waiver.participants || [];
    var sourceParticipant = null;
    var viewerParticipantId = state.existingWaiverViewerParticipantId != null ? String(state.existingWaiverViewerParticipantId) : null;
    for (var i = 0; i < rows.length; i++) {
      var rowType = String(rows[i].participant_type || '').toLowerCase();
      if (viewerParticipantId && rowType === 'additional_adult' && String(rows[i].id || '') === viewerParticipantId) {
        sourceParticipant = rows[i];
        break;
      }
      if (!sourceParticipant && rowType === 'primary') {
        sourceParticipant = rows[i];
      }
    }
    return {
      firstName: (sourceParticipant && sourceParticipant.first_name) || waiver.first_name || '',
      lastName: (sourceParticipant && sourceParticipant.last_name) || waiver.last_name || '',
      dateOfBirth: (sourceParticipant && sourceParticipant.date_of_birth) || waiver.date_of_birth || '',
      phoneNumber: (sourceParticipant && sourceParticipant.phone_number) || waiver.phone_number || '',
      email: (sourceParticipant && sourceParticipant.email) || waiver.email || '',
      address: (sourceParticipant && sourceParticipant.address) || waiver.address || '',
      city: (sourceParticipant && sourceParticipant.city) || waiver.city || '',
      postalCode: (sourceParticipant && sourceParticipant.postal_code) || waiver.postal_code || ''
    };
  }

  function startNewWaiver(loyaltyRow, existingWaiver) {
    resetNewWaiverState();
    state.customerId = loyaltyRow && loyaltyRow.id ? loyaltyRow.id : null;
    var waiverDefaults = getExistingPrimaryDefaults(existingWaiver);
    var defaults = {
      firstName: waiverDefaults.firstName,
      lastName: waiverDefaults.lastName,
      dateOfBirth: waiverDefaults.dateOfBirth,
      phoneNumber: waiverDefaults.phoneNumber || state.normalizedPhone,
      email: (loyaltyRow && loyaltyRow.customer_email) || waiverDefaults.email || '',
      address: waiverDefaults.address,
      city: waiverDefaults.city,
      postalCode: waiverDefaults.postalCode
    };
    state.participants.push(createParticipant('primary', defaults));
    state.currentParticipantIndex = 0;
    renderParticipantForm();
  }

  function loadExistingWaiverDetails(waiverId, cb) {
    function finalizeWaiver(waiver, participants) {
      waiver.participants = participants || [];
      var access = resolveWaiverViewerAccess(waiver, waiver.participants, state.normalizedPhone);
      state.existingWaiverViewerAccess = access.mode;
      state.existingWaiverViewerParticipantId = access.participantId;
      cb(waiver);
    }
    restGet(
      '/rest/v1/waiver_signatures?id=eq.' +
        encodeURIComponent(waiverId) +
        '&select=id,first_name,last_name,email,phone_number,date_of_birth,address,city,postal_code,signed_at,expires_at,is_valid,template_id,signature_token,signature_image_url,signature_data,waiver_templates(template_name,waiver_title,waiver_content,fields_config,expiry_days)&limit=1',
      function (err, rows) {
        var waiver = !err && rows && rows[0] ? rows[0] : state.existingWaiver;
        restGet(
          '/rest/v1/waiver_participants?waiver_id=eq.' +
            encodeURIComponent(waiverId) +
            '&select=id,participant_type,first_name,last_name,date_of_birth,phone_number,email,address,city,postal_code,signed_at,participant_portal_access,signature_image_url,signature_data&order=created_at.asc',
          function (err2, participants) {
            if (!err2) {
              finalizeWaiver(waiver, participants || []);
              return;
            }
            restGet(
              '/rest/v1/waiver_participants?waiver_id=eq.' +
                encodeURIComponent(waiverId) +
                '&select=*&order=created_at.asc',
              function (fallbackErr, fallbackParticipants) {
                finalizeWaiver(waiver, !fallbackErr && fallbackParticipants ? fallbackParticipants : []);
              }
            );
          }
        );
      }
    );
  }

  function ensureWaiverEmailAccess(waiver, cb) {
    if (waiver && waiver.id && waiver.signature_token) {
      cb(null, waiver);
      return;
    }
    if (!waiver || !waiver.id) {
      cb(new Error('Waiver record is missing.'));
      return;
    }
    restGet(
      '/rest/v1/waiver_signatures?id=eq.' +
        encodeURIComponent(waiver.id) +
        '&select=id,email,signature_token&limit=1',
      function (err, rows) {
        if (err || !rows || !rows[0]) {
          cb(new Error('Could not refresh this waiver record for email delivery.'));
          return;
        }
        waiver.signature_token = rows[0].signature_token || waiver.signature_token || null;
        waiver.email = rows[0].email || waiver.email || null;
        if (!waiver.signature_token) {
          cb(new Error('This waiver cannot be emailed because its signature token is missing.'));
          return;
        }
        cb(null, waiver);
      }
    );
  }

  /** Skip OTP / on-file waiver and start a fresh waiver with the same phone (legacy browser kiosk). */
  function signNewWaiverFromExistingPath() {
    var phone = state.normalizedPhone;
    var digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 10) {
      renderPhone();
      return;
    }
    state.existingWaiver = null;
    state.existingWaiverHistory = [];
    state.existingWaiverViewerAccess = 'signer';
    state.existingWaiverViewerParticipantId = null;
    state.existingWaiverOtpMatch = null;
    state.otpTargetEmail = '';
    lookupLoyaltyByPhone(phone, function (err, loyalty) {
      startNewWaiver(loyalty || null, null);
    });
  }

  function renderPhone() {
    renderCard(
      'Phone Number',
      'Enter your phone number to look for an existing valid waiver or start a new one.',
      '<div class="pw-form">' +
        '<div><label class="pw-label">Phone number</label><input id="phoneInput" class="pw-input" type="tel" inputmode="tel" autocomplete="tel" value="' +
        esc(state.phoneDisplay) +
        '" placeholder="(555) 123-4567" /></div>' +
        '<div id="phoneMsg"></div>' +
        '<div class="pw-actions"><button id="phoneBack" type="button" class="pw-btn-secondary">Back</button><button id="phoneContinue" type="button" class="pw-btn">Continue</button></div>' +
        '</div>',
      true
    );
    enableInactivityProtection(handleSensitiveScreenTimeout);
    var phoneEl = document.getElementById('phoneInput');
    phoneEl.oninput = function () {
      phoneEl.value = formatPhone(phoneEl.value);
    };
    document.getElementById('phoneBack').onclick = function () {
      renderWelcome();
    };
    document.getElementById('phoneContinue').onclick = function () {
      var msg = document.getElementById('phoneMsg');
      var btn = document.getElementById('phoneContinue');
      state.phoneDisplay = phoneEl.value;
      state.normalizedPhone = normalizePhone(phoneEl.value);
      msg.innerHTML = '';
      if (state.normalizedPhone.length < 10) {
        msg.innerHTML = '<div class="pw-error">Enter a valid 10-digit phone number.</div>';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Checking...';
      searchExistingValidWaiver(state.normalizedPhone, function (err, latest, history) {
        if (err) {
          btn.disabled = false;
          btn.textContent = 'Continue';
          msg.innerHTML = '<div class="pw-error">Could not check for an existing waiver. Please try again.</div>';
          return;
        }
        state.existingWaiver = latest;
        state.existingWaiverHistory = history || [];
        if (!latest) {
          lookupLoyaltyByPhone(state.normalizedPhone, function (err2, loyalty) {
            btn.disabled = false;
            btn.textContent = 'Continue';
            startNewWaiver(loyalty, null);
          });
          return;
        }
        loadExistingWaiverDetails(latest.id, function (loadedWaiver) {
          state.existingWaiver = loadedWaiver;
          lookupLoyaltyByPhone(state.normalizedPhone, function (err3, loyalty) {
            var route = resolveOtpDeliveryForExistingWaiver(loadedWaiver, loadedWaiver.participants || [], state.normalizedPhone);
            var sendTo = route.email;
            var custId = loyalty && loyalty.id ? loyalty.id : loadedWaiver.customer_id || null;
            state.existingWaiverOtpMatch = route.matched;
            if (route.matched === 'signature' && !sendTo && loyalty && loyalty.customer_email) {
              sendTo = String(loyalty.customer_email).trim();
            }
            function beginOtp() {
            if (!sendTo) {
              btn.disabled = false;
              btn.textContent = 'Continue';
              msg.innerHTML =
                '<div class="pw-error">A valid waiver exists, but there is no email on file for OTP verification. Ask staff for help, or sign a new waiver below.</div>' +
                '<p class="pw-sign-new-hint">Complete a new waiver using this phone number instead.</p>' +
                '<button type="button" id="phoneForceSignNew" class="pw-btn-outline">Sign New Waiver</button>';
              var forceBtn = document.getElementById('phoneForceSignNew');
              if (forceBtn) forceBtn.onclick = function () { signNewWaiverFromExistingPath(); };
              return;
            }
            state.otpTargetEmail = sendTo;
            state.customerId = custId;
            fetchIp(function (ip) {
              rpc(
                'waivers_generate_otp',
                {
                  p_business_id: state.businessId,
                  p_phone_number: state.normalizedPhone,
                  p_email: sendTo,
                  p_customer_id: custId,
                  p_ip_address: ip,
                  p_user_agent: navigator.userAgent || ''
                },
                function (err4, otpRaw) {
                  if (err4) {
                    btn.disabled = false;
                    btn.textContent = 'Continue';
                    msg.innerHTML = '<div class="pw-error">' + esc(err4.message) + '</div>';
                    return;
                  }
                  var otp = otpCodeToString(otpRaw);
                  if (otp.length !== 6) {
                    btn.disabled = false;
                    btn.textContent = 'Continue';
                    msg.innerHTML = '<div class="pw-error">Could not generate an OTP code.</div>';
                    return;
                  }
                  sendOtpEmail(otp, sendTo, state.normalizedPhone, function (mailErr) {
                    btn.disabled = false;
                    btn.textContent = 'Continue';
                    if (mailErr) {
                      msg.innerHTML = '<div class="pw-error">The code was created but the email could not be sent.</div>';
                      return;
                    }
                    renderOtp();
                  });
                }
              );
            });
          }
            if (!sendTo && route.matched === 'signature' && loadedWaiver.customer_id) {
              lookupLoyaltyEmailByCustomerId(loadedWaiver.customer_id, function (email) {
              if (email) sendTo = email;
              beginOtp();
            });
            } else {
              beginOtp();
            }
          });
        });
      });
    };
  }

  function renderOtp() {
    renderCard(
      'Verify Your Identity',
      'Enter the 6-digit code sent to ' + state.otpTargetEmail + '.',
      '<div class="pw-form">' +
        '<div class="pw-success">OTP sent to <strong>' +
        esc(state.otpTargetEmail) +
        '</strong>.</div>' +
        '<div><label class="pw-label">OTP code</label><input id="otpInput" class="pw-otp" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" /></div>' +
        '<div id="otpMsg"></div>' +
        '<div class="pw-actions"><button id="otpBack" type="button" class="pw-btn-secondary">Change phone</button><button id="otpVerify" type="button" class="pw-btn">Verify</button></div>' +
        '<p class="pw-sign-new-hint">Can\'t access your email? You can complete a new waiver using this phone number instead.</p>' +
        '<div class="pw-actions pw-actions--full"><button id="otpSignNew" type="button" class="pw-btn-outline">Sign New Waiver</button></div>' +
        '</div>',
      true
    );
    enableInactivityProtection(handleSensitiveScreenTimeout, {
      idleSeconds: INACTIVITY_OTP_IDLE_SECONDS,
      warningSeconds: INACTIVITY_OTP_WARNING_SECONDS
    });
    document.getElementById('otpSignNew').onclick = function () {
      signNewWaiverFromExistingPath();
    };
    document.getElementById('otpBack').onclick = function () {
      renderPhone();
    };
    document.getElementById('otpInput').oninput = function () {
      this.value = (this.value || '').replace(/\D/g, '').slice(0, 6);
    };
    document.getElementById('otpVerify').onclick = function () {
      var btn = document.getElementById('otpVerify');
      var msg = document.getElementById('otpMsg');
      var code = (document.getElementById('otpInput').value || '').replace(/\D/g, '').slice(0, 6);
      msg.innerHTML = '';
      if (code.length !== 6) {
        msg.innerHTML = '<div class="pw-error">Enter the 6-digit code.</div>';
        return;
      }
      btn.disabled = true;
      rpc(
        'waivers_verify_otp',
        {
          p_phone_number: state.normalizedPhone,
          p_otp_code: code,
          p_business_id: state.businessId
        },
        function (err, data) {
          btn.disabled = false;
          if (err) {
            msg.innerHTML = '<div class="pw-error">' + esc(err.message) + '</div>';
            return;
          }
          if (!otpVerifyResultOk(data)) {
            msg.innerHTML = '<div class="pw-error">Invalid OTP code.</div>';
            return;
          }
          loadExistingWaiverDetails(state.existingWaiver.id, function (waiver) {
            state.existingWaiver = waiver;
            renderExistingWaiver();
          });
        }
      );
    };
  }

  function renderExistingWaiver() {
    var waiver = state.existingWaiver || {};
    var rows = waiver.participants || [];
    var history = state.existingWaiverHistory || [];
    var viewerAccess = state.existingWaiverViewerAccess || 'signer';
    var viewerParticipantId = state.existingWaiverViewerParticipantId;
    var isSelfOnly = viewerAccess === 'self_only';
    var canSignNew =
      viewerAccess === 'signer' ||
      viewerAccess === 'co_primary' ||
      viewerAccess === 'full_view' ||
      viewerAccess === 'self_only';
    var canViewFull = !isSelfOnly;
    var tplName =
      (waiver.waiver_templates &&
        (waiver.waiver_templates.template_name || waiver.waiver_templates.waiver_title)) ||
      (state.template && (state.template.template_name || state.template.waiver_title)) ||
      'Waiver';
    var minors = [];
    var additionalAdults = [];
    var primaryAdult = null;
    var selfAdult = null;
    var i;
    for (i = 0; i < rows.length; i++) {
      if (String(rows[i].participant_type || '').toLowerCase() === 'primary') {
        primaryAdult = rows[i];
      }
      if (isMinorParticipant(rows[i])) minors.push(rows[i]);
      if (isAdditionalAdultParticipant(rows[i])) {
        additionalAdults.push(rows[i]);
        if (viewerParticipantId && String(rows[i].id || '') === String(viewerParticipantId)) {
          selfAdult = rows[i];
        }
      }
    }
    var historyHtml = '';
    if (history.length > 1 && !isSelfOnly) {
      historyHtml += '<div class="pw-section"><h2 class="pw-section-title">Signed waivers</h2>';
      historyHtml += '<label class="pw-label">Choose a signed waiver version</label>';
      historyHtml += '<select id="waiverVersionSelect" class="pw-select">';
      for (i = 0; i < history.length; i++) {
        historyHtml +=
          '<option value="' +
          esc(history[i].id) +
          '"' +
          (history[i].id === waiver.id ? ' selected' : '') +
          '>' +
          esc(formatDateTime(history[i].signed_at)) +
          (waiverRowValid(history[i]) ? ' - valid' : ' - expired/inactive') +
          '</option>';
      }
      historyHtml += '</select></div>';
    }
    var peopleHtml = '';
    var primaryAdultDob = waiver.date_of_birth || (primaryAdult && primaryAdult.date_of_birth) || null;
    var primarySignatureUrl = waiver.signature_image_url || (primaryAdult && primaryAdult.signature_image_url) || '';
    var resolvedExpiresAt = getExistingWaiverExpiresAt(waiver);
    if (isSelfOnly) {
      peopleHtml += '<div class="pw-section"><h2 class="pw-section-title">Your information</h2>';
      if (selfAdult) {
        peopleHtml +=
          '<div class="pw-meta">' +
          '<div><strong>Name</strong>' + esc((selfAdult.first_name || '') + ' ' + (selfAdult.last_name || '')) + '</div>' +
          '<div><strong>Email</strong>' + esc(selfAdult.email || 'Not provided') + '</div>' +
          '<div><strong>Phone</strong>' + esc(formatPhone(selfAdult.phone_number || '')) + '</div>' +
          '<div><strong>Date of birth</strong>' + esc(formatDateOnly(selfAdult.date_of_birth)) + '</div>' +
          '</div>';
      } else {
        peopleHtml += '<div class="pw-warning">Your phone was verified, but your additional-adult participant row could not be found.</div>';
      }
      peopleHtml +=
        '<div class="pw-note">' +
        (minors.length
          ? minors.length + ' minor' + (minors.length === 1 ? '' : 's') + ' are on this waiver, but their names are hidden for privacy.'
          : 'No minors are listed on this waiver.') +
        '</div></div>';
      peopleHtml +=
        '<div class="pw-section"><h2 class="pw-section-title">Your signature on file</h2>' +
        renderSignatureImageHtml(selfAdult && selfAdult.signature_image_url, 'Your signature', selfAdult && selfAdult.signature_data) +
        '</div>';
    } else {
      peopleHtml +=
        '<div class="pw-section"><h2 class="pw-section-title">Primary adult</h2><div class="pw-meta">' +
        '<div><strong>Name</strong>' + esc((waiver.first_name || '') + ' ' + (waiver.last_name || '')) + '</div>' +
        '<div><strong>Email</strong>' + esc(waiver.email || 'Not provided') + '</div>' +
        '<div><strong>Phone</strong>' + esc(formatPhone(waiver.phone_number || '')) + '</div>' +
        '<div><strong>Date of birth</strong>' + esc(formatDateOnly(primaryAdultDob)) + '</div>' +
        '</div></div>';
      peopleHtml +=
        '<div class="pw-section"><h2 class="pw-section-title">Primary signature on file</h2>' +
        renderSignatureImageHtml(primarySignatureUrl, 'Primary signature', waiver.signature_data || (primaryAdult && primaryAdult.signature_data)) +
        '</div>';
      peopleHtml += '<div class="pw-section"><h2 class="pw-section-title">Minors</h2>';
      if (!minors.length) {
        peopleHtml += '<div class="pw-note">No minors are listed on this waiver.</div>';
      } else {
        for (i = 0; i < minors.length; i++) {
          peopleHtml +=
            '<div class="pw-summary-row"><div><strong>' +
            esc((minors[i].first_name || '') + ' ' + (minors[i].last_name || '')) +
            '</strong><div>' +
            esc(formatDateOnly(minors[i].date_of_birth)) +
            '</div></div></div>';
        }
      }
      peopleHtml += '</div>';
      peopleHtml += '<div class="pw-section"><h2 class="pw-section-title">Additional adults</h2>';
      if (!additionalAdults.length) {
        peopleHtml += '<div class="pw-note">No additional adults are listed on this waiver.</div>';
      } else {
        for (i = 0; i < additionalAdults.length; i++) {
          peopleHtml +=
            '<div class="pw-summary-row"><div><strong>' +
            esc((additionalAdults[i].first_name || '') + ' ' + (additionalAdults[i].last_name || '')) +
            '</strong><div>' +
            esc(additionalAdults[i].email || formatPhone(additionalAdults[i].phone_number || '') || 'No contact details') +
            '</div><div>Date of birth: ' +
            esc(formatDateOnly(additionalAdults[i].date_of_birth)) +
            '</div><div>Access: ' +
            esc(formatPortalAccessLabel(additionalAdults[i].participant_portal_access)) +
            '</div>' +
            renderSignatureImageHtml(additionalAdults[i].signature_image_url, 'Additional adult signature', additionalAdults[i].signature_data) +
            '</div></div>';
        }
      }
      peopleHtml += '</div>';
    }
    renderCard(
      isSelfOnly ? 'Your waiver signature on file' : 'Waiver On File',
      isSelfOnly
        ? 'You are listed as an additional adult on this waiver. Other participants are hidden for privacy.'
        : viewerAccess === 'full_view'
        ? 'You can review everyone on this waiver, but starting a new waiver is disabled for this access level.'
        : 'A valid waiver was found for this phone number.',
      '<div class="pw-form">' +
        '<div class="pw-meta">' +
        '<div><strong>Waiver</strong>' +
        esc(tplName) +
        '</div>' +
        '<div><strong>Signed</strong>' +
        esc(formatDateTime(waiver.signed_at)) +
        '</div>' +
        '<div><strong>Expires</strong>' +
        esc(resolvedExpiresAt ? formatDateTime(resolvedExpiresAt) : 'No expiry recorded') +
        '</div>' +
        '<div><strong>Signer</strong>' +
        esc((waiver.first_name || '') + ' ' + (waiver.last_name || '')) +
        '</div>' +
        '</div>' +
        historyHtml +
        peopleHtml +
        (canViewFull
          ? '<div class="pw-section"><h2 class="pw-section-title">Signed waiver text</h2><div class="pw-waiver">' +
            waiverContentHtml((waiver.waiver_templates && waiver.waiver_templates.waiver_content) || (state.template && state.template.waiver_content) || '') +
            '</div><div id="existingEmailMsg"></div><div class="pw-actions" style="margin-top:0.75rem"><button id="existingEmail" type="button" class="pw-btn-secondary">Email This Waiver</button></div></div>'
          : '<div class="pw-note">The full signed document is hidden for this access level so other participants remain private.</div>') +
        '<div class="pw-soft">Use this if the guest only needs check-in. Start a new waiver only when details need to change.</div>' +
        '<div class="pw-actions">' +
        '<button id="existingBack" type="button" class="pw-btn-secondary">Back</button>' +
        (canSignNew ? '<button id="existingNew" type="button" class="pw-btn-secondary">Sign a new waiver</button>' : '') +
        '<button id="existingUse" type="button" class="pw-btn">Use this waiver</button>' +
        '</div>' +
        '</div>'
    );
    enableInactivityProtection(handleSensitiveScreenTimeout);
    document.getElementById('existingBack').onclick = function () {
      renderPhone();
    };
    if (document.getElementById('existingNew')) {
      document.getElementById('existingNew').onclick = function () {
        startNewWaiver(null, waiver);
      };
    }
    if (document.getElementById('waiverVersionSelect')) {
      document.getElementById('waiverVersionSelect').onchange = function () {
        var selectedId = this.value;
        loadExistingWaiverDetails(selectedId, function (selectedWaiver) {
          state.existingWaiver = selectedWaiver;
          renderExistingWaiver();
        });
      };
    }
    if (document.getElementById('existingEmail')) {
      document.getElementById('existingEmail').onclick = function () {
        var btn = document.getElementById('existingEmail');
        var msgEl = document.getElementById('existingEmailMsg');
        if (msgEl) msgEl.innerHTML = '';
        btn.disabled = true;
        btn.textContent = 'Emailing...';
        ensureWaiverEmailAccess(waiver, function (waiverErr, readyWaiver) {
          if (waiverErr) {
            btn.disabled = false;
            btn.textContent = 'Email This Waiver';
            if (msgEl) msgEl.innerHTML = '<div class="pw-error">' + esc(waiverErr.message || 'Could not email this waiver.') + '</div>';
            return;
          }
          callArchiveEmailEndpoint(
            readyWaiver.id,
            readyWaiver.signature_token,
            { sendEmail: true, recipientEmail: state.otpTargetEmail || readyWaiver.email || null },
            function (archiveErr, archiveData) {
              btn.disabled = false;
              btn.textContent = 'Email This Waiver';
              if (!msgEl) return;
              if (archiveErr) {
                msgEl.innerHTML = '<div class="pw-error">' + esc(archiveErr.message || 'Could not email this waiver.') + '</div>';
                return;
              }
              if (archiveData && archiveData.emailed) {
                msgEl.innerHTML = '<div class="pw-success">Waiver emailed successfully to ' + esc(archiveData.recipientEmail || state.otpTargetEmail || readyWaiver.email || 'the address on file') + '.</div>';
                return;
              }
              msgEl.innerHTML = '<div class="pw-warning">The waiver record is available, but no email address is on file for delivery.</div>';
            }
          );
        });
      };
    }
    document.getElementById('existingUse').onclick = function () {
      renderCheckInComplete();
    };
  }

  function renderCheckInComplete() {
    renderCard(
      'Please visit the Admission Desk To Check-in',
      '',
      '<div class="pw-form">' +
        '<div class="pw-actions"><button id="checkInAgain" type="button" class="pw-btn">Start New Waiver</button></div>' +
        '</div>',
      true
    );
    enableInactivityProtection(handleSensitiveScreenTimeout);
    document.getElementById('checkInAgain').onclick = function () {
      resetFlow();
    };
  }

  function callArchiveEmailEndpoint(waiverId, signatureToken, options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = {};
    }
    options = options || {};
    var c = getConfig();
    var xhr = new XMLHttpRequest();
    xhr.open("POST", c.supabaseUrl.replace(/\/$/, "") + "/functions/v1/waiver-archive-email", true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("apikey", c.anonKey);
    xhr.setRequestHeader("Authorization", "Bearer " + c.anonKey);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var text = xhr.responseText || "";
      var data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        cb(null, data || {});
        return;
      }
      cb(new Error((data && data.error) || "Archive/email step failed"), data || null);
    };
    xhr.send(
      JSON.stringify({
        waiverId: waiverId,
        businessId: options.businessId != null && options.businessId !== '' ? options.businessId : state.businessId,
        signatureToken: signatureToken,
        recipientEmail: options.recipientEmail || null,
        sendEmail: options.sendEmail !== false
      })
    );
  }

  function invokeWaiverKioskAtomicSubmit(payload, cb) {
    var c = getConfig();
    var xhr = new XMLHttpRequest();
    xhr.open('POST', c.supabaseUrl.replace(/\/$/, '') + '/functions/v1/waiver-kiosk-atomic-submit', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('apikey', c.anonKey);
    xhr.setRequestHeader('Authorization', 'Bearer ' + c.anonKey);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var text = xhr.responseText || '';
      var data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (eParse) {
        data = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        cb(
          new Error(
            (data && (data.error || data.message)) ||
              (text && text.slice(0, 500)) ||
              'Atomic waiver submit failed (' + xhr.status + ')'
          ),
          null
        );
        return;
      }
      if (!data || data.success !== true) {
        cb(new Error((data && (data.error || data.message)) || 'Atomic waiver submit failed'), null);
        return;
      }
      cb(null, data);
    };
    xhr.send(JSON.stringify(payload));
  }

  function renderMinorCount() {
    renderCard(
      'Who Is Signing?',
      'Tell us how many minors should be included on this waiver before we collect participant details.',
      '<div class="pw-form">' +
        '<div class="pw-note">The primary adult signs for themselves and any minors listed on the waiver.</div>' +
        '<div><label class="pw-label">Number of minors</label><input id="minorCount" class="pw-input" type="number" min="0" max="10" value="0" /></div>' +
        '<div class="pw-actions"><button id="minorBack" type="button" class="pw-btn-secondary">Back</button><button id="minorContinue" type="button" class="pw-btn">Continue</button></div>' +
        '</div>',
      true
    );
    enableInactivityProtection(handleSensitiveScreenTimeout);
    document.getElementById('minorBack').onclick = function () {
      renderPhone();
    };
    document.getElementById('minorContinue').onclick = function () {
      var count = parseInt(document.getElementById('minorCount').value, 10);
      if (isNaN(count) || count < 0) count = 0;
      if (count > 10) count = 10;
      state.participants = [state.participants[0]];
      for (var i = 0; i < count; i++) {
        state.participants.push(createParticipant('minor'));
      }
      state.currentParticipantIndex = count > 0 ? 1 : 0;
      renderParticipantForm();
    };
  }

  function participantFormHtml(p, idx) {
    var ordinal = 1;
    for (var i = 0; i <= idx; i++) {
      if (state.participants[i].type === p.type) ordinal++;
    }
    var showFirstName = isParticipantFieldEnabled(p.type, 'firstName');
    var showLastName = isParticipantFieldEnabled(p.type, 'lastName');
    var showBirthdate = isParticipantFieldEnabled(p.type, 'birthdate');
    var showPhone = isParticipantFieldEnabled(p.type, 'phoneNumber');
    var showEmail = isParticipantFieldEnabled(p.type, 'emailAddress');
    var showAddress = isParticipantFieldEnabled(p.type, 'address');
    var showCity = isParticipantFieldEnabled(p.type, 'city');
    var showPostalCode = isParticipantFieldEnabled(p.type, 'postalCode');
    var showAddressToggle = shouldShowSharedAddressToggle(p);
    var primaryAddress = primaryAddressDefaults();
    var usePrimaryAddress = showAddressToggle && p.usePrimaryAddress !== false;
    var addressValue = usePrimaryAddress ? primaryAddress.address : p.data.address;
    var cityValue = usePrimaryAddress ? primaryAddress.city : p.data.city;
    var postalValue = usePrimaryAddress ? primaryAddress.postalCode : p.data.postalCode;
    var birthdateConstraints = getBirthdateConstraints(p.type);
    return (
      '<div class="pw-form">' +
      '<div class="pw-grid">' +
      (showFirstName
        ? '<div><label class="pw-label">First name</label><input id="firstName" class="pw-input" value="' +
      esc(p.data.firstName) +
      '" /></div>'
        : '') +
      (showLastName
        ? '<div><label class="pw-label">Last name</label><input id="lastName" class="pw-input" value="' +
      esc(p.data.lastName) +
      '" /></div>'
        : '') +
      (showBirthdate ? birthdateFieldHtml(p.type, p.data) : '') +
      (showPhone
        ? '<div><label class="pw-label">Phone number</label><input id="phoneNumber" class="pw-input" type="tel" value="' +
      esc(formatPhone(p.data.phoneNumber)) +
      '" /></div>'
        : '') +
      (showEmail
        ? '<div><label class="pw-label">Email</label><input id="email" class="pw-input" type="email" value="' +
      esc(p.data.email) +
      '" /></div>'
        : '') +
      (showAddressToggle
        ? '<div class="pw-field-full"><label class="pw-check"><input id="usePrimaryAddress" type="checkbox"' +
          (usePrimaryAddress ? ' checked' : '') +
          ' /><span>Use the same mailing address as the primary adult</span></label></div>'
        : '') +
      (showPostalCode
        ? '<div><label class="pw-label">Postal code</label><input id="postalCode" class="pw-input" value="' +
          esc(postalValue) +
          '"' +
          (usePrimaryAddress ? ' readonly' : '') +
          ' /></div>'
        : '') +
      (showAddress
        ? '<div class="pw-field-full"><label class="pw-label">Address</label><input id="address" class="pw-input" value="' +
          esc(addressValue) +
          '"' +
          (usePrimaryAddress ? ' readonly' : '') +
          ' /></div>'
        : '') +
      (showCity
        ? '<div class="pw-field-full"><label class="pw-label">City</label><input id="city" class="pw-input" value="' +
          esc(cityValue) +
          '"' +
          (usePrimaryAddress ? ' readonly' : '') +
          ' /></div>'
        : '') +
      (p.type === 'additional_adult'
        ? '<div class="pw-field-full"><label class="pw-label">Portal access after signing</label><select id="portalAccess" class="pw-select">' +
          '<option value=""' +
          (!p.portalAccess ? ' selected' : '') +
          '>Select portal access</option>' +
          '<option value="co_primary"' +
          (p.portalAccess === 'co_primary' ? ' selected' : '') +
          '>Can view and manage this waiver</option>' +
          '<option value="full_view"' +
          (p.portalAccess === 'full_view' ? ' selected' : '') +
          '>Can view everyone on this waiver</option>' +
          '<option value="self_only"' +
          (p.portalAccess === 'self_only' ? ' selected' : '') +
          '>Can only view their own waiver details</option>' +
          '</select></div>'
        : '') +
      '</div>' +
      '<div id="participantMsg"></div>' +
      '<div class="pw-actions">' +
      '<button id="participantBack" type="button" class="pw-btn-secondary">Back</button>' +
      '<button id="participantContinue" type="button" class="pw-btn">Continue</button>' +
      '</div>' +
      '</div>'
    );
  }

  function renderParticipantForm() {
    var idx = state.currentParticipantIndex;
    var p = state.participants[idx];
    renderCard(
      participantTitle(p, idx),
      'Enter the details for this person before continuing.',
      participantFormHtml(p, idx)
    );
    enableInactivityProtection(handleSensitiveScreenTimeout);
    bindParticipantFormInputs(p, function () {
      renderParticipantForm();
    });
    document.getElementById('participantBack').onclick = function () {
      if (state.returnToReview) {
        state.returnToReview = false;
        renderReview();
        return;
      }
      if (p.type === 'primary') {
        renderPhone();
        return;
      }
      renderAdditionalAdultChoice();
    };
    document.getElementById('participantContinue').onclick = function () {
      var msg = document.getElementById('participantMsg');
      var showFirstName = isParticipantFieldEnabled(p.type, 'firstName');
      var showLastName = isParticipantFieldEnabled(p.type, 'lastName');
      var showBirthdate = isParticipantFieldEnabled(p.type, 'birthdate');
      var showPhone = isParticipantFieldEnabled(p.type, 'phoneNumber');
      var showEmail = isParticipantFieldEnabled(p.type, 'emailAddress');
      var showAddress = isParticipantFieldEnabled(p.type, 'address');
      var showCity = isParticipantFieldEnabled(p.type, 'city');
      var showPostalCode = isParticipantFieldEnabled(p.type, 'postalCode');
      msg.innerHTML = '';
      syncParticipantFormFields(p, { clearDisabled: true });
      if (p.type === 'additional_adult') {
        if (!p.portalAccess) {
          msg.innerHTML = '<div class="pw-error">Portal access is required for each additional adult.</div>';
          return;
        }
      }
      if (showFirstName && !p.data.firstName) {
        msg.innerHTML = '<div class="pw-error">First name is required.</div>';
        return;
      }
      if (showLastName && !p.data.lastName) {
        msg.innerHTML = '<div class="pw-error">Last name is required.</div>';
        return;
      }
      if (showBirthdate && !p.data.dateOfBirth) {
        msg.innerHTML = '<div class="pw-error">Date of birth is required.</div>';
        return;
      }
      if (showBirthdate) {
        var birthdateError = getBirthdateValidationMessage(p.type, p.data.dateOfBirth);
        if (birthdateError) {
          msg.innerHTML = '<div class="pw-error">' + esc(birthdateError) + '</div>';
          return;
        }
      }
      if (showEmail) {
        if (!p.data.email) {
          msg.innerHTML = '<div class="pw-error">Email is required.</div>';
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.data.email)) {
          msg.innerHTML = '<div class="pw-error">Enter a valid email address.</div>';
          return;
        }
      }
      if (showPhone && !p.data.phoneNumber) {
        msg.innerHTML = '<div class="pw-error">Phone number is required.</div>';
        return;
      }
      if (showAddress && !p.data.address) {
        msg.innerHTML = '<div class="pw-error">Address is required.</div>';
        return;
      }
      if (showCity && !p.data.city) {
        msg.innerHTML = '<div class="pw-error">City is required.</div>';
        return;
      }
      if (showPostalCode && !p.data.postalCode) {
        msg.innerHTML = '<div class="pw-error">Postal code is required.</div>';
        return;
      }
      if (p.type === 'primary' && !p.data.phoneNumber) {
        p.data.phoneNumber = state.normalizedPhone;
      }
      if (state.returnToReview) {
        state.returnToReview = false;
        renderReview();
        return;
      }
      if (p.type === 'minor' || p.type === 'primary') {
        renderChildrenChoice();
        return;
      }
      if (p.type === 'additional_adult') {
        renderAgreement();
        return;
      }
      renderSignature();
    };
  }

  function renderParticipantModal(index, isNew) {
    state.currentParticipantIndex = index;
    state.participantModal = {
      open: true,
      index: index,
      isNew: !!isNew
    };
    var participant = state.participants[index];
    var backdrop = document.createElement('div');
    backdrop.className = 'pw-modal-backdrop';
    backdrop.id = 'pwParticipantModal';
    backdrop.innerHTML =
      '<div class="pw-modal pw-modal--wide" role="dialog" aria-modal="true">' +
      '<div class="pw-header">' +
      '<h1 class="pw-title">' + esc(participantTitle(participant, index)) + '</h1>' +
      '</div>' +
      participantFormHtml(participant, index) +
      '</div>';
    backdrop.onclick = function (e) {
      if (e.target === backdrop) {
        closeParticipantModal(true);
      }
    };
    document.body.appendChild(backdrop);
    enableInactivityProtection(handleSensitiveScreenTimeout);
    bindParticipantFormInputs(participant, function () {
      closeParticipantModal(false);
      renderParticipantModal(index, isNew);
    });
    document.getElementById('participantBack').onclick = function () {
      closeParticipantModal(true);
    };
    document.getElementById('participantContinue').onclick = function () {
      var msg = document.getElementById('participantMsg');
      var showFirstName = isParticipantFieldEnabled(participant.type, 'firstName');
      var showLastName = isParticipantFieldEnabled(participant.type, 'lastName');
      var showBirthdate = isParticipantFieldEnabled(participant.type, 'birthdate');
      var showPhone = isParticipantFieldEnabled(participant.type, 'phoneNumber');
      var showEmail = isParticipantFieldEnabled(participant.type, 'emailAddress');
      var showAddress = isParticipantFieldEnabled(participant.type, 'address');
      var showCity = isParticipantFieldEnabled(participant.type, 'city');
      var showPostalCode = isParticipantFieldEnabled(participant.type, 'postalCode');
      msg.innerHTML = '';
      syncParticipantFormFields(participant, { clearDisabled: true });
      if (participant.type === 'additional_adult') {
        if (!participant.portalAccess) {
          msg.innerHTML = '<div class="pw-error">Portal access is required for each additional adult.</div>';
          return;
        }
      }
      if (showFirstName && !participant.data.firstName) {
        msg.innerHTML = '<div class="pw-error">First name is required.</div>';
        return;
      }
      if (showLastName && !participant.data.lastName) {
        msg.innerHTML = '<div class="pw-error">Last name is required.</div>';
        return;
      }
      if (showBirthdate && !participant.data.dateOfBirth) {
        msg.innerHTML = '<div class="pw-error">Date of birth is required.</div>';
        return;
      }
      if (showBirthdate) {
        var participantBirthdateError = getBirthdateValidationMessage(participant.type, participant.data.dateOfBirth);
        if (participantBirthdateError) {
          msg.innerHTML = '<div class="pw-error">' + esc(participantBirthdateError) + '</div>';
          return;
        }
      }
      if (showEmail) {
        if (!participant.data.email) {
          msg.innerHTML = '<div class="pw-error">Email is required.</div>';
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(participant.data.email)) {
          msg.innerHTML = '<div class="pw-error">Enter a valid email address.</div>';
          return;
        }
      }
      if (showPhone && !participant.data.phoneNumber) {
        msg.innerHTML = '<div class="pw-error">Phone number is required.</div>';
        return;
      }
      if (showAddress && !participant.data.address) {
        msg.innerHTML = '<div class="pw-error">Address is required.</div>';
        return;
      }
      if (showCity && !participant.data.city) {
        msg.innerHTML = '<div class="pw-error">City is required.</div>';
        return;
      }
      if (showPostalCode && !participant.data.postalCode) {
        msg.innerHTML = '<div class="pw-error">Postal code is required.</div>';
        return;
      }
      closeParticipantModal(false);
      if (participant.type === 'additional_adult') {
        state.currentParticipantIndex = index;
        renderAgreement();
        return;
      }
      renderChildrenChoice();
    };
  }

  function renderAgreement() {
    var participant = state.participants[state.currentParticipantIndex];
    var acknowledgments = ensureParticipantAcknowledgments(participant);
    if (participant && participant.type === 'additional_adult') {
      acknowledgments.waiverTerms = false;
    }
    var isPrimary = participant && participant.type === 'primary';
    var isAdditionalAdult = participant && participant.type === 'additional_adult';
    var content = waiverContentHtml(state.template && state.template.waiver_content ? state.template.waiver_content : '');
    renderCard(
      isAdditionalAdult ? 'Additional Adult Waiver Review' : 'Read And Agree',
      isAdditionalAdult
        ? 'The additional adult must personally review and agree to the waiver before signing.'
        : 'Scroll through the waiver content and confirm the required acknowledgements.',
      '<div class="pw-form">' +
        '<div class="pw-waiver" id="waiverBox">' +
        (content || '<p>No waiver content is configured for this template.</p>') +
        '</div>' +
        '<div id="scrollMsg" class="pw-note">Scroll to the bottom of the waiver to continue.</div>' +
        '<label class="pw-check"><input id="agreeBox" type="checkbox"' +
        (acknowledgments.waiverTerms ? ' checked' : '') +
        ' /><span id="agreeBoxLabel">I have personally read and understood this waiver, and I agree to its terms and conditions.</span></label>' +
        ((isPrimary || isAdditionalAdult) && (state.settings.auto_click_marketing !== false || (isPrimary && state.settings.require_photography_consent))
          ? '<div class="pw-section">' +
            '<h2 class="pw-section-title">Optional and required consents</h2>' +
            (state.settings.auto_click_marketing !== false
              ? '<label class="pw-check"><input id="marketingConsent" type="checkbox"' +
                ((isAdditionalAdult ? acknowledgments.marketing : state.consentStates.marketing) ? ' checked' : '') +
                ' /><span>Receive marketing communications and updates.</span></label>'
              : '') +
            (isPrimary && state.settings.require_photography_consent
              ? '<label class="pw-check"><input id="photoConsent" type="checkbox"' +
                (state.consentStates.photography ? ' checked' : '') +
                ' /><span>Photography and use of image for promotional purposes.</span></label>'
              : '')
          + '</div>'
          : '') +
        '<div id="agreementMsg"></div>' +
        '<div class="pw-actions"><button id="agreementBack" type="button" class="pw-btn-secondary">Back</button><button id="agreementContinue" type="button" class="pw-btn">Continue to signature</button></div>' +
        '</div>'
    );
    enableInactivityProtection(handleSensitiveScreenTimeout);
    var box = document.getElementById('waiverBox');
    var scrolled = box.scrollHeight <= box.clientHeight + 8;
    var agreeBox = document.getElementById('agreeBox');
    var agreeBoxLabel = document.getElementById('agreeBoxLabel');
    var continueBtn = document.getElementById('agreementContinue');
    if (agreeBox) {
      // Force the checkbox to match the current participant state so old browsers
      // do not carry a checked value forward from a previous signer.
      agreeBox.checked = !!acknowledgments.waiverTerms;
    }
    function syncAgreementUi() {
      if (agreeBox) {
        agreeBox.disabled = !scrolled;
      }
      if (agreeBoxLabel) {
        agreeBoxLabel.style.color = scrolled ? '' : '#9ca3af';
      }
      /* Keep Continue tappable; validation uses modal (scroll / agree / consent). */
      if (continueBtn) {
        continueBtn.disabled = false;
      }
    }
    function updateScroll() {
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 8) {
        scrolled = true;
        document.getElementById('scrollMsg').className = 'pw-success';
        document.getElementById('scrollMsg').innerHTML = 'Waiver content fully reviewed.';
      }
      syncAgreementUi();
    }
    box.onscroll = updateScroll;
    if (agreeBox) {
      if (!scrolled) {
        agreeBox.checked = false;
      }
      agreeBox.onchange = syncAgreementUi;
    }
    updateScroll();
    syncAgreementUi();
    document.getElementById('agreementBack').onclick = function () {
      if (participant && participant.type === 'primary') {
        renderChildrenChoice();
        return;
      }
      renderParticipantModal(state.currentParticipantIndex, false);
    };
    document.getElementById('agreementContinue').onclick = function () {
      var msg = document.getElementById('agreementMsg');
      msg.innerHTML = '';
      var agreed = agreeBox && agreeBox.checked;
      if (!scrolled) {
        var waiverEl = document.getElementById('waiverBox');
        if (waiverEl && waiverEl.scrollIntoView) {
          try {
            waiverEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (e) {
            waiverEl.scrollIntoView(true);
          }
        }
        showBlockingNoticeModal(
          'Read the full waiver first',
          'Scroll through the entire waiver until you reach the bottom. After that, you can check the box and continue.',
          'Got it',
          function () {
            if (waiverEl && waiverEl.focus) {
              try {
                waiverEl.focus();
              } catch (e2) {}
            }
          }
        );
        return;
      }
      if (!agreed) {
        showBlockingNoticeModal(
          'Confirm your agreement',
          'Check the box to confirm you have read and understood this waiver and agree to its terms.',
          'OK'
        );
        return;
      }
      acknowledgments.waiverTerms = true;
      if (isAdditionalAdult && document.getElementById('marketingConsent')) {
        acknowledgments.marketing = !!document.getElementById('marketingConsent').checked;
      }
      if (isPrimary && document.getElementById('marketingConsent')) {
        state.consentStates.marketing = !!document.getElementById('marketingConsent').checked;
      }
      if (isPrimary && document.getElementById('photoConsent')) {
        state.consentStates.photography = !!document.getElementById('photoConsent').checked;
        if (state.settings.require_photography_consent && !state.consentStates.photography) {
          showBlockingNoticeModal(
            'Photography consent required',
            'This location requires a decision about photography and promotional use of images. Please check the photography consent box or speak with staff.',
            'OK'
          );
          return;
        }
      }
      renderSignature();
    };
  }

  function setupSignatureCanvas(canvas, onChange) {
    var ctx = canvas.getContext('2d');
    var drawing = false;
    var dirty = false;
    function resizeCanvas() {
      var ratio = window.devicePixelRatio || 1;
      var width = canvas.clientWidth || 640;
      var height = canvas.clientHeight || 220;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      dirty = false;
      onChange(false);
    }
    function pointFromEvent(e) {
      var rect = canvas.getBoundingClientRect();
      var touch = e.touches && e.touches[0] ? e.touches[0] : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
      };
    }
    function start(e) {
      e.preventDefault();
      var p = pointFromEvent(e);
      drawing = true;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      var p = pointFromEvent(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      if (!dirty) {
        dirty = true;
        onChange(true);
      }
    }
    function end(e) {
      if (!drawing) return;
      e.preventDefault();
      drawing = false;
    }
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end, { passive: false });
    resizeCanvas();
    return {
      clear: resizeCanvas,
      dataUrl: function () {
        return dirty ? canvas.toDataURL('image/png') : '';
      }
    };
  }

  function renderSignature() {
    var participant = state.participants[state.currentParticipantIndex];
    var acknowledgments = ensureParticipantAcknowledgments(participant);
    var label =
      participant.type === 'primary'
        ? 'Primary adult signature'
        : participant.type === 'additional_adult'
        ? 'Additional adult signature'
        : 'Signature';
    renderCard(
      'Sign The Waiver',
      'Use your finger, stylus, or mouse to sign inside the box.',
      '<div class="pw-form">' +
        (participant.type === 'additional_adult'
          ? '<div id="adultSignerWarningModal" style="position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(17,24,39,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;">' +
            '<div style="background:#fff;max-width:640px;width:100%;border-radius:14px;padding:20px;box-shadow:0 25px 50px rgba(0,0,0,0.35);">' +
            '<h2 style="margin:0 0 12px 0;font-size:22px;color:#991b1b;">Important legal warning</h2>' +
            '<p style="margin:0 0 12px 0;color:#111827;line-height:1.6;">The additional adult must be the person who personally reads and signs this waiver.</p>' +
            '<p style="margin:0 0 12px 0;color:#111827;line-height:1.6;">If another person signs on their behalf without authority, that person may assume liability for injuries, wrongdoing, misrepresentation, or any dispute arising from that signature.</p>' +
            '<p style="margin:0 0 16px 0;color:#111827;line-height:1.6;">Only continue if the additional adult is the person using this screen and applying their own signature.</p>' +
            '<label class="pw-check" style="margin-bottom:16px;"><input id="adultSignerConfirm" type="checkbox"' +
            (acknowledgments.selfSignerConfirmed ? ' checked' : '') +
            ' /><span>I confirm the additional adult is the person reviewing and signing this waiver.</span></label>' +
            '<div id="adultSignerWarningMsg"></div>' +
            '<div class="pw-actions" style="margin-top:0;"><button id="adultSignerWarningContinue" type="button" class="pw-btn">Continue</button></div>' +
            '</div></div>'
          : '') +
        '<div class="pw-note"><strong>Signing for:</strong> ' +
        esc(label) +
        '</div>' +
        '<label class="pw-check"><input id="electronicSignatureConsent" type="checkbox"' +
        (acknowledgments.electronicSignature ? ' checked' : '') +
        ' /><span>I agree to use an electronic signature for this waiver and understand it has the same legal effect as a handwritten signature.</span></label>' +
        '<div class="pw-canvas-wrap"><canvas id="signatureCanvas" class="pw-canvas"></canvas></div>' +
        '<div id="signatureMsg"></div>' +
        '<div class="pw-actions">' +
        '<button id="signatureBack" type="button" class="pw-btn-secondary">Back</button>' +
        '<button id="signatureClear" type="button" class="pw-btn-secondary">Clear</button>' +
        '<button id="signatureContinue" type="button" class="pw-btn">Continue</button>' +
        '</div>' +
        '</div>'
    );
    enableInactivityProtection(handleSensitiveScreenTimeout);
    var hasSignature = false;
    var pad = setupSignatureCanvas(document.getElementById('signatureCanvas'), function (dirty) {
      hasSignature = dirty;
    });
    if (document.getElementById('adultSignerWarningContinue')) {
      document.getElementById('adultSignerWarningContinue').onclick = function () {
        var confirmEl = document.getElementById('adultSignerConfirm');
        var warningMsg = document.getElementById('adultSignerWarningMsg');
        if (warningMsg) warningMsg.innerHTML = '';
        if (!confirmEl || !confirmEl.checked) {
          if (warningMsg) warningMsg.innerHTML = '<div class="pw-error">This confirmation is required before the additional adult can sign.</div>';
          return;
        }
        acknowledgments.selfSignerConfirmed = true;
        var modal = document.getElementById('adultSignerWarningModal');
        if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
      };
    }
    document.getElementById('signatureBack').onclick = function () {
      renderAgreement();
    };
    document.getElementById('signatureClear').onclick = function () {
      pad.clear();
      hasSignature = false;
      participant.signatureUploadGeneration = (participant.signatureUploadGeneration || 0) + 1;
      participant.signaturePregenInFlight = false;
      participant.signatureStorageUrl = null;
    };
    document.getElementById('signatureContinue').onclick = function () {
      var msg = document.getElementById('signatureMsg');
      msg.innerHTML = '';
      if (!document.getElementById('electronicSignatureConsent').checked) {
        msg.innerHTML = '<div class="pw-error">Electronic signature consent is required before signing.</div>';
        return;
      }
      if (participant.type === 'additional_adult' && !acknowledgments.selfSignerConfirmed) {
        msg.innerHTML = '<div class="pw-error">The additional adult confirmation must be accepted before signing.</div>';
        return;
      }
      var dataUrl = pad.dataUrl();
      if (!hasSignature || !dataUrl) {
        msg.innerHTML = '<div class="pw-error">Please provide a signature before continuing.</div>';
        return;
      }
      acknowledgments.electronicSignature = true;
      participant.signatureData = dataUrl;
      participant.signed = true;
      participant.signedAt = new Date().toISOString();
      participant.signatureUploadGeneration = (participant.signatureUploadGeneration || 0) + 1;
      var uploadGen = participant.signatureUploadGeneration;
      var uploadIdx = state.currentParticipantIndex;
      var uploadKey =
        participant.type === 'primary' ? 'primary' : 'participant-' + uploadIdx;
      participant.signaturePregenInFlight = true;
      participant.signatureStorageUrl = null;
      uploadSignatureImage(dataUrl, state.businessId, null, uploadKey + '-early', function (pregenErr, preUrl) {
        participant.signaturePregenInFlight = false;
        if (uploadGen !== participant.signatureUploadGeneration) {
          return;
        }
        if (!pregenErr && preUrl) {
          participant.signatureStorageUrl = preUrl;
        }
      });
      if (participant.type === 'primary') {
        renderAdditionalAdultChoice();
        return;
      }
      renderAdditionalAdultChoice();
    };
  }

  function renderChildrenChoice() {
    var activeChildIndex = state.participantModal.open ? state.participantModal.index : null;
    var activeChildParticipant = activeChildIndex != null ? state.participants[activeChildIndex] : null;
    var isInlineChildOpen = !!(state.participantModal.open && activeChildParticipant && activeChildParticipant.type === 'minor');
    var inlineChildEditor = state.participantModal.open && activeChildParticipant && activeChildParticipant.type === 'minor'
      ? '<div id="inlineChildEditor" class="pw-section">' +
        '<h2 class="pw-section-title">' + esc(participantTitle(activeChildParticipant, activeChildIndex)) + '</h2>' +
        participantFormHtml(activeChildParticipant, activeChildIndex) +
        '</div>'
      : '';
    renderCard(
      'Add Children',
      'Add every child who needs a waiver before continuing to the waiver review.',
      '<div class="pw-form">' +
        '<div class="pw-note">Before you continue, make sure every child has been added, including babies and any child who is not playing.</div>' +
        participantManagementSummaryHtml() +
        '<div class="pw-choice-grid">' +
        '<div class="pw-choice"><h3>Add child</h3><p>Add one child at a time so you can build the waiver group as needed.</p><button id="addChildNow" type="button" class="pw-btn" style="width:100%;' + (isInlineChildOpen ? 'opacity:0.6;cursor:not-allowed;' : '') + '"' + (isInlineChildOpen ? ' disabled' : '') + '>Add child</button></div>' +
        '<div class="pw-choice"><h3>Continue to waiver review</h3><p>When all children have been added, continue so the primary adult can review the waiver content.</p><button id="childrenContinue" type="button" class="pw-btn-secondary" style="width:100%;' + (isInlineChildOpen ? 'opacity:0.6;cursor:not-allowed;' : '') + '"' + (isInlineChildOpen ? ' disabled' : '') + '>Continue</button></div>' +
        '</div>' +
        inlineChildEditor +
        '<div class="pw-actions"><button id="participantSetupBack" type="button" class="pw-btn-secondary" style="width:100%;">Back</button></div>' +
        '</div>'
    );
    enableInactivityProtection(handleSensitiveScreenTimeout);
    function bindLegacyTap(id, handler) {
      var el = document.getElementById(id);
      if (!el) return;
      var fired = false;
      var wrapped = function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (fired) return false;
        fired = true;
        setTimeout(function () {
          fired = false;
        }, 400);
        handler();
        return false;
      };
      el.onclick = wrapped;
      el.ontouchend = wrapped;
    }
    bindLegacyTap('participantSetupBack', function () {
      state.childrenContinueConfirm = false;
      closeParticipantModal(true);
      state.currentParticipantIndex = 0;
      renderParticipantForm();
    });
    bindLegacyTap('addChildNow', function () {
      if (isInlineChildOpen) {
        showParticipantEntryRequiredModal('Please finish entering this child before adding another child.', function () {
          var editor = document.getElementById('inlineChildEditor');
          if (editor && editor.scrollIntoView) {
            try {
              editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (e) {
              editor.scrollIntoView(true);
            }
          }
        });
        return;
      }
      var insertIndex = state.participants.length;
      for (var i = 1; i < state.participants.length; i++) {
        if (state.participants[i].type === 'additional_adult') {
          insertIndex = i;
          break;
        }
      }
      state.participants.splice(insertIndex, 0, createParticipant('minor'));
      reindexParticipants();
      state.childrenContinueConfirm = false;
      state.currentParticipantIndex = insertIndex;
      state.participantModal = {
        open: true,
        index: insertIndex,
        isNew: true
      };
      renderChildrenChoice();
    });
    bindLegacyTap('childrenContinue', function () {
      if (isInlineChildOpen) {
        showParticipantEntryRequiredModal('Please finish entering this child before continuing to the waiver review.', function () {
          var editor = document.getElementById('inlineChildEditor');
          if (editor && editor.scrollIntoView) {
            try {
              editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (e) {
              editor.scrollIntoView(true);
            }
          }
        });
        return;
      }
      showActionModal({
        title: 'Have all children been added?',
        message: 'Please confirm that every child has been added, including babies and any child who is not playing.',
        confirmLabel: 'Yes, continue',
        onConfirm: function () {
          state.childrenContinueConfirm = false;
          closeParticipantModal(false);
          state.currentParticipantIndex = 0;
          renderAgreement();
        }
      });
    });
    var removeBtns = app.querySelectorAll('[data-remove-participant-index]');
    for (var r = 0; r < removeBtns.length; r++) {
      removeBtns[r].onclick = function () {
        var removeIndex = parseInt(this.getAttribute('data-remove-participant-index'), 10);
        var participant = state.participants[removeIndex];
        if (!participant || participant.type === 'primary') return;
        var label = participant.type === 'minor' ? 'child' : 'additional adult';
        showActionModal({
          title: 'Delete ' + (participant.type === 'minor' ? 'child' : 'additional adult') + '?',
          message: 'Remove this ' + label + ' from the waiver? You can add them again if needed.',
          cancelLabel: 'Back',
          confirmLabel: 'Delete',
          onConfirm: function () {
            removeParticipantAt(removeIndex);
            renderChildrenChoice();
          }
        });
      };
    }
    if (state.participantModal.open && activeChildParticipant && activeChildParticipant.type === 'minor') {
      bindParticipantFormInputs(activeChildParticipant, function () {
        renderChildrenChoice();
      });
      bindLegacyTap('participantBack', function () {
        closeParticipantModal(true);
        renderChildrenChoice();
      });
      bindLegacyTap('participantContinue', function () {
        var msg = document.getElementById('participantMsg');
        var showFirstName = isParticipantFieldEnabled(activeChildParticipant.type, 'firstName');
        var showLastName = isParticipantFieldEnabled(activeChildParticipant.type, 'lastName');
        var showBirthdate = isParticipantFieldEnabled(activeChildParticipant.type, 'birthdate');
        var showPhone = isParticipantFieldEnabled(activeChildParticipant.type, 'phoneNumber');
        var showEmail = isParticipantFieldEnabled(activeChildParticipant.type, 'emailAddress');
        var showAddress = isParticipantFieldEnabled(activeChildParticipant.type, 'address');
        var showCity = isParticipantFieldEnabled(activeChildParticipant.type, 'city');
        var showPostalCode = isParticipantFieldEnabled(activeChildParticipant.type, 'postalCode');
        msg.innerHTML = '';
        syncParticipantFormFields(activeChildParticipant, { clearDisabled: true });
        if (showFirstName && !activeChildParticipant.data.firstName) {
          msg.innerHTML = '<div class="pw-error">First name is required.</div>';
          return;
        }
        if (showLastName && !activeChildParticipant.data.lastName) {
          msg.innerHTML = '<div class="pw-error">Last name is required.</div>';
          return;
        }
        if (showBirthdate && !activeChildParticipant.data.dateOfBirth) {
          msg.innerHTML = '<div class="pw-error">Date of birth is required.</div>';
          return;
        }
        if (showBirthdate) {
          var childBirthdateError = getBirthdateValidationMessage(activeChildParticipant.type, activeChildParticipant.data.dateOfBirth);
          if (childBirthdateError) {
            msg.innerHTML = '<div class="pw-error">' + esc(childBirthdateError) + '</div>';
            return;
          }
        }
        if (showEmail) {
          if (!activeChildParticipant.data.email) {
            msg.innerHTML = '<div class="pw-error">Email is required.</div>';
            return;
          }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(activeChildParticipant.data.email)) {
            msg.innerHTML = '<div class="pw-error">Enter a valid email address.</div>';
            return;
          }
        }
        if (showPhone && !activeChildParticipant.data.phoneNumber) {
          msg.innerHTML = '<div class="pw-error">Phone number is required.</div>';
          return;
        }
        if (showAddress && !activeChildParticipant.data.address) {
          msg.innerHTML = '<div class="pw-error">Address is required.</div>';
          return;
        }
        if (showCity && !activeChildParticipant.data.city) {
          msg.innerHTML = '<div class="pw-error">City is required.</div>';
          return;
        }
        if (showPostalCode && !activeChildParticipant.data.postalCode) {
          msg.innerHTML = '<div class="pw-error">Postal code is required.</div>';
          return;
        }
        closeParticipantModal(false);
        renderChildrenChoice();
      });
      setTimeout(function () {
        var editor = document.getElementById('inlineChildEditor');
        if (editor && editor.scrollIntoView) {
          try {
            editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch (e) {
            editor.scrollIntoView(true);
          }
        }
      }, 50);
    }
  }

  function renderAdditionalAdultChoice() {
    var hasAdditionalAdults = false;
    for (var i = 0; i < state.participants.length; i++) {
      if (state.participants[i] && state.participants[i].type === 'additional_adult') {
        hasAdditionalAdults = true;
        break;
      }
    }
    renderCard(
      'Add Additional Adults',
      'Add each additional adult who needs to read and sign their own waiver before final submission.',
      '<div class="pw-form">' +
        '<div class="pw-note">Everyone age 18+ requires their own waiver, whether they are playing or not. This includes grandparents, extra parents, and other adults attending.</div>' +
        participantManagementSummaryHtml() +
        '<div class="pw-choice-grid">' +
        '<div class="pw-choice"><h3>Add additional adult</h3><p>Collect that adult&apos;s information, then have them read and sign for themselves.</p><button id="addAdultYes" type="button" class="pw-btn">Add additional adult</button></div>' +
        '<div class="pw-choice"><h3>' + (hasAdditionalAdults ? 'Submit waiver' : 'Continue without additional adult') + '</h3><p>When all adults have been added, continue to the final review before submission.</p><button id="addAdultNo" type="button" class="pw-btn-secondary">' + (hasAdditionalAdults ? 'Submit Waiver' : 'Continue') + '</button></div>' +
        '</div>' +
        '<div class="pw-actions"><button id="participantSetupBack" type="button" class="pw-btn-secondary">Back</button></div>' +
        '</div>'
    );
    enableInactivityProtection(handleSensitiveScreenTimeout);
    document.getElementById('participantSetupBack').onclick = function () {
      state.currentParticipantIndex = 0;
      renderSignature();
    };
    document.getElementById('addAdultYes').onclick = function () {
      showActionModal({
        title: 'Additional adult acknowledgment',
        message: 'The additional adult must be the person who reads and signs their own waiver. If you are filling this out for another adult, you are accepting liability for doing so.',
        checkboxLabel: 'I understand that the additional adult must sign their own waiver, and if I sign for another adult I accept liability.',
        confirmLabel: 'Continue to Additional Adult Info',
        onConfirm: function () {
          state.additionalAdultIntentAcknowledgments.push({
            kind: 'intent_access_ack',
            participant_portal_access: '',
            acknowledged_at: new Date().toISOString(),
            acknowledgment_text: 'The primary signer confirmed that the additional adult must personally read, agree to, and sign the waiver.'
          });
          state.participants.push(createParticipant('additional_adult', { usePrimaryAddress: true, portalAccess: '' }));
          reindexParticipants();
          renderParticipantModal(state.participants.length - 1, true);
        }
      });
    };
    document.getElementById('addAdultNo').onclick = function () {
      showActionModal({
        title: 'Have all adults been added?',
        message: 'Please confirm that every adult has been added, including grandparents, additional parents, and any adult who is not playing.',
        confirmLabel: 'Yes, continue',
        onConfirm: function () {
          state.currentParticipantIndex = 0;
          renderReview();
        }
      });
    };
    var removeBtns = app.querySelectorAll('[data-remove-participant-index]');
    for (var r = 0; r < removeBtns.length; r++) {
      removeBtns[r].onclick = function () {
        var removeIndex = parseInt(this.getAttribute('data-remove-participant-index'), 10);
        var participant = state.participants[removeIndex];
        if (!participant || participant.type === 'primary') return;
        var label = participant.type === 'minor' ? 'child' : 'additional adult';
        showActionModal({
          title: 'Delete ' + label + '?',
          message: 'Remove this ' + label + ' from the waiver? You can add them again if needed.',
          cancelLabel: 'Back',
          confirmLabel: 'Delete',
          onConfirm: function () {
            removeParticipantAt(removeIndex);
            renderAdditionalAdultChoice();
          }
        });
      };
    }
  }

  function renderAdditionalAdultIntent() {
    renderCard(
      'Additional Adult Access',
      'Choose how this additional adult should be able to view the waiver after it is signed.',
      '<div class="pw-form">' +
        '<div><label class="pw-label">Portal access</label><select id="intentAccess" class="pw-select">' +
        '<option value="co_primary">Can view and manage this waiver</option>' +
        '<option value="full_view" selected>Can view everyone on this waiver</option>' +
        '<option value="self_only">Can only view their own waiver details</option>' +
        '</select></div>' +
        '<label class="pw-check"><input id="intentAck" type="checkbox" /><span>I understand this additional adult is being added to the waiver and the selected access level will apply to their portal view.</span></label>' +
        '<div id="intentMsg"></div>' +
        '<div class="pw-actions"><button id="intentBack" type="button" class="pw-btn-secondary">Back</button><button id="intentContinue" type="button" class="pw-btn">Continue</button></div>' +
        '</div>',
      true
    );
    enableInactivityProtection(handleSensitiveScreenTimeout);
    document.getElementById('intentBack').onclick = function () {
      renderAdditionalAdultChoice();
    };
    document.getElementById('intentContinue').onclick = function () {
      var ack = document.getElementById('intentAck').checked;
      var access = document.getElementById('intentAccess').value || 'full_view';
      var msg = document.getElementById('intentMsg');
      msg.innerHTML = '';
      if (!ack) {
        msg.innerHTML = '<div class="pw-error">Please confirm the access choice before continuing.</div>';
        return;
      }
      state.additionalAdultIntentAcknowledgments.push({
        kind: 'intent_access_ack',
        participant_portal_access: access,
        acknowledged_at: new Date().toISOString(),
        acknowledgment_text: 'The primary signer confirmed that the additional adult must personally read, agree to, and sign the waiver.'
      });
      state.participants.push(createParticipant('additional_adult', { portalAccess: access, usePrimaryAddress: true }));
      state.currentParticipantIndex = state.participants.length - 1;
      renderParticipantForm();
    };
  }

  function participantSummaryHtml(p, idx) {
    var name = ((p.data.firstName || '') + ' ' + (p.data.lastName || '')).replace(/\s+/g, ' ').trim() || 'Unnamed';
    var detailsHtml = '';
    var showPhone = isParticipantFieldEnabled(p.type, 'phoneNumber');
    var showEmail = isParticipantFieldEnabled(p.type, 'emailAddress');
    var showAddress = isParticipantFieldEnabled(p.type, 'address');
    var showCity = isParticipantFieldEnabled(p.type, 'city');
    var showPostalCode = isParticipantFieldEnabled(p.type, 'postalCode');
    if (p.type === 'minor') {
      detailsHtml =
        '<div class="pw-review-meta">' +
        reviewMetaItem('First Name', p.data.firstName || '') +
        reviewMetaItem('Last Name', p.data.lastName || '') +
        reviewMetaItem('Date of Birth', p.data.dateOfBirth ? formatDateOnly(p.data.dateOfBirth) : 'Not provided') +
        '</div>';
    } else {
      detailsHtml =
        '<div class="pw-review-meta">' +
        reviewMetaItem('First Name', p.data.firstName || '') +
        reviewMetaItem('Last Name', p.data.lastName || '') +
        reviewMetaItem('Date of Birth', p.data.dateOfBirth ? formatDateOnly(p.data.dateOfBirth) : 'Not provided') +
        (showPhone ? reviewMetaItem('Phone Number', p.data.phoneNumber ? formatPhone(p.data.phoneNumber) : 'Not provided') : '') +
        (showEmail ? reviewMetaItem('Email', p.data.email || '') : '') +
        (showAddress ? reviewMetaItem('Address', p.data.address || '') : '') +
        (showCity ? reviewMetaItem('City', p.data.city || '') : '') +
        (showPostalCode ? reviewMetaItem('Postal Code', p.data.postalCode || '') : '');
      if (p.type === 'additional_adult') {
        detailsHtml +=
          reviewMetaItem('Portal Access', formatPortalAccessLabel(p.portalAccess));
      }
      detailsHtml += '</div>';
    }
    return (
      '<div class="pw-summary-row">' +
      '<div class="pw-summary-header">' +
      '<div>' +
      '<div class="pw-chip">' + esc(p.type === 'primary' ? 'Primary Adult' : p.type === 'minor' ? 'Minor' : 'Additional Adult') + '</div>' +
      '<h3 class="pw-summary-name">' + esc(name) + '</h3>' +
      '</div>' +
      '<div><button type="button" class="pw-link" data-edit-index="' +
      idx +
      '">Edit</button></div>' +
      '</div>' +
      detailsHtml +
      '</div>'
    );
  }

  function renderReview() {
    var html = '<div class="pw-form">';
    html += '<div class="pw-section"><h2 class="pw-section-title">Participants</h2>';
    for (var i = 0; i < state.participants.length; i++) {
      html += participantSummaryHtml(state.participants[i], i);
    }
    html += '</div>';
    html += '<div id="reviewMsg"></div>';
    html += '<div class="pw-actions"><button id="reviewBack" type="button" class="pw-btn-secondary">Back</button><button id="submitWaiver" type="button" class="pw-btn">Submit waiver</button></div>';
    html += '</div>';
    renderCard('Review Waiver', 'Review the participant information below and fix anything that was entered incorrectly before submitting.', html);
    enableInactivityProtection(handleSensitiveScreenTimeout);
    var editBtns = app.querySelectorAll('[data-edit-index]');
    for (i = 0; i < editBtns.length; i++) {
      editBtns[i].onclick = function () {
        state.currentParticipantIndex = parseInt(this.getAttribute('data-edit-index'), 10) || 0;
        state.returnToReview = true;
        renderParticipantForm();
      };
    }
    document.getElementById('reviewBack').onclick = function () {
      state.currentParticipantIndex = 0;
      renderAdditionalAdultChoice();
    };
    document.getElementById('submitWaiver').onclick = function () {
      submitWaiver();
    };
  }

  function computeExpiresAt() {
    var expiryDays = state.settings.default_expiry_days;
    if (!expiryDays && state.template && state.template.expiry_days) expiryDays = state.template.expiry_days;
    expiryDays = parseSettingValue(expiryDays);
    if (!expiryDays || isNaN(expiryDays) || Number(expiryDays) <= 0) return null;
    var signedAt = new Date();
    var expiresAt = new Date(signedAt.getTime() + Number(expiryDays) * 24 * 60 * 60 * 1000);
    return expiresAt.toISOString();
  }

  function createOrGetCustomer(cb) {
    var primary = getPrimaryParticipant();
    if (!primary) {
      cb(null);
      return;
    }
    if (state.customerId) {
      cb(state.customerId);
      return;
    }
    var phoneRaw = primary.data.phoneNumber || state.normalizedPhone || '';
    var digits = normalizePhone(phoneRaw);
    var emailVal = null;
    if (primary.data.email) {
      emailVal = String(primary.data.email).trim().toLowerCase() || null;
    }

    function legacyRestInsertCustomerAccount() {
      var fullName = ((primary.data.firstName || '') + ' ' + (primary.data.lastName || '')).replace(/\s+/g, ' ').trim() || 'Customer';
      restInsert(
        '/rest/v1/pos_loyalty_accounts?select=id',
        {
          business_id: state.businessId,
          customer_name: fullName,
          customer_email: emailVal,
          customer_phone: digits.length >= 10 ? digits : phoneRaw || null,
          is_active: true,
          balance: 0,
          points: 0,
          total_earned: 0,
          total_spent: 0
        },
        function (err2, rows) {
          if (!err2 && rows && rows[0] && rows[0].id) {
            state.customerId = rows[0].id;
            cb(rows[0].id);
            return;
          }
          cb(null);
        }
      );
    }

    lookupLoyaltyByPhone(digits, function (err, existing) {
      if (existing && existing.id) {
        state.customerId = existing.id;
        if (primary.data.email && String(primary.data.email).trim() !== (existing.customer_email || '')) {
          restPatch(
            '/rest/v1/pos_loyalty_accounts?id=eq.' + encodeURIComponent(existing.id),
            { customer_email: emailVal, updated_at: new Date().toISOString() },
            function () {
              cb(existing.id);
            }
          );
          return;
        }
        cb(existing.id);
        return;
      }

      if (digits.length >= 10) {
        rpc(
          'bookings_create_or_get_portal_customer',
          {
            p_business_id: state.businessId,
            p_phone_number: digits,
            p_email: emailVal,
            p_first_name: primary.data.firstName || '',
            p_last_name: primary.data.lastName || '',
            p_city: primary.data.city || null
          },
          function (rpcErr, rpcData) {
            if (!rpcErr) {
              var row = firstRpcRowFromPostgrest(rpcData);
              if (row && row.id) {
                state.customerId = row.id;
                cb(row.id);
                return;
              }
            }
            legacyRestInsertCustomerAccount();
          }
        );
        return;
      }

      legacyRestInsertCustomerAccount();
    });
  }

  function buildConsentRows(waiverId, signedAt) {
    var additionalAdultAcks = buildAdditionalAdultAcknowledgmentSnapshot();
    var rows = [
      {
        waiver_id: waiverId,
        consent_type: 'waiver_terms',
        consent_given: true,
        acknowledged_at: signedAt
      },
      {
        waiver_id: waiverId,
        consent_type: 'electronic_signature',
        consent_given: true,
        acknowledged_at: signedAt
      }
    ];
    if (state.consentStates.marketing != null) {
      rows.push({
        waiver_id: waiverId,
        consent_type: 'marketing',
        consent_given: !!state.consentStates.marketing,
        acknowledged_at: signedAt
      });
    }
    if (state.settings.require_photography_consent || state.consentStates.photography) {
      rows.push({
        waiver_id: waiverId,
        consent_type: 'photography',
        consent_given: !!state.consentStates.photography,
        acknowledged_at: signedAt
      });
    }
    if (additionalAdultAcks.length) {
      rows.push({
        waiver_id: waiverId,
        consent_type: 'additional_adult_intent',
        consent_given: true,
        consent_text: JSON.stringify(additionalAdultAcks),
        acknowledged_at: signedAt
      });
    }
    return rows;
  }

  function buildAdditionalAdultAcknowledgmentSnapshot() {
    var snapshot = [];
    for (var i = 0; i < state.additionalAdultIntentAcknowledgments.length; i++) {
      snapshot.push(state.additionalAdultIntentAcknowledgments[i]);
    }
    for (var j = 0; j < state.participants.length; j++) {
      var participant = state.participants[j];
      if (!participant || participant.type !== 'additional_adult') continue;
      var acks = ensureParticipantAcknowledgments(participant);
      snapshot.push({
        kind: 'adult_signer_ack',
        participant_name: ((participant.data.firstName || '') + ' ' + (participant.data.lastName || '')).replace(/\s+/g, ' ').trim() || 'Additional adult',
        participant_portal_access: participant.portalAccess || null,
        waiver_terms_accepted: !!acks.waiverTerms,
        electronic_signature_accepted: !!acks.electronicSignature,
        marketing_accepted: !!acks.marketing,
        signed_by_self_confirmed: !!acks.selfSignerConfirmed,
        acknowledged_at: participant.signedAt || null
      });
    }
    return snapshot;
  }

  function randomClientSubmissionId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function submitWaiver() {
    var primary = getPrimaryParticipant();
    var msg = document.getElementById('reviewMsg');
    var btn = document.getElementById('submitWaiver');
    msg.innerHTML = '';
    if (!primary || !primary.signatureData) {
      msg.innerHTML = '<div class="pw-error">Primary adult signature is missing.</div>';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    /** No touch events while saving; default inactivity (~30s) would reset the kiosk mid-submit. */
    disableInactivityProtection();
    var submitIp = 'unknown';
    /** Fixed venue: skip browser geolocation on every submit (slow / unreliable on kiosk Wi-Fi). */
    var submitLoc = { source: 'browser_kiosk' };
    fetchIp(function (ip) {
      submitIp = ip || 'unknown';
      flushEarlySignatureUploadsThen(function () {
        state.locationData = submitLoc;
        createOrGetCustomer(function (customerId) {
        rpc('waivers_create_signature_token', { business_uuid: state.businessId }, function (err, signatureToken) {
          if (err || !signatureToken) {
            btn.disabled = false;
            btn.textContent = 'Submit waiver';
            enableInactivityProtection(handleSensitiveScreenTimeout);
            msg.innerHTML = '<div class="pw-error">Could not create a signature token.</div>';
            return;
          }
          var signedAt = new Date().toISOString();
          var clientSubmissionId = randomClientSubmissionId();
          var additionalAdultAcknowledgments = buildAdditionalAdultAcknowledgmentSnapshot();
          var waiverPayload = {
            business_id: state.businessId,
            template_id: state.templateId,
            client_submission_id: clientSubmissionId,
            signature_token: signatureToken,
            first_name: primary.data.firstName,
            last_name: primary.data.lastName,
            date_of_birth: primary.data.dateOfBirth || null,
            phone_number: primary.data.phoneNumber || state.normalizedPhone,
            email: primary.data.email || null,
            address: primary.data.address || null,
            city: primary.data.city || null,
            postal_code: primary.data.postalCode || null,
            is_minor: false,
            is_valid: true,
            signed_at: signedAt,
            expires_at: computeExpiresAt(),
            ip_address: submitIp || 'unknown',
            user_agent: navigator.userAgent || '',
            customer_id: customerId || null,
            signature_data: primary.signatureData,
            signature_image_url: primary.signatureStorageUrl || null,
            location_source: submitLoc && submitLoc.source ? submitLoc.source : 'browser_kiosk',
            location_latitude: submitLoc && submitLoc.latitude != null ? submitLoc.latitude : null,
            location_longitude: submitLoc && submitLoc.longitude != null ? submitLoc.longitude : null,
            location_city: primary.data.city || null,
            location_address: submitLoc && submitLoc.address ? submitLoc.address : null,
            location_postal_code: primary.data.postalCode || null,
            additional_adult_intent_acknowledgments: additionalAdultAcknowledgments
          };
          var usedFallbackAtomic = false;

          function applyArchiveEmailResult(archiveErr, archiveData) {
              if (archiveData && archiveData.deferred) {
                state.archiveEmailStatus = {
                  ok: true,
                  emailed: false,
                  archived: false,
                  pending: true,
                  message: 'Waiver is saved. Email and archiving will finish when the connection is stable.'
                };
                return;
              }
              state.archiveEmailStatus = archiveErr
                ? {
                    ok: false,
                    message: archiveErr.message || 'Archive/email step failed'
                  }
                : {
                    ok: true,
                    emailed: !!(archiveData && archiveData.emailed),
                    archived: !!(archiveData && archiveData.archived)
                  };
              if (usedFallbackAtomic && state.archiveEmailStatus.ok) {
                state.archiveEmailStatus.message =
                  'Saved with compatibility mode because the database is missing the additional adult acknowledgment column.';
              }
            }

            function finalizeParticipantSaveAfterConsents(waiverRowId, participantDbIds, consentsAlreadyInserted) {
              function finishSaveUi() {
                var bestPrimaryUrl = primary.signatureStorageUrl || waiverPayload.signature_image_url || null;
                state.archiveEmailStatus = {
                  ok: true,
                  emailed: false,
                  archived: false,
                  pending: true
                };
                state.existingWaiver = {
                  id: waiverRowId,
                  first_name: primary.data.firstName,
                  last_name: primary.data.lastName,
                  signed_at: signedAt,
                  expires_at: waiverPayload.expires_at,
                  signature_image_url: bestPrimaryUrl,
                  signature_token: signatureToken,
                  email: primary.data.email || null
                };
                if (usedFallbackAtomic) {
                  state.archiveEmailStatus = {
                    ok: true,
                    emailed: false,
                    archived: false,
                    pending: true,
                    message:
                      'Saved with compatibility mode because the database is missing the additional adult acknowledgment column.'
                  };
                }
                btn.disabled = false;
                btn.textContent = 'Submit waiver';
                renderCompletion();
                runBackgroundSignaturePatchesAndArchive(waiverRowId, participantDbIds, signatureToken, primary);
                try {
                  setTimeout(function () {
                    drainOutbox();
                  }, 0);
                } catch (ePulse) {}
                try {
                  setTimeout(function () {
                    drainOutbox();
                  }, 650);
                } catch (ePulse2) {}
              }
              if (consentsAlreadyInserted) {
                finishSaveUi();
                return;
              }
              var consentRows = buildConsentRows(waiverRowId, signedAt);
              restInsert('/rest/v1/waiver_consents?select=id', consentRows, function () {
                finishSaveUi();
              });
            }

            function runBackgroundSignaturePatchesAndArchive(waiverIdLocal, participantDbIds, signatureTokenLocal, primaryParticipant) {
              var pending = 0;
              var archiveStarted = false;
              var participantsStarted = false;
              function pulseDrainOutbox() {
                try {
                  setTimeout(function () {
                    drainOutbox();
                  }, 0);
                } catch (eD) {}
                try {
                  setTimeout(function () {
                    drainOutbox();
                  }, 750);
                } catch (eD2) {}
              }
              function onDeliveryDone() {
                pending--;
                pulseDrainOutbox();
                tryStartArchive();
              }
              function tryStartArchive() {
                if (archiveStarted) return;
                if (pending > 0) return;
                archiveStarted = true;
                callArchiveEmailWithOutbox(
                  waiverIdLocal,
                  signatureTokenLocal,
                  state.businessId,
                  function (err, archiveData) {
                    applyArchiveEmailResult(err, archiveData || {});
                    pulseDrainOutbox();
                  },
                  true
                );
              }
              function kickParticipantUploads() {
                if (participantsStarted) return;
                participantsStarted = true;
                var pj;
                for (pj = 0; pj < state.participants.length; pj++) {
                  if (!state.participants[pj].signatureData) continue;
                  if (state.participants[pj].signatureStorageUrl) continue;
                  var dbId = participantDbIds[pj];
                  if (!dbId) continue;
                  pending++;
                  (function (idx, partId) {
                    resilientSignatureDelivery(
                      {
                        target: 'waiver_participant',
                        rowId: partId,
                        waiverId: waiverIdLocal,
                        businessId: state.businessId,
                        prefix: 'participant-' + idx,
                        dataUrl: state.participants[idx].signatureData
                      },
                      onDeliveryDone,
                      true
                    );
                  })(pj, dbId);
                }
                tryStartArchive();
              }
              if (primaryParticipant.signatureData && !primaryParticipant.signatureStorageUrl) {
                pending++;
                resilientSignatureDelivery(
                  {
                    target: 'waiver_signatures',
                    rowId: waiverIdLocal,
                    waiverId: waiverIdLocal,
                    businessId: state.businessId,
                    prefix: 'primary',
                    dataUrl: primaryParticipant.signatureData
                  },
                  function () {
                    onDeliveryDone();
                    kickParticipantUploads();
                  },
                  true
                );
              } else {
                kickParticipantUploads();
              }
              pulseDrainOutbox();
              tryStartArchive();
            }

            var participantRowsForRpc = [];
            for (var i = 0; i < state.participants.length; i++) {
              var p = state.participants[i];
              participantRowsForRpc.push({
                participant_type: p.type,
                first_name: p.data.firstName || '',
                last_name: p.data.lastName || '',
                date_of_birth: p.data.dateOfBirth || null,
                phone_number: p.data.phoneNumber || null,
                email: p.data.email || null,
                address: p.data.address || null,
                city: p.data.city || null,
                postal_code: p.data.postalCode || null,
                relationship_to_minor: p.type === 'minor' ? p.data.relationshipToMinor || null : null,
                signature_image_url: p.signatureStorageUrl || null,
                signature_data: p.signatureData || null,
                signed_at: p.signed ? p.signedAt || signedAt : null,
                is_required: p.type === 'primary',
                participant_portal_access: p.type === 'additional_adult' ? (p.portalAccess || null) : null
              });
            }

            var consentRowsForRpc = buildConsentRows('00000000-0000-0000-0000-000000000000', signedAt);
            var cjx;
            for (cjx = 0; cjx < consentRowsForRpc.length; cjx++) {
              if (consentRowsForRpc[cjx] && consentRowsForRpc[cjx].waiver_id !== undefined) {
                delete consentRowsForRpc[cjx].waiver_id;
              }
            }

            invokeWaiverKioskAtomicSubmit(
              { waiver: waiverPayload, participants: participantRowsForRpc, consents: consentRowsForRpc },
              function (atomicErr, atomicData) {
                if (atomicErr || !atomicData || !atomicData.waiver_id) {
                  btn.disabled = false;
                  btn.textContent = 'Submit waiver';
                  enableInactivityProtection(handleSensitiveScreenTimeout);
                  msg.innerHTML =
                    '<div class="pw-error">Could not save the waiver. ' +
                    esc(atomicErr && atomicErr.message ? atomicErr.message : (atomicData && atomicData.error) || '') +
                    '</div>';
                  return;
                }
                var waiverRowIdStr = atomicData.waiver_id;
                var participantDbIds = new Array(state.participants.length);
                var rawIds = atomicData.participant_ids;
                if (Array.isArray(rawIds)) {
                  for (var rdi = 0; rdi < rawIds.length && rdi < participantDbIds.length; rdi++) {
                    participantDbIds[rdi] =
                      typeof rawIds[rdi] === 'string' ? rawIds[rdi] : rawIds[rdi] && String(rawIds[rdi]);
                  }
                }
                finalizeParticipantSaveAfterConsents(waiverRowIdStr, participantDbIds, true);
              }
            );
        });
      });
      });
    });
  }

  function renderCompletion() {
    renderCard(
      'Waiver Submitted',
      '',
      '<div class="pw-form">' +
        '<div class="pw-success">Waiver submitted successfully. Please go to the counter to check in.</div>' +
        '<div class="pw-actions"><button id="completionContinue" type="button" class="pw-btn">Continue</button></div>' +
        '</div>' +
        '</div>',
      true
    );
    disableInactivityProtection();
    if (document.getElementById('completionContinue')) {
      document.getElementById('completionContinue').onclick = function () {
        resetFlow(false);
      };
    }
    completionResetTimeout = setTimeout(function () {
      completionResetTimeout = null;
      resetFlow(true);
    }, 10000);
  }

  function resetFlow(showIdleAd) {
    if (completionResetTimeout) {
      clearTimeout(completionResetTimeout);
      completionResetTimeout = null;
    }
    disableInactivityProtection();
    state.phoneDisplay = '';
    state.normalizedPhone = '';
    state.otpTargetEmail = '';
    state.customerId = null;
    state.existingWaiver = null;
    state.existingWaiverHistory = [];
    state.existingWaiverViewerAccess = 'signer';
    state.existingWaiverViewerParticipantId = null;
    state.existingWaiverOtpMatch = null;
    state.locationData = null;
    state.archiveEmailStatus = null;
    resetNewWaiverState();
    renderWelcome();
    if (showIdleAd) {
      openIdleAdOverlay();
    } else {
      closeIdleAdOverlay();
    }
  }

  function isBrowserFullscreen() {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );
  }

  var fullscreenPromptEl = null;
  var fullscreenListenersBound = false;

  function updateFullscreenPromptVisibility() {
    if (!fullscreenPromptEl) return;
    fullscreenPromptEl.style.display = isBrowserFullscreen() ? 'none' : 'block';
  }

  function ensureFullscreenPrompt() {
    if (fullscreenPromptEl) {
      updateFullscreenPromptVisibility();
      return;
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'waiver-kiosk-fullscreen-prompt';
    btn.className = 'waiver-kiosk-fullscreen-prompt';
    btn.textContent = 'Tap for fullscreen (hide browser bars)';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      tryEnterBrowserFullscreen().then(function () {
        setTimeout(updateFullscreenPromptVisibility, 200);
      });
    });
    document.body.appendChild(btn);
    fullscreenPromptEl = btn;
    updateFullscreenPromptVisibility();
  }

  function bindFullscreenChangeListeners() {
    if (fullscreenListenersBound) return;
    fullscreenListenersBound = true;
    document.addEventListener('fullscreenchange', updateFullscreenPromptVisibility);
    document.addEventListener('webkitfullscreenchange', updateFullscreenPromptVisibility);
  }

  function tryEnterBrowserFullscreen() {
    if (isBrowserFullscreen()) return Promise.resolve(true);
    var el = document.documentElement;
    var request =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen;
    if (!request) return Promise.resolve(false);
    try {
      var p = request.call(el);
      if (p && typeof p.then === 'function') {
        return p
          .then(function () {
            return isBrowserFullscreen();
          })
          .catch(function () {
            return false;
          });
      }
      return Promise.resolve(isBrowserFullscreen());
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function bindFullscreenOnFirstInteraction() {
    if (isBrowserFullscreen()) return;
    function once() {
      tryEnterBrowserFullscreen().then(function () {
        updateFullscreenPromptVisibility();
      });
      document.removeEventListener('pointerdown', once, true);
    }
    document.addEventListener('pointerdown', once, true);
  }

  function initKioskFullscreen() {
    document.documentElement.classList.add('pw-kiosk-fullscreen');
    document.body.classList.add('pw-kiosk-fullscreen');
    document.body.style.margin = '0';
    if (app) {
      app.style.overflowY = 'auto';
      app.style.webkitOverflowScrolling = 'touch';
    }
    bindFullscreenChangeListeners();
    tryEnterBrowserFullscreen();
    bindFullscreenOnFirstInteraction();
    ensureFullscreenPrompt();
    setTimeout(function () {
      if (!isBrowserFullscreen()) ensureFullscreenPrompt();
    }, 800);
  }

  function boot() {
    var cfg = getConfig();
    if (!cfg.supabaseUrl || !cfg.anonKey) {
      renderMisconfig();
      return;
    }
    initKioskFullscreen();
    initWaiverNetworkOutbox();
    if (redirectToWaiverSubdomainIfConfigured()) {
      return;
    }
    state.businessId = (getQuery('business') || getQuery('b') || '').trim();
    state.stationLockedFromUrl = looksLikeUuid(state.businessId);
    if (state.stationLockedFromUrl) {
      loadKioskContext(function () {
        initIdleAdRefreshScheduler();
        renderWelcomeWithIdleAttract();
      });
      return;
    }
    state.businessId = getStoredStationBusinessId();
    if (looksLikeUuid(state.businessId)) {
      loadKioskContext(function () {
        initIdleAdRefreshScheduler();
        renderWelcomeWithIdleAttract();
      });
      return;
    }
    renderNeedStation();
  }

  boot();
})();
