(function () {
  var app = document.getElementById('app');
  var cfg = window.__TAVARI_TASK_MANAGER_KIOSK__ || {};
  var state = {
    businessId: getParam('business') || '',
    kioskCode: getParam('code') || '',
    businessName: 'Tavari Task Manager',
    kioskEmployees: [],
    activeEmployee: null,
    activePin: '',
    checklistIntent: null,
    task: null,
    skipReason: '',
    skipScope: 'task',
    skipScopePreview: null,
    checklist: {},
    checklistCategoryId: null,
    checklistTitle: '',
    checklistTasks: [],
    kioskChecklistCategories: [],
    notes: '',
    photoDataUrl: '',
    taskPhotoRequired: false,
    pendingChecklistTaskId: null,
    pendingChecklistPhoto: '',
    message: '',
    error: '',
    peerReviewItems: [],
    peerReviewIndex: 0,
    peerReviewPhotoDataUrl: '',
    pinScreenChecklistCategories: [],
    staffPinRecords: []
  };

  function getParam(name) {
    var match = new RegExp('[?&]' + name + '=([^&]+)').exec(window.location.search);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderTavariCheckboxHtml(inputClass, attrs, checked) {
    return '<label class="tavari-checkbox">' +
      '<input type="checkbox" class="tavari-checkbox-input ' + escapeHtml(inputClass || '') + '" ' +
      (attrs || '') +
      (checked ? ' checked' : '') +
      ' />' +
      '<span class="tavari-checkbox-box" aria-hidden="true"></span>' +
      '</label>';
  }

  function hasChecklistExtraDetails(task) {
    if (task.instructions && String(task.instructions).trim()) return true;
    if (task.checklist && task.checklist.length) return true;
    return false;
  }

  function hasChecklistTaskDetails(task) {
    if (task.description && String(task.description).trim()) return true;
    return hasChecklistExtraDetails(task);
  }

  function renderChecklistItemDescription(task) {
    if (!task.description || !String(task.description).trim()) return '';
    return '<div class="checklist-item-description pre-wrap">' + escapeHtml(task.description) + '</div>';
  }

  function renderChecklistExtraDetailsHtml(task) {
    var html = '';
    if (task.instructions && String(task.instructions).trim()) {
      html += '<div class="checklist-detail-block">' +
        '<div class="checklist-detail-label">Instructions</div>' +
        '<div class="pre-wrap checklist-instructions">' + escapeHtml(task.instructions) + '</div>' +
        '</div>';
    }
    if (task.checklist && task.checklist.length) {
      html += '<div class="checklist-detail-block">' +
        '<div class="checklist-detail-label">Checklist</div>' +
        '<ul class="checklist-subitems">';
      var j;
      for (j = 0; j < task.checklist.length; j += 1) {
        var item = task.checklist[j];
        html += '<li class="pre-wrap">' + escapeHtml(item.label || item) + '</li>';
      }
      html += '</ul></div>';
    }
    return html;
  }

  function renderChecklistTaskDetailsHtml(task) {
    var html = '';
    if (task.description && String(task.description).trim()) {
      html += '<div class="checklist-detail-block">' +
        '<div class="checklist-detail-label">Description</div>' +
        '<div class="pre-wrap">' + escapeHtml(task.description) + '</div>' +
        '</div>';
    }
    html += renderChecklistExtraDetailsHtml(task);
    return html;
  }

  function renderChecklistMoreDetailsButton(detailsId, stacked) {
    var extraClass = stacked ? ' checklistDetailsToggle-stacked' : '';
    return '<button type="button" class="secondary checklistDetailsToggle' + extraClass + '" data-target="' + escapeHtml(detailsId) + '">More Details</button>';
  }

  function renderChecklistDetailsPanel(detailsId, task) {
    return '<div class="checklist-details hidden" id="' + escapeHtml(detailsId) + '">' +
      renderChecklistExtraDetailsHtml(task) +
      '</div>';
  }

  function renderChecklistItemActions(t, isDone, detailsId, hasExtraDetails, showCheckbox) {
    var hasForm = !!(t.required_form_id && !isDone);
    var hasModule = !!(hasModuleLink(t) && !isDone && t.module_link_allowed);
    var showNa = !isDone && showCheckbox;
    if (!hasForm && !hasModule && !hasExtraDetails && !showNa) return '';

    var html = '<div class="checklist-item-action checklist-item-action-stack">';
    if (hasForm) {
      html += '<button type="button" class="primary openChecklistForm" data-task-id="' + escapeHtml(t.task_id) + '" data-form-id="' + escapeHtml(t.required_form_id) + '">Fill form: ' + escapeHtml(t.required_form_title || 'Required form') + '</button>';
    } else if (hasModuleLink(t) && !isDone && t.module_link_allowed) {
      html += '<button type="button" class="secondary openModuleLink" data-task-id="' + escapeHtml(t.task_id) + '" data-path="' + escapeHtml(t.module_link_path) + '">' + escapeHtml(t.module_link_button_label || 'Open linked page') + '</button>';
    }
    if (showNa) {
      html += '<button type="button" class="secondary markChecklistNa" data-task-id="' + escapeHtml(t.task_id) + '">Mark N/A</button>';
    }
    if (hasExtraDetails) {
      html += renderChecklistMoreDetailsButton(detailsId, true);
    }
    html += '</div>';
    return html;
  }

  function renderChecklistItemStatusLabel(t, isDone) {
    if (!isDone) return '';
    if (t.completion_outcome === 'not_applicable') {
      return '<div class="checklist-desc checklist-desc-na">Not applicable <span class="checklist-undo-hint">(uncheck to reopen)</span></div>';
    }
    return '<div class="checklist-desc">Completed <span class="checklist-undo-hint">(uncheck to undo)</span></div>';
  }

  function renderChecklistItemRow(t, isDone, detailsId, hasExtraDetails) {
    var showCheckbox = !(t.required_form_id && !isDone);
    var html = '<div class="checklist-item-row">';

    html += '<div class="checklist-item-check">';
    if (showCheckbox) {
      html += renderTavariCheckboxHtml(
        'checklistComplete',
        'data-task-id="' + escapeHtml(t.task_id) + '" aria-label="' + escapeHtml(t.title) + '"',
        isDone
      );
    } else {
      html += '<span class="checklist-item-check-spacer" aria-hidden="true"></span>';
    }
    html += '</div>';

    html += '<div class="checklist-item-body">' +
      '<div class="checklist-title">' + escapeHtml(t.title) + '</div>' +
      renderChecklistItemDescription(t);
    if (hasModuleLink(t) && !isDone && t.module_link_allowed) {
      html += '<p class="muted checklist-item-hint">Open the page, return here, then check off when done.</p>';
    } else if (hasModuleLink(t) && !isDone && !t.module_link_allowed) {
      html += '<div class="alert checklist-item-alert">Ask a manager to open this page for you.</div>';
    }
    html += renderChecklistItemStatusLabel(t, isDone) +
      '</div>';

    html += renderChecklistItemActions(t, isDone, detailsId, hasExtraDetails, showCheckbox);
    html += '</div>';
    return html;
  }

  function rpc(name, payload, done) {
    if (!cfg.supabaseUrl || !cfg.anonKey) {
      done(new Error('Kiosk is missing Supabase configuration.'));
      return;
    }

    if (!state.businessId && name !== 'task_manager_resolve_kiosk_code') {
      done(new Error('Kiosk is not linked to a business yet.'));
      return;
    }

    var xhr = new XMLHttpRequest();
    var finished = false;
    var timeoutMs = 45000;
    var timer = setTimeout(function () {
      if (finished) return;
      finished = true;
      try { xhr.abort(); } catch (e) { /* ignore */ }
      done(new Error('Request timed out. Check Wi-Fi and tap Refresh.'));
    }, timeoutMs);
    xhr.open('POST', cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + name, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('apikey', cfg.anonKey);
    xhr.setRequestHeader('Authorization', 'Bearer ' + cfg.anonKey);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      var data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch (e) {
        data = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        done(null, data);
        return;
      }
      var message = 'Request failed';
      if (data && data.message) message = data.message;
      else if (typeof data === 'string' && data) message = data;
      else if (xhr.responseText) message = xhr.responseText;
      done(new Error(message));
    };
    xhr.onerror = function () {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done(new Error('Network error. Check your connection and try again.'));
    };
    xhr.send(JSON.stringify(payload || {}));
  }

  function shell(content) {
    app.innerHTML = '<div class="center"><div class="card">' + content + '</div></div>';
    bindScrollOnFocus(app);
  }

  function bindScrollOnFocus(root) {
    if (!root || !root.querySelectorAll) return;
    var fields = root.querySelectorAll('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="file"])');
    var i;
    for (i = 0; i < fields.length; i += 1) {
      fields[i].addEventListener('focus', scrollFocusedFieldIntoView);
    }
  }

  function scrollFocusedFieldIntoView() {
    var field = this;
    setTimeout(function () {
      try {
        field.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (e) {
        field.scrollIntoView(true);
      }
    }, 350);
  }

  function alerts() {
    var html = '';
    if (state.error) html += '<div class="alert error">' + escapeHtml(state.error) + '</div>';
    if (state.message) html += '<div class="alert success">' + escapeHtml(state.message) + '</div>';
    return html;
  }

  function employeeDisplayName(emp) {
    if (!emp) return 'Staff';
    return emp.full_name || emp.first_name || 'Staff';
  }

  function renderEmployeeSelectOptions(selectedId) {
    var html = '<option value="">Select your name…</option>';
    var employees = state.kioskEmployees || [];
    var i;
    for (i = 0; i < employees.length; i += 1) {
      var emp = employees[i];
      html += '<option value="' + escapeHtml(emp.employee_id) + '"' +
        (selectedId && selectedId === emp.employee_id ? ' selected' : '') + '>' +
        escapeHtml(employeeDisplayName(emp)) + '</option>';
    }
    return html;
  }

  function renderPinOnlyPanel(heading, pinFieldId) {
    var html = '<div class="identity-panel">';
    if (heading) {
      html += '<h3>' + escapeHtml(heading) + '</h3>';
    }
    html += '<div class="row"><label>Your PIN</label>' +
      '<input id="' + escapeHtml(pinFieldId) + '" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" /></div>' +
      '</div>';
    return html;
  }

  function renderEmployeeIdentityPanel(heading, employeeFieldId, pinFieldId) {
    return '<div class="identity-panel">' +
      '<h3>' + escapeHtml(heading || 'Who is completing this?') + '</h3>' +
      '<p class="muted">Select your name and enter your PIN so this is recorded under the right person.</p>' +
      '<div class="row"><label>Your name</label>' +
      '<select id="' + escapeHtml(employeeFieldId) + '" class="identity-select">' +
      renderEmployeeSelectOptions('') +
      '</select></div>' +
      '<div class="row"><label>Your PIN</label>' +
      '<input id="' + escapeHtml(pinFieldId) + '" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" /></div>' +
      '</div>';
  }

  function readEmployeeIdentityFromDom(employeeFieldId, pinFieldId) {
    var employeeEl = document.getElementById(employeeFieldId);
    var pinEl = document.getElementById(pinFieldId);
    return {
      employeeId: employeeEl ? String(employeeEl.value || '').trim() : '',
      pin: pinEl ? String(pinEl.value || '').trim() : ''
    };
  }

  function sameEmployeeId(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function findKioskEmployeeById(employeeId) {
    var employees = state.kioskEmployees || [];
    var i;
    for (i = 0; i < employees.length; i += 1) {
      if (sameEmployeeId(employees[i].employee_id, employeeId)) return employees[i];
    }
    return null;
  }

  function findStaffPinRecord(employeeId) {
    var records = state.staffPinRecords || [];
    var i;
    for (i = 0; i < records.length; i += 1) {
      if (sameEmployeeId(records[i].id, employeeId)) return records[i];
    }
    return null;
  }

  function pinLooksHashed(storedPin) {
    var value = String(storedPin || '');
    return value.indexOf('$2a$') === 0 || value.indexOf('$2b$') === 0 || value.indexOf('$2y$') === 0;
  }

  function comparePinAsync(enteredPin, storedPin, done) {
    var entered = String(enteredPin || '').trim();
    var stored = String(storedPin || '');
    if (!entered || !stored) {
      done(false);
      return;
    }
    if (stored === entered) {
      done(true);
      return;
    }
    if (pinLooksHashed(stored) && typeof dcodeIO !== 'undefined' && dcodeIO.bcrypt) {
      dcodeIO.bcrypt.compare(entered, stored, function (err, match) {
        done(!err && !!match);
      });
      return;
    }
    done(false);
  }

  function buildVerifiedEmployee(staffRow, kioskEmp, employeeId) {
    return {
      employee_id: staffRow.id || staffRow.employee_id || employeeId,
      full_name: staffRow.full_name || (kioskEmp && kioskEmp.full_name) || null,
      first_name: staffRow.first_name || (kioskEmp && kioskEmp.first_name) || null,
      last_name: staffRow.last_name || (kioskEmp && kioskEmp.last_name) || null,
      role: staffRow.role || (kioskEmp && kioskEmp.role) || 'employee'
    };
  }

  function verifyPinOnlyFromRecords(records, pin, index, callback) {
    if (index >= records.length) {
      verifyPinOnlyServer(pin, callback);
      return;
    }
    var staff = records[index];
    comparePinAsync(pin, staff.pin, function (match) {
      if (match) {
        callback(null, buildVerifiedEmployee(staff, findKioskEmployeeById(staff.id), staff.id));
        return;
      }
      verifyPinOnlyFromRecords(records, pin, index + 1, callback);
    });
  }

  function verifyPinOnlyServer(pin, callback) {
    rpc('task_manager_verify_pin', {
      p_business_id: state.businessId,
      p_pin: pin
    }, function (err, rows) {
      if (err) {
        callback(err);
        return;
      }
      if (!rows || !rows.length || !rows[0]) {
        callback(new Error('Incorrect PIN. Use the same PIN as the POS register.'));
        return;
      }
      callback(null, rows[0]);
    });
  }

  function verifyPinOnly(pin, callback) {
    if (!pin) {
      callback(new Error('Enter your PIN before continuing.'));
      return;
    }
    if (!state.businessId) {
      callback(new Error('This kiosk is not linked to a business.'));
      return;
    }

    function tryClient() {
      var records = state.staffPinRecords || [];
      if (!records.length) {
        verifyPinOnlyServer(pin, callback);
        return;
      }
      verifyPinOnlyFromRecords(records, pin, 0, callback);
    }

    if (state.staffPinRecords && state.staffPinRecords.length) {
      tryClient();
      return;
    }

    loadStaffPinsForVerify(function () {
      tryClient();
    });
  }

  function withVerifiedPinOnly(pinFieldId, onSuccess, onError) {
    var pinEl = document.getElementById(pinFieldId);
    var pin = pinEl ? String(pinEl.value || '').trim() : '';
    verifyPinOnly(pin, function (err, employee) {
      if (err) {
        if (onError) onError(err.message || 'Could not verify PIN.');
        return;
      }
      primePosActiveUserFromKiosk(employee);
      onSuccess(employee, pin);
    });
  }

  function promptPinVerify(actionTitle, onVerified, onCancel) {
    shell(
      alerts() +
      '<h2>Enter your PIN</h2>' +
      '<p class="muted">' + escapeHtml(actionTitle) + '</p>' +
      renderPinOnlyPanel('', 'actionPin') +
      '<div class="actions">' +
      '<button type="button" class="secondary" id="cancelPinAction">Cancel</button>' +
      '<button type="button" class="primary" id="confirmPinAction">Continue</button>' +
      '</div>'
    );
    document.getElementById('cancelPinAction').onclick = function () {
      if (onCancel) onCancel();
    };
    document.getElementById('confirmPinAction').onclick = function () {
      var pinEl = document.getElementById('actionPin');
      var pin = pinEl ? String(pinEl.value || '').trim() : '';
      verifyPinOnly(pin, function (err, employee) {
        if (err) {
          state.error = err.message || 'Could not verify PIN.';
          promptPinVerify(actionTitle, onVerified, onCancel);
          return;
        }
        state.error = '';
        primePosActiveUserFromKiosk(employee);
        onVerified(employee, pin);
      });
    };
  }

  function verifyEmployeeIdentityServer(employeeId, pin, callback) {
    rpc('task_manager_verify_pin', {
      p_business_id: state.businessId,
      p_pin: pin,
      p_employee_id: employeeId
    }, function (err, rows) {
      if (err) {
        callback(err);
        return;
      }
      if (!rows || !rows.length || !rows[0] || !sameEmployeeId(rows[0].employee_id, employeeId)) {
        callback(new Error('Incorrect PIN. Use the same PIN as the POS register.'));
        return;
      }
      callback(null, rows[0]);
    });
  }

  function verifyEmployeeIdentity(employeeId, pin, callback) {
    if (!employeeId) {
      callback(new Error('Select your name before continuing.'));
      return;
    }
    if (!pin) {
      callback(new Error('Enter your PIN before continuing.'));
      return;
    }
    if (!state.businessId) {
      callback(new Error('This kiosk is not linked to a business.'));
      return;
    }

    var kioskEmp = findKioskEmployeeById(employeeId);
    if (!kioskEmp) {
      callback(new Error('Select your name from the list before continuing.'));
      return;
    }

    function verifyWithLoadedPins() {
      var staff = findStaffPinRecord(employeeId);
      if (!staff || !staff.pin) {
        verifyEmployeeIdentityServer(employeeId, pin, callback);
        return;
      }
      comparePinAsync(pin, staff.pin, function (match) {
        if (match) {
          callback(null, buildVerifiedEmployee(staff, kioskEmp, employeeId));
          return;
        }
        if (pinLooksHashed(staff.pin) && typeof dcodeIO !== 'undefined' && dcodeIO.bcrypt) {
          callback(new Error('Incorrect PIN. Use the same PIN as the POS register.'));
          return;
        }
        verifyEmployeeIdentityServer(employeeId, pin, callback);
      });
    }

    if (state.staffPinRecords && state.staffPinRecords.length) {
      verifyWithLoadedPins();
      return;
    }

    loadStaffPinsForVerify(function () {
      verifyWithLoadedPins();
    });
  }

  function loadStaffPinsForVerify(done) {
    if (!state.businessId) {
      state.staffPinRecords = [];
      if (done) done();
      return;
    }
    rpc('get_all_staff_pins_for_unlock', { p_business_id: state.businessId }, function (err, rows) {
      state.staffPinRecords = err ? [] : (rows || []);
      if (done) done(err);
    });
  }

  function withVerifiedIdentity(employeeFieldId, pinFieldId, onSuccess, onError) {
    var identity = readEmployeeIdentityFromDom(employeeFieldId, pinFieldId);
    verifyEmployeeIdentity(identity.employeeId, identity.pin, function (err, employee) {
      if (err) {
        if (onError) onError(err.message || 'Could not verify employee.');
        return;
      }
      onSuccess(employee, identity.pin);
    });
  }

  function photoRequirementMode(task) {
    if (!task) return 'never';
    if (task.photo_requirement_mode) return task.photo_requirement_mode;
    return task.requires_photo ? 'always' : 'never';
  }

  function photoFieldLabel(task) {
    var mode = photoRequirementMode(task);
    if (mode === 'always') return '(required)';
    if (mode === 'never') return '(optional)';
    if (state.taskPhotoRequired) return '(required for you)';
    return '(may be required)';
  }

  function updateTaskPhotoRequirementLabel() {
    var el = document.getElementById('photoLabelSuffix');
    if (!el || !state.task) return;
    el.textContent = photoFieldLabel(state.task);
  }

  function resolveTaskPhotoRequired(taskId, employeeId, callback) {
    if (!taskId || !employeeId) {
      callback(null, { photo_required: false });
      return;
    }
    rpc('task_manager_resolve_task_photo_required', {
      p_business_id: state.businessId,
      p_task_id: taskId,
      p_employee_id: employeeId
    }, function (err, result) {
      if (err) {
        callback(err);
        return;
      }
      callback(null, result || { photo_required: false });
    });
  }

  function bindTaskPhotoResolution() {
    /* Random photo requirement is resolved when the task is completed (after PIN entry). */
  }

  function findChecklistTask(taskId) {
    var tasks = state.checklistTasks || [];
    for (var i = 0; i < tasks.length; i += 1) {
      if (String(tasks[i].task_id) === String(taskId)) return tasks[i];
    }
    return null;
  }

  function setChecklistCheckbox(taskId, checked) {
    var boxes = document.getElementsByClassName('checklistComplete');
    for (var i = 0; i < boxes.length; i += 1) {
      if (String(boxes[i].getAttribute('data-task-id')) === String(taskId)) {
        boxes[i].checked = checked;
        return;
      }
    }
  }

  function loadKioskEmployees(done) {
    if (!state.businessId) {
      state.kioskEmployees = [];
      if (done) done();
      return;
    }
    rpc('task_manager_get_kiosk_employees', { p_business_id: state.businessId }, function (err, rows) {
      state.kioskEmployees = err ? [] : (rows || []);
      if (done) done(err);
    });
  }

  function clearChecklistSession() {
    state.checklistCategoryId = null;
    state.checklistTitle = '';
    state.checklistTasks = [];
    persistSession();
  }

  function persistSession() {
    try {
      var payload = {
        businessId: state.businessId,
        kioskCode: state.kioskCode
      };
      var json = JSON.stringify(payload);
      sessionStorage.setItem('tmk_session', json);
      localStorage.setItem('tmk_session_backup', json);
    } catch (e) { /* ignore */ }
  }

  function clearPersistedSession() {
    try {
      sessionStorage.removeItem('tmk_session');
      localStorage.removeItem('tmk_session_backup');
    } catch (e) { /* ignore */ }
  }

  function enterKiosk() {
    state.error = '';
    state.message = '';
    shell('<h2>Loading kiosk...</h2><p class="muted">Please wait.</p>');
    loadKioskEmployees(function () {
      loadStaffPinsForVerify(function () {
        loadPinScreenChecklistCategories(function () {
          renderPinHome();
        });
      });
    });
  }

  var claimTouchInterval = null;

  function clearClaimTouch() {
    if (claimTouchInterval) {
      clearInterval(claimTouchInterval);
      claimTouchInterval = null;
    }
  }

  function startClaimTouch() {
    clearClaimTouch();
    if (!state.task || !state.task.task_id || !state.activeEmployee || !state.activePin) return;
    claimTouchInterval = setInterval(function () {
      rpc('task_manager_touch_facility_task_claim', {
        p_business_id: state.businessId,
        p_task_id: state.task.task_id,
        p_employee_id: state.activeEmployee.employee_id,
        p_pin: state.activePin
      }, function () {});
    }, 5 * 60 * 1000);
  }

  function releaseActiveTaskClaim(done) {
    var employee = state.activeEmployee;
    var pin = state.activePin;
    var taskId = state.task && state.task.task_id;
    if (!taskId || !employee || !employee.employee_id) {
      if (done) done();
      return;
    }
    rpc('task_manager_release_facility_task_claim', {
      p_business_id: state.businessId,
      p_task_id: taskId,
      p_employee_id: employee.employee_id,
      p_pin: pin || null
    }, function () {
      if (done) done();
    });
  }

  function releasePinSession() {
    clearClaimTouch();
    closeHandoffModal();
    closeSkipModal();
    state.activeEmployee = null;
    state.activePin = '';
    state.checklistIntent = null;
    state.task = null;
    state.skipReason = '';
    state.skipScope = 'task';
    state.skipScopePreview = null;
    state.notes = '';
    state.photoDataUrl = '';
    state.taskPhotoRequired = false;
    state.peerReviewItems = [];
    state.peerReviewIndex = 0;
    state.peerReviewPhotoDataUrl = '';
    clearChecklistSession();
    persistSession();
  }

  function finishPinSession(message) {
    if (message) state.message = message;
    releaseActiveTaskClaim(function () {
      releasePinSession();
      renderPinHome();
    });
  }

  function withActiveEmployee(onSuccess, onMissing) {
    if (!state.activeEmployee || !state.activePin) {
      if (onMissing) onMissing();
      else finishPinSession('');
      return;
    }
    onSuccess(state.activeEmployee, state.activePin);
  }

  function renderPinHome() {
    state.error = '';
    var intentHint = '';
    if (state.checklistIntent) {
      intentHint = '<p class="muted">Enter your PIN to open <strong>' + escapeHtml(state.checklistIntent.title) + '</strong>.</p>';
    } else {
      intentHint = '<p class="muted">Enter your POS PIN to get your next assignment.</p>';
    }
    shell(
      alerts() +
      '<h1>' + escapeHtml(state.businessName || 'Task Kiosk') + '</h1>' +
      intentHint +
      renderPinOnlyPanel('', 'homePin') +
      '<div class="actions"><button type="button" class="primary" id="submitHomePin">Continue</button></div>' +
      checklistNavButtons()
    );
    document.getElementById('submitHomePin').onclick = submitHomePin;
    bindChecklistNavButtons();
  }

  function submitHomePin() {
    var pinEl = document.getElementById('homePin');
    var pin = pinEl ? String(pinEl.value || '').trim() : '';
    state.error = '';
    shell('<h2>Checking PIN...</h2><p class="muted">Please wait.</p>');
    verifyPinOnly(pin, function (err, employee) {
      if (err) {
        state.error = err.message || 'Incorrect PIN. Use the same PIN as the POS register.';
        renderPinHome();
        return;
      }
      startPinSession(employee, pin);
    });
  }

  function startPinSession(employee, pin) {
    state.activeEmployee = employee;
    state.activePin = pin;
    state.error = '';
    primePosActiveUserFromKiosk(employee);
    dispatchAfterPin();
  }

  function dispatchAfterPin() {
    if (state.checklistIntent) {
      loadChecklist(state.checklistIntent.categoryId, state.checklistIntent.title);
      state.checklistIntent = null;
      return;
    }
    loadPeerReviewsOrNextTask();
  }

  function primePosActiveUserFromKiosk(employee) {
    if (!employee || !state.businessId) return;
    try {
      var displayName = employeeDisplayName(employee);
      localStorage.setItem('posActiveUser', JSON.stringify({
        id: employee.employee_id,
        role: employee.role || 'employee',
        full_name: employee.full_name || null,
        first_name: employee.first_name || null,
        name: displayName,
        business_id: state.businessId,
        unlocked_at: Date.now(),
        source: 'task_kiosk'
      }));
      localStorage.setItem('currentBusinessId', state.businessId);
      localStorage.setItem('selectedBusinessId', state.businessId);
      window.dispatchEvent(new Event('pos-active-user-changed'));
    } catch (e) { /* ignore */ }
  }

  function hasModuleLink(task) {
    return !!(task && task.module_link_key && task.module_link_path);
  }

  function openModuleLink(taskId, path) {
    if (!path || !taskId || !state.businessId) return;
    var task = state.checklistCategoryId ? findChecklistTask(taskId) : state.task;
    withActiveEmployee(function (employee, pin) {
      var returnPath = window.location.pathname + window.location.search;
      persistSession();
      primePosActiveUserFromKiosk(employee);
      rpc('task_kiosk_dashboard_open_session', {
        p_business_id: state.businessId,
        p_employee_id: employee.employee_id,
        p_pin: pin,
        p_task_id: taskId
      }, function (err, token) {
        if (err || !token) {
          alert(err || 'Could not open linked page. Try again.');
          return;
        }
        window.location.href = path
          + '?taskReturn=' + encodeURIComponent(returnPath)
          + '&task=' + encodeURIComponent(taskId)
          + '&business=' + encodeURIComponent(state.businessId)
          + '&tkDash=' + encodeURIComponent(token);
      });
    }, function () {
      state.error = '';
      if (state.task) renderTask();
      else if (state.checklistCategoryId) renderChecklistView();
    });
  }

  function restoreSession() {
    try {
      var raw = sessionStorage.getItem('tmk_session');
      if (!raw) raw = localStorage.getItem('tmk_session_backup');
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved.businessId) state.businessId = saved.businessId;
      if (saved.kioskCode) state.kioskCode = saved.kioskCode;
    } catch (e) { /* ignore */ }
  }

  function resumeUnlockedSession() {
    state.error = '';
    enterKiosk();
  }

  function init() {
    restoreSession();
    if (getParam('submitted') === '1') {
      state.message = 'Form submitted successfully.';
      if (state.businessId) {
        resumeUnlockedSession();
        return;
      }
    }
    if (getParam('returned') === '1' && state.businessId) {
      resumeUnlockedSession();
      return;
    }
    if (state.kioskCode) {
      resolveKioskCode(state.kioskCode, function (err) {
        if (err) {
          renderBusinessRequired(err.message || 'Invalid kiosk code.');
          return;
        }
        enterKiosk();
      });
      return;
    }

    if (!state.businessId) {
      renderBusinessRequired();
      return;
    }

    rpc('task_manager_get_kiosk_business', { p_business_id: state.businessId }, function (err, rows) {
      if (!err && rows && rows[0]) {
        state.businessName = rows[0].business_name || state.businessName;
      }
      enterKiosk();
    });
  }

  function resolveKioskCode(code, done) {
    rpc('task_manager_resolve_kiosk_code', { p_code: code }, function (err, rows) {
      if (err) {
        done(err);
        return;
      }
      if (!rows || !rows[0]) {
        done(new Error('Invalid kiosk code.'));
        return;
      }
      state.businessId = rows[0].business_id;
      state.businessName = rows[0].business_name || state.businessName;
      state.kioskCode = String(code || '').replace(/\D/g, '').slice(-6);
      done(null);
    });
  }

  function renderBusinessRequired(errorMessage) {
    shell(
      '<h1>Tavari Task Manager</h1>' +
      (errorMessage ? '<div class="alert error">' + escapeHtml(errorMessage) + '</div>' : '') +
      '<p class="muted">Enter the 6-digit kiosk code from Task Manager → Kiosk in your dashboard.</p>' +
      '<div class="row"><label>Kiosk code</label><input id="kioskCode" class="pin" inputmode="numeric" maxlength="6" pattern="[0-9]*" autocomplete="off" value="' + escapeHtml(state.kioskCode) + '" /></div>' +
      '<div class="actions"><button class="primary" id="saveBusiness">Continue</button></div>'
    );
    document.getElementById('saveBusiness').onclick = function () {
      var value = String(document.getElementById('kioskCode').value || '').replace(/\D/g, '');
      if (value.length !== 6) {
        renderBusinessRequired('Enter a 6-digit kiosk code.');
        return;
      }
      resolveKioskCode(value, function (err) {
        if (err) {
          renderBusinessRequired(err.message || 'Invalid kiosk code.');
          return;
        }
        window.location.href = window.location.pathname + '?code=' + encodeURIComponent(value);
      });
    };
  }

  function checklistNavButtons() {
    var cats = state.pinScreenChecklistCategories || [];
    var html = '<div class="nav-actions actions">';
    if (!cats.length) {
      html += '</div>';
      return html;
    }
    var i;
    for (i = 0; i < cats.length; i += 1) {
      var cat = cats[i];
      html += '<button type="button" class="secondary pinChecklistBtn" data-category-id="' + escapeHtml(cat.category_id) + '" data-label="' + escapeHtml(cat.button_label || cat.name) + '">' + escapeHtml(cat.button_label || cat.name) + '</button>';
    }
    html += '</div>';
    return html;
  }

  function bindChecklistNavButtons() {
    var buttons = document.getElementsByClassName('pinChecklistBtn');
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      buttons[i].onclick = function () {
        state.checklistIntent = {
          categoryId: this.getAttribute('data-category-id'),
          title: this.getAttribute('data-label')
        };
        renderPinHome();
      };
    }
  }

  function loadPinScreenChecklistCategories(done) {
    if (!state.businessId) {
      state.pinScreenChecklistCategories = [];
      if (done) done();
      return;
    }
    rpc('task_manager_get_kiosk_checklist_buttons', { p_business_id: state.businessId }, function (err, rows) {
      state.pinScreenChecklistCategories = err ? [] : (rows || []);
      if (done) done();
    });
  }

  function loadPeerReviewsOrNextTask() {
    withActiveEmployee(function (employee, pin) {
      shell('<h2>Loading...</h2><p class="muted">Please wait.</p>');
      rpc('task_manager_get_kiosk_peer_review_batch', {
        p_business_id: state.businessId,
        p_employee_id: employee.employee_id,
        p_pin: pin
      }, function (err, result) {
        if (err || (result && result.success === false)) {
          state.error = err ? err.message : (result && result.error) || 'Could not load peer reviews.';
          loadNextTaskForActiveEmployee();
          return;
        }
        if (result && result.already_completed_today) {
          loadNextTaskForActiveEmployee();
          return;
        }
        var items = (result && result.items) || [];
        if (!items.length) {
          rpc('task_manager_complete_kiosk_peer_review_session', {
            p_business_id: state.businessId,
            p_employee_id: employee.employee_id,
            p_pin: pin,
            p_reviews_completed: 0
          }, function () {
            loadNextTaskForActiveEmployee();
          });
          return;
        }
        state.peerReviewItems = items;
        state.peerReviewIndex = 0;
        state.peerReviewPhotoDataUrl = '';
        renderPeerReview();
      });
    });
  }

  function renderPeerReview() {
    var items = state.peerReviewItems || [];
    var idx = state.peerReviewIndex || 0;
    if (idx >= items.length) {
      withActiveEmployee(function (employee, pin) {
        rpc('task_manager_complete_kiosk_peer_review_session', {
          p_business_id: state.businessId,
          p_employee_id: employee.employee_id,
          p_pin: pin,
          p_reviews_completed: items.length
        }, function () {
          state.message = 'Peer reviews complete. Thank you.';
          state.peerReviewItems = [];
          state.peerReviewIndex = 0;
          loadNextTaskForActiveEmployee();
        });
      });
      return;
    }
    var item = items[idx];
    var originalPhoto = '';
    if (item.completion_evidence) {
      originalPhoto = item.completion_evidence.photo_data_url || item.completion_evidence.photo_url || '';
    }
    var html = alerts() +
      '<h1>Peer Review</h1>' +
      '<p class="muted">' + escapeHtml(employeeDisplayName(state.activeEmployee)) + ' • Review ' + (idx + 1) + ' of ' + items.length + ' • Completed by ' + escapeHtml(item.completer_name || 'Staff') + '</p>' +
      '<h2>' + escapeHtml(item.task_title) + '</h2>' +
      (item.completion_notes ? '<div class="alert pre-wrap">' + escapeHtml(item.completion_notes) + '</div>' : '') +
      (originalPhoto ? '<div class="row"><label>Original completion photo</label><img class="peer-review-photo" src="' + escapeHtml(originalPhoto) + '" alt="Completion photo" /></div>' : '') +
      '<div class="row"><label>Verification photo (required)</label><input id="peerReviewPhoto" type="file" accept="image/*" capture="camera" /></div>' +
      '<div class="row"><label>Notes (optional)</label><textarea id="peerReviewNotes"></textarea></div>' +
      '<div class="actions peer-review-actions">' +
      '<button type="button" class="secondary" id="peerApprove">Approve — completed</button>' +
      '<button type="button" class="secondary" id="peerNotDone">Flag — not completed</button>' +
      '<button type="button" class="danger" id="peerRedo">Flag — redo required</button>' +
      '<button type="button" class="secondary" id="peerCancel">Cancel</button>' +
      '</div>';
    shell(html);
    document.getElementById('peerCancel').onclick = function () { finishPinSession(''); };
    document.getElementById('peerReviewPhoto').onchange = function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) {
        state.peerReviewPhotoDataUrl = '';
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        state.peerReviewPhotoDataUrl = e.target.result;
      };
      reader.readAsDataURL(file);
    };
    document.getElementById('peerApprove').onclick = function () { submitPeerReview('approved'); };
    document.getElementById('peerNotDone').onclick = function () { submitPeerReview('not_completed'); };
    document.getElementById('peerRedo').onclick = function () { submitPeerReview('redo_required'); };
  }

  function submitPeerReview(outcome) {
    var items = state.peerReviewItems || [];
    var idx = state.peerReviewIndex || 0;
    var item = items[idx];
    if (!item) return;
    if (!state.peerReviewPhotoDataUrl) {
      state.error = 'Verification photo is required.';
      renderPeerReview();
      return;
    }
    var notesEl = document.getElementById('peerReviewNotes');
    var notes = notesEl ? notesEl.value : '';
    shell('<h2>Saving review...</h2>');
    withActiveEmployee(function (employee, pin) {
      rpc('task_manager_submit_kiosk_peer_review', {
        p_business_id: state.businessId,
        p_employee_id: employee.employee_id,
        p_pin: pin,
        p_pool_id: item.pool_id,
        p_outcome: outcome,
        p_notes: notes || null,
        p_verification_evidence: { photo_data_url: state.peerReviewPhotoDataUrl, kiosk: 'peer_review' }
      }, function (err, result) {
        if (err || (result && result.success === false)) {
          state.error = err ? err.message : result.error;
          renderPeerReview();
          return;
        }
        state.error = '';
        state.peerReviewPhotoDataUrl = '';
        state.peerReviewIndex = idx + 1;
        renderPeerReview();
      });
    });
  }

  function loadChecklist(categoryId, title) {
    if (!state.activeEmployee || !state.activePin) {
      state.checklistIntent = { categoryId: categoryId, title: title || 'Checklist' };
      renderPinHome();
      return;
    }
    state.task = null;
    state.checklistCategoryId = categoryId;
    state.checklistTitle = title || 'Checklist';
    state.checklistTasks = [];
    state.error = '';
    shell('<h2>Loading ' + escapeHtml(state.checklistTitle) + '...</h2>');
    rpc('task_manager_get_checklist_tasks', {
      p_business_id: state.businessId,
      p_employee_id: state.activeEmployee.employee_id,
      p_category_id: categoryId
    }, function (err, rows) {
      if (err) {
        state.error = err.message || 'Could not load checklist.';
        clearChecklistSession();
        finishPinSession('');
        return;
      }
      state.checklistTasks = rows || [];
      renderChecklistView();
    });
  }

  function renderChecklistView() {
    var title = state.checklistTitle || 'Checklist';
    var tasks = state.checklistTasks || [];
    var doneCount = 0;
    var naCount = 0;
    var i;
    for (i = 0; i < tasks.length; i += 1) {
      if (tasks[i].status === 'done') {
        doneCount += 1;
        if (tasks[i].completion_outcome === 'not_applicable') naCount += 1;
      }
    }

    var progressText = doneCount + ' of ' + tasks.length + ' complete';
    if (naCount) progressText += ' (' + naCount + ' N/A)';

    var html = alerts() +
      '<h1>' + escapeHtml(title) + '</h1>' +
      '<p class="muted">Working as ' + escapeHtml(employeeDisplayName(state.activeEmployee)) + '</p>' +
      '<p class="checklist-progress">' + progressText + '</p>' +
      '<p class="muted">Check off when done, use Mark N/A if the item does not apply today, or uncheck to undo a mistake.</p>';

    if (!tasks.length) {
      html += '<p class="muted">No items in this checklist yet. Ask a manager to add tasks in Task Manager.</p>';
    }

    for (i = 0; i < tasks.length; i += 1) {
      var t = tasks[i];
      var isDone = t.status === 'done';
      var isNa = isDone && t.completion_outcome === 'not_applicable';
      var itemClass = 'checklist-item' + (isNa ? ' na' : (isDone ? ' done' : ''));
      var detailsId = 'checklist-details-' + t.task_id;
      var hasExtraDetails = hasChecklistExtraDetails(t);
      html += '<div class="' + itemClass + '" data-task-id="' + escapeHtml(t.task_id) + '">';
      html += renderChecklistItemRow(t, isDone, detailsId, hasExtraDetails);

      if (hasExtraDetails) {
        html += renderChecklistDetailsPanel(detailsId, t);
      }
      html += '</div>';
    }

    html += '<div class="actions">' +
      '<button class="secondary" id="backToQueue">Done</button>' +
      '<button class="primary" id="refreshChecklist">Refresh</button>' +
      '</div>';

    shell(html);

    document.getElementById('backToQueue').onclick = function () {
      finishPinSession('');
    };
    document.getElementById('refreshChecklist').onclick = function () {
      loadChecklist(state.checklistCategoryId, state.checklistTitle);
    };

    var boxes = document.getElementsByClassName('checklistComplete');
    for (i = 0; i < boxes.length; i += 1) {
      boxes[i].onchange = function () {
        var taskId = this.getAttribute('data-task-id');
        if (this.checked) {
          completeChecklistItem(taskId);
        } else {
          undoChecklistItem(taskId);
        }
      };
    }

    var naButtons = document.getElementsByClassName('markChecklistNa');
    for (i = 0; i < naButtons.length; i += 1) {
      naButtons[i].onclick = function () {
        markChecklistItemNa(this.getAttribute('data-task-id'));
      };
    }

    var formButtons = document.getElementsByClassName('openChecklistForm');
    for (i = 0; i < formButtons.length; i += 1) {
      formButtons[i].onclick = function () {
        var taskId = this.getAttribute('data-task-id');
        var formId = this.getAttribute('data-form-id');
        var returnPath = window.location.pathname + window.location.search;
        persistSession();
        window.location.href = '/forms/fill/' + encodeURIComponent(formId)
          + '?business=' + encodeURIComponent(state.businessId)
          + '&task=' + encodeURIComponent(taskId)
          + '&return=' + encodeURIComponent(returnPath);
      };
    }

    var moduleButtons = document.getElementsByClassName('openModuleLink');
    for (i = 0; i < moduleButtons.length; i += 1) {
      moduleButtons[i].onclick = function () {
        openModuleLink(this.getAttribute('data-task-id'), this.getAttribute('data-path'));
      };
    }

    var detailToggles = document.getElementsByClassName('checklistDetailsToggle');
    for (i = 0; i < detailToggles.length; i += 1) {
      detailToggles[i].onclick = function () {
        var targetId = this.getAttribute('data-target');
        var panel = document.getElementById(targetId);
        if (!panel) return;
        var isHidden = panel.className.indexOf('hidden') !== -1;
        if (isHidden) {
          panel.className = 'checklist-details';
          this.textContent = 'Less Details';
        } else {
          panel.className = 'checklist-details hidden';
          this.textContent = 'More Details';
        }
      };
    }
  }

  function completeChecklistItem(taskId) {
    var task = findChecklistTask(taskId);
    withActiveEmployee(function (employee, pin) {
      var mode = photoRequirementMode(task);
      if (mode === 'always') {
        renderChecklistPhotoCapture(taskId, employee, pin, task);
        return;
      }
      if (mode === 'random') {
        resolveTaskPhotoRequired(taskId, employee.employee_id, function (err, result) {
          if (err) {
            state.error = err.message || 'Could not check photo requirement.';
            setChecklistCheckbox(taskId, false);
            renderChecklistView();
            return;
          }
          if (result && result.photo_required) {
            renderChecklistPhotoCapture(taskId, employee, pin, task);
            return;
          }
          doCompleteChecklistItem(taskId, employee, pin, null);
        });
        return;
      }
      doCompleteChecklistItem(taskId, employee, pin, null);
    }, function () {
      setChecklistCheckbox(taskId, false);
      renderChecklistView();
    });
  }

  function doCompleteChecklistItem(taskId, employee, pin, photoDataUrl) {
    shell('<h2>Marking complete...</h2>');
    rpc('task_manager_complete_task', {
      p_business_id: state.businessId,
      p_task_id: taskId,
      p_employee_id: employee.employee_id,
      p_pin: pin,
      p_notes: null,
      p_completed_checklist: [],
      p_evidence: { photo_data_url: photoDataUrl || null, kiosk: 'checklist' }
    }, function (err, result) {
      if (err || (result && result.success === false)) {
        state.error = err ? err.message : result.error;
        loadChecklist(state.checklistCategoryId, state.checklistTitle);
        return;
      }
      state.message = 'Item marked complete.';
      loadChecklist(state.checklistCategoryId, state.checklistTitle);
    });
  }

  function renderChecklistPhotoCapture(taskId, employee, pin, task) {
    state.pendingChecklistTaskId = taskId;
    state.pendingChecklistPhoto = '';
    shell(
      alerts() +
      '<h2>Photo required</h2>' +
      '<p class="muted">' + escapeHtml((task && task.title) || 'Checklist item') + '</p>' +
      '<div class="row"><label>Completion photo (required)</label><input id="checklistPhoto" type="file" accept="image/*" capture="camera" /></div>' +
      '<div class="actions">' +
      '<button type="button" class="secondary" id="cancelChecklistPhoto">Cancel</button>' +
      '<button type="button" class="primary" id="submitChecklistPhoto">Mark complete</button>' +
      '</div>'
    );
    document.getElementById('checklistPhoto').onchange = function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) {
        state.pendingChecklistPhoto = '';
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        state.pendingChecklistPhoto = e.target.result;
      };
      reader.readAsDataURL(file);
    };
    document.getElementById('cancelChecklistPhoto').onclick = function () {
      state.pendingChecklistTaskId = null;
      state.pendingChecklistPhoto = '';
      setChecklistCheckbox(taskId, false);
      renderChecklistView();
    };
    document.getElementById('submitChecklistPhoto').onclick = function () {
      if (!state.pendingChecklistPhoto) {
        state.error = 'Photo evidence is required for this task.';
        renderChecklistPhotoCapture(taskId, employee, pin, task);
        return;
      }
      state.pendingChecklistTaskId = null;
      doCompleteChecklistItem(taskId, employee, pin, state.pendingChecklistPhoto);
      state.pendingChecklistPhoto = '';
    };
  }

  function markChecklistItemNa(taskId) {
    withActiveEmployee(function (employee, pin) {
      shell('<h2>Marking not applicable...</h2>');
      rpc('task_manager_kiosk_checklist_mark_na', {
        p_business_id: state.businessId,
        p_task_id: taskId,
        p_employee_id: employee.employee_id,
        p_pin: pin
      }, function (err, result) {
        if (err || (result && result.success === false)) {
          state.error = err ? err.message : result.error;
          loadChecklist(state.checklistCategoryId, state.checklistTitle);
          return;
        }
        state.message = 'Item marked not applicable.';
        loadChecklist(state.checklistCategoryId, state.checklistTitle);
      });
    }, function () {
      renderChecklistView();
    });
  }

  function undoChecklistItem(taskId) {
    withActiveEmployee(function (employee, pin) {
      shell('<h2>Reopening item...</h2>');
      rpc('task_manager_kiosk_checklist_undo', {
        p_business_id: state.businessId,
        p_task_id: taskId,
        p_employee_id: employee.employee_id,
        p_pin: pin
      }, function (err, result) {
        if (err || (result && result.success === false)) {
          state.error = err ? err.message : result.error;
          loadChecklist(state.checklistCategoryId, state.checklistTitle);
          return;
        }
        state.message = 'Item reopened.';
        loadChecklist(state.checklistCategoryId, state.checklistTitle);
      });
    }, function () {
      renderChecklistView();
    });
  }

  function loadNextTaskForActiveEmployee(excludeTaskId) {
    withActiveEmployee(function (employee) {
      clearClaimTouch();
      state.task = null;
      state.notes = '';
      state.photoDataUrl = '';
      state.taskPhotoRequired = false;
      state.error = '';
      shell(
        '<h2>Finding next task...</h2>' +
        '<p class="muted">' + escapeHtml(state.businessName) + '</p>' +
        '<p class="muted">Please wait.</p>'
      );
      var rpcArgs = {
        p_business_id: state.businessId,
        p_employee_id: employee.employee_id
      };
      if (excludeTaskId) {
        rpcArgs.p_exclude_task_id = excludeTaskId;
      }
      rpc('task_manager_get_next_facility_task', rpcArgs, function (err, rows) {
        if (err) {
          state.error = err.message || 'Could not load tasks. Try again.';
          renderNoTasks();
          return;
        }
        if (!rows || !rows.length || !rows[0] || !rows[0].task_id) {
          renderNoTasks();
          return;
        }
        state.task = rows[0];
        state.taskPhotoRequired = photoRequirementMode(state.task) === 'always';
        if (hasIncompleteRequiredTraining(state.task)) {
          renderTrainingView();
          return;
        }
        renderTask();
      });
    });
  }

  function renderNoTasks() {
    shell(
      alerts() +
      '<h1>No tasks at this time</h1>' +
      '<p class="muted">Nothing in the queue for ' + escapeHtml(employeeDisplayName(state.activeEmployee)) + ' right now.</p>' +
      '<div class="actions"><button class="primary" id="doneNoTasks">Done</button></div>'
    );
    document.getElementById('doneNoTasks').onclick = function () {
      finishPinSession('');
    };
  }

  function renderTraining(task) {
    var resources = task.training_resources || [];
    if (!resources.length) return '';
    var html = '<h3>Training</h3>';
    for (var i = 0; i < resources.length; i += 1) {
      var r = resources[i];
      html += '<div class="resource">' +
        '<strong>' + escapeHtml(r.title) + '</strong>' +
        (r.is_required ? ' <span class="badge">Required</span>' : '') +
        (r.completed ? ' <span class="badge">Completed</span>' : '') +
        (r.resource_url ? '<p><a href="' + escapeHtml(r.resource_url) + '" target="_blank">Open resource</a></p>' : '') +
        (r.content ? '<p>' + escapeHtml(r.content) + '</p>' : '') +
        (!r.completed ? '<button class="secondary markTraining" data-id="' + escapeHtml(r.id) + '">Mark Training Complete</button>' : '') +
        '</div>';
    }
    return html;
  }

  function hasTraining(task) {
    return !!(task && task.training_resources && task.training_resources.length);
  }

  function hasIncompleteRequiredTraining(task) {
    var resources = (task && task.training_resources) || [];
    var i;
    for (i = 0; i < resources.length; i += 1) {
      if (resources[i].is_required && !resources[i].completed) return true;
    }
    return false;
  }

  function renderTrainingView() {
    var task = state.task;
    if (!task) {
      loadNextTaskForActiveEmployee();
      return;
    }
    shell(
      alerts() +
      '<h1>Training</h1>' +
      '<p class="muted">' + escapeHtml(employeeDisplayName(state.activeEmployee)) + ' • ' + escapeHtml(task.title) + '</p>' +
      (hasIncompleteRequiredTraining(task)
        ? '<div class="alert">Complete this training before you can finish the task.</div>'
        : '') +
      renderTraining(task) +
      '<div class="actions">' +
      (hasIncompleteRequiredTraining(task) ? '' : '<button class="primary" id="continueToTask">Continue to Task</button>') +
      '<button class="secondary" id="cancelTraining">Cancel</button></div>'
    );
    bindTrainingButtons();
    var continueBtn = document.getElementById('continueToTask');
    if (continueBtn) continueBtn.onclick = renderTask;
    document.getElementById('cancelTraining').onclick = function () {
      finishPinSession('');
    };
    startClaimTouch();
  }

  var SKIP_REASONS = [
    { id: 'customer_location_busy', label: 'Customer location — too many customers' },
    { id: 'area_being_repaired', label: 'Area being repaired' },
    { id: 'other', label: 'Other' }
  ];

  var LOCATION_ZONE_LABELS = {
    customer_area: 'Customer / play area',
    kitchen: 'Kitchen',
    concession: 'Concession',
    back_of_house: 'Back of house'
  };

  function locationZoneLabel(zone) {
    return LOCATION_ZONE_LABELS[zone] || zone || 'Location zone';
  }

  function suggestedSkipScopeForReason(reasonId, preview) {
    if (!preview) return 'task';
    if (reasonId === 'customer_location_busy' && preview.counts && preview.counts.location_zone > 1) {
      return 'location_zone';
    }
    if (reasonId === 'area_being_repaired' && preview.counts && preview.counts.category > 1) {
      return 'category';
    }
    return 'task';
  }

  function closeSkipModal() {
    var existing = document.getElementById('skipModalBackdrop');
    if (existing) existing.parentNode.removeChild(existing);
  }

  function showSkipModalError(message) {
    var el = document.getElementById('skipModalError');
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.style.display = 'block';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  function renderSkipScopeOptions(preview) {
    if (!preview || !preview.counts) {
      return '<p class="muted">Loading skip options…</p>';
    }
    var html = '<h3>What to skip</h3>';
    var scopes = [
      {
        id: 'task',
        label: 'This task only',
        count: preview.counts.task || 1,
        show: true
      },
      {
        id: 'category',
        label: 'All "' + (preview.category_name || 'category') + '" tasks',
        count: preview.counts.category || 0,
        show: (preview.counts.category || 0) > 0
      },
      {
        id: 'location_zone',
        label: 'All ' + locationZoneLabel(preview.location_sensitivity) + ' tasks',
        count: preview.counts.location_zone || 0,
        show: (preview.counts.location_zone || 0) > 0 && preview.location_sensitivity && preview.location_sensitivity !== 'none'
      }
    ];
    var i;
    for (i = 0; i < scopes.length; i += 1) {
      if (!scopes[i].show) continue;
      var checked = state.skipScope === scopes[i].id ? ' checked' : '';
      html += '<label class="checkrow">' +
        '<input type="radio" name="skipScope" class="skipScope" value="' + escapeHtml(scopes[i].id) + '"' + checked + ' />' +
        '<span class="checkrow-label">' + escapeHtml(scopes[i].label) +
        ' (' + scopes[i].count + ' task' + (scopes[i].count === 1 ? '' : 's') + ')</span></label>';
    }
    return html;
  }

  function bindSkipModalControls() {
    var radios = document.getElementsByClassName('skipReason');
    var i;
    for (i = 0; i < radios.length; i += 1) {
      radios[i].onchange = function () {
        state.skipReason = this.value;
        state.skipScope = suggestedSkipScopeForReason(state.skipReason, state.skipScopePreview);
        var scopeHost = document.getElementById('skipScopeOptions');
        if (scopeHost) scopeHost.innerHTML = renderSkipScopeOptions(state.skipScopePreview);
        bindSkipScopeRadios();
      };
    }
    bindSkipScopeRadios();
  }

  function bindSkipScopeRadios() {
    var scopes = document.getElementsByClassName('skipScope');
    var i;
    for (i = 0; i < scopes.length; i += 1) {
      scopes[i].onchange = function () {
        state.skipScope = this.value;
      };
    }
  }

  function loadSkipScopePreview(callback) {
    if (!state.task || !state.task.task_id) {
      callback(null);
      return;
    }
    rpc('task_manager_skip_scope_preview', {
      p_business_id: state.businessId,
      p_task_id: state.task.task_id
    }, function (err, result) {
      if (err || !result || result.success === false) {
        callback(null);
        return;
      }
      callback(result);
    });
  }

  function mountSkipModal() {
    closeSkipModal();
    closeHandoffModal();
    state.error = '';
    state.skipReason = state.skipReason || '';
    state.skipScope = 'task';
    state.skipScopePreview = null;

    var backdrop = document.createElement('div');
    backdrop.className = 'kiosk-modal-backdrop';
    backdrop.id = 'skipModalBackdrop';
    backdrop.innerHTML =
      '<div class="kiosk-modal card" role="dialog" aria-labelledby="skipModalTitle">' +
      '<h2 id="skipModalTitle">Skip Task</h2>' +
      '<p class="muted">' + escapeHtml(state.task.title) + '</p>' +
      '<p class="muted">Choose why work cannot be done right now. Notes and your PIN are required.</p>' +
      '<div id="skipModalError" class="alert error" style="display:none;"></div>' +
      '<h3>Reason</h3>' +
      '<div id="skipReasonOptions"></div>' +
      '<div id="skipScopeOptions"><p class="muted">Loading skip options…</p></div>' +
      '<div class="row"><label>Notes (required)</label>' +
      '<textarea id="skipNotes" placeholder="Explain what is blocking this work..."></textarea></div>' +
      '<div class="actions">' +
      '<button type="button" class="secondary" id="cancelSkipModal">Cancel</button>' +
      '<button type="button" class="danger" id="confirmSkipModal">Confirm Skip</button>' +
      '</div></div>';
    document.body.appendChild(backdrop);
    bindScrollOnFocus(backdrop);

    var reasonHtml = '';
    var i;
    for (i = 0; i < SKIP_REASONS.length; i += 1) {
      var reason = SKIP_REASONS[i];
      var checked = state.skipReason === reason.id ? ' checked' : '';
      reasonHtml += '<label class="checkrow">' +
        '<input type="radio" name="skipReason" class="skipReason" value="' + escapeHtml(reason.id) + '"' + checked + ' />' +
        '<span class="checkrow-label">' + escapeHtml(reason.label) + '</span></label>';
    }
    document.getElementById('skipReasonOptions').innerHTML = reasonHtml;

    document.getElementById('cancelSkipModal').onclick = closeSkipModal;
    document.getElementById('confirmSkipModal').onclick = submitSkipTask;
    backdrop.onclick = function (event) {
      if (event.target === backdrop) closeSkipModal();
    };

    bindSkipModalControls();
    loadSkipScopePreview(function (preview) {
      state.skipScopePreview = preview;
      if (!state.skipReason && preview) {
        state.skipScope = 'task';
      } else if (state.skipReason) {
        state.skipScope = suggestedSkipScopeForReason(state.skipReason, preview);
      }
      var scopeHost = document.getElementById('skipScopeOptions');
      if (scopeHost) scopeHost.innerHTML = renderSkipScopeOptions(preview);
      bindSkipScopeRadios();
    });

    var notesEl = document.getElementById('skipNotes');
    if (notesEl) notesEl.focus();
  }

  function submitSkipTask() {
    var notesEl = document.getElementById('skipNotes');
    var notes = notesEl && notesEl.value ? notesEl.value.trim() : '';
    if (!state.skipReason) {
      showSkipModalError('Select a skip reason.');
      return;
    }
    if (!state.skipScope) {
      showSkipModalError('Select what to skip.');
      return;
    }
    if (!notes) {
      showSkipModalError('Notes are required when skipping.');
      return;
    }
    showSkipModalError('');

    withActiveEmployee(function (employee, pin) {
      var confirmBtn = document.getElementById('confirmSkipModal');
      var skippedTaskId = state.task && state.task.task_id;
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Skipping…';
      }
      rpc('task_manager_skip_task', {
        p_business_id: state.businessId,
        p_task_id: skippedTaskId,
        p_employee_id: employee.employee_id,
        p_pin: pin,
        p_reason: state.skipReason,
        p_notes: notes,
        p_scope: state.skipScope
      }, function (err, result) {
        if (err || (result && result.success === false)) {
          if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm Skip';
          }
          showSkipModalError(err ? err.message : result.error);
          return;
        }
        var count = (result && result.skipped_count) ? result.skipped_count : 1;
        closeSkipModal();
        state.skipReason = '';
        state.skipScope = 'task';
        state.skipScopePreview = null;
        state.message = count === 1
          ? 'Task skipped for now — moving to the next one in the queue.'
          : ('Skipped ' + count + ' tasks for now. Moving to the next one in the queue.');
        loadNextTaskForActiveEmployee(skippedTaskId);
      });
    });
  }

  function closeHandoffModal() {
    var existing = document.getElementById('handoffModalBackdrop');
    if (existing) existing.parentNode.removeChild(existing);
  }

  function renderBusySignalsBanner(task) {
    var signals = task && task.facility_busy_signals;
    if (!signals || signals.sales_aware_queue_enabled === false) return '';
    var parts = [];
    if (signals.play_area_busy) {
      parts.push('Play area busy (' + (signals.admission_activity_count || 0) + ' admissions/check-ins)');
    } else if (signals.play_area_slow) {
      parts.push('Play area slow — customer-area tasks prioritized');
    }
    if (signals.kitchen_busy) {
      parts.push('Kitchen busy (' + (signals.kitchen_order_count || 0) + ' food orders)');
    } else if (signals.kitchen_slow) {
      parts.push('Kitchen slow — kitchen tasks prioritized');
    }
    if (!parts.length) return '';
    return '<div class="alert">' + escapeHtml(parts.join(' · ')) + '</div>';
  }

  function mountHandoffModal() {
    closeHandoffModal();
    state.error = '';
    var backdrop = document.createElement('div');
    backdrop.className = 'kiosk-modal-backdrop';
    backdrop.id = 'handoffModalBackdrop';
    backdrop.innerHTML =
      '<div class="kiosk-modal card" role="dialog" aria-labelledby="handoffModalTitle">' +
      '<h2 id="handoffModalTitle">Hand off (partially complete)</h2>' +
      '<p class="muted">Tell the next person what is done and what still needs to be finished.</p>' +
      '<div id="handoffModalError" class="alert error" style="display:none;"></div>' +
      '<div class="row"><label>Notes for next person (required)</label>' +
      '<textarea id="handoffNotes" placeholder="What is done so far? What should the next person finish?"></textarea></div>' +
      '<div class="actions">' +
      '<button type="button" class="secondary" id="cancelHandoffModal">Cancel</button>' +
      '<button type="button" class="primary" id="confirmHandoffModal">Hand off task</button>' +
      '</div></div>';
    document.body.appendChild(backdrop);
    bindScrollOnFocus(backdrop);
    document.getElementById('cancelHandoffModal').onclick = closeHandoffModal;
    document.getElementById('confirmHandoffModal').onclick = submitHandoffTask;
    backdrop.onclick = function (event) {
      if (event.target === backdrop) closeHandoffModal();
    };
    var notesEl = document.getElementById('handoffNotes');
    if (notesEl) notesEl.focus();
  }

  function showHandoffModalError(message) {
    var el = document.getElementById('handoffModalError');
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.style.display = 'block';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  function submitHandoffTask() {
    var notesEl = document.getElementById('handoffNotes');
    var notes = notesEl && notesEl.value ? notesEl.value.trim() : '';
    if (!notes) {
      showHandoffModalError('Notes for the next person are required when handing off.');
      return;
    }
    showHandoffModalError('');

    withActiveEmployee(function (employee, pin) {
      var confirmBtn = document.getElementById('confirmHandoffModal');
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Handing off…';
      }
      rpc('task_manager_handoff_task', {
        p_business_id: state.businessId,
        p_task_id: state.task.task_id,
        p_employee_id: employee.employee_id,
        p_pin: pin,
        p_notes: notes,
        p_completed_checklist: collectChecklist()
      }, function (err, result) {
        if (err || (result && result.success === false)) {
          if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Hand off task';
          }
          showHandoffModalError(err ? err.message : result.error);
          return;
        }
        closeHandoffModal();
        finishPinSession('Task handed off for the next person.');
      });
    });
  }

  function renderHandoffBanner(task) {
    if (!task || !task.handoff_notes) return '';
    var byName = task.handoff_by_name ? escapeHtml(task.handoff_by_name) : 'Previous staff';
    return '<div class="alert handoff-alert">' +
      '<strong>Continued from ' + byName + '</strong>' +
      '<p class="pre-wrap">' + escapeHtml(task.handoff_notes) + '</p>' +
      '</div>';
  }

  function applyHandoffChecklist(task) {
    if (!task || !task.handoff_checklist || !task.handoff_checklist.length) return;
    var map = {};
    var i;
    for (i = 0; i < task.handoff_checklist.length; i += 1) {
      var entry = task.handoff_checklist[i];
      if (entry && entry.id != null) map[String(entry.id)] = !!entry.completed;
    }
    var boxes = document.getElementsByClassName('checkItem');
    for (i = 0; i < boxes.length; i += 1) {
      var id = boxes[i].getAttribute('data-id');
      if (Object.prototype.hasOwnProperty.call(map, String(id))) {
        boxes[i].checked = map[String(id)];
      }
    }
  }

  function renderTask() {
    closeHandoffModal();
    closeSkipModal();
    var task = state.task;
    var checklist = task.checklist || [];
    var formId = task.required_form_id;
    var formTitle = task.required_form_title || 'Fill out form';
    var returnPath = window.location.pathname + window.location.search;
    var formUrl = formId
      ? '/forms/fill/' + encodeURIComponent(formId)
        + '?business=' + encodeURIComponent(state.businessId)
        + '&task=' + encodeURIComponent(task.task_id)
        + '&return=' + encodeURIComponent(returnPath)
      : '';

    var html = alerts() +
      renderBusySignalsBanner(task) +
      renderHandoffBanner(task) +
      '<h1>' + escapeHtml(task.title) + '</h1>' +
      '<p class="muted">Working as ' + escapeHtml(employeeDisplayName(state.activeEmployee)) + '</p>' +
      '<p><span class="badge">' + escapeHtml(task.priority) + '</span><span class="badge">' + escapeHtml(task.assignment_scope) + '</span></p>' +
      (task.handoff_notes ? '<p><span class="badge">Partially complete</span></p>' : '') +
      (task.priority_boost > 0 ? '<p><span class="badge">Priority boosted</span></p>' : '') +
      (task.description ? '<p class="pre-wrap">' + escapeHtml(task.description) + '</p>' : '') +
      (task.instructions ? '<div class="alert pre-wrap">' + escapeHtml(task.instructions) + '</div>' : '');

    if (formId) {
      html += '<div class="alert">This task requires a form log. Submitting the form completes this task automatically.</div>';
      html += '<div class="actions"><button class="primary" id="openForm">Fill out: ' + escapeHtml(formTitle) + '</button></div>';
    } else {
      if (hasModuleLink(task)) {
        if (task.module_link_allowed) {
          html += '<div class="actions"><button class="primary" id="openModuleLink">' + escapeHtml(task.module_link_button_label || 'Open linked page') + '</button></div>';
          html += '<p class="muted">Open the page, finish the work, return here, then tap Complete Task.</p>';
        } else {
          html += '<div class="alert">You do not have access to the linked page. Ask a manager for help.</div>';
        }
      }

      if (checklist.length) {
        html += '<h3>Checklist</h3>';
        for (var i = 0; i < checklist.length; i += 1) {
          html += '<label class="checkrow">' +
            renderTavariCheckboxHtml(
              'checkItem',
              'data-id="' + escapeHtml(checklist[i].id || i) + '"',
              false
            ) +
            '<span class="checkrow-label">' + escapeHtml(checklist[i].label || checklist[i]) + '</span></label>';
        }
      }

      html +=
        '<div class="row"><label>Notes' + (task.requires_notes ? ' (required)' : '') + '</label><textarea id="notes"></textarea></div>' +
        '<div class="row"><label>Photo <span id="photoLabelSuffix">' + escapeHtml(photoFieldLabel(task)) + '</span></label><input id="photo" type="file" accept="image/*" capture="camera" /></div>' +
        '<div class="actions">' +
        (hasTraining(task) && hasIncompleteRequiredTraining(task) ? '<button class="secondary" id="showTraining">Training</button>' : '') +
        '<button class="secondary" id="cancelTask">Cancel</button>' +
        '<button class="secondary" id="skipTask">Skip Task</button>' +
        '<button class="secondary" id="handoffTask">Hand off (partially complete)</button>' +
        '<button class="primary" id="completeTask">Complete Task</button></div>';
    }

    if (formId) {
      html += '<div class="actions">' +
        (hasTraining(task) && hasIncompleteRequiredTraining(task) ? '<button class="secondary" id="showTraining">Training</button>' : '') +
        '<button class="secondary" id="cancelTask">Cancel</button></div>';
    }

    shell(html);

    var cancelBtn = document.getElementById('cancelTask');
    if (cancelBtn) cancelBtn.onclick = function () { finishPinSession(''); };

    if (hasTraining(task) && hasIncompleteRequiredTraining(task)) {
      document.getElementById('showTraining').onclick = renderTrainingView;
    }
    if (formId) {
      document.getElementById('openForm').onclick = function () {
        persistSession();
        window.location.href = formUrl;
      };
    } else {
      if (hasModuleLink(task) && task.module_link_allowed) {
        document.getElementById('openModuleLink').onclick = function () {
          openModuleLink(task.task_id, task.module_link_path);
        };
      }
      document.getElementById('completeTask').onclick = completeTask;
      document.getElementById('handoffTask').onclick = mountHandoffModal;
      document.getElementById('skipTask').onclick = mountSkipModal;
      document.getElementById('photo').onchange = handlePhoto;
      bindTaskPhotoResolution();
      applyHandoffChecklist(task);
    }
    startClaimTouch();
  }

  function bindTrainingButtons() {
    var buttons = document.getElementsByClassName('markTraining');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].onclick = function () {
        markTraining(this.getAttribute('data-id'));
      };
    }
  }

  function markTraining(resourceId) {
    withActiveEmployee(function (employee, pin) {
      shell('<h2>Saving training...</h2>');
      rpc('task_manager_mark_training_complete', {
        p_business_id: state.businessId,
        p_resource_id: resourceId,
        p_employee_id: employee.employee_id,
        p_pin: pin
      }, function (err, result) {
        if (err || (result && result.success === false)) {
          state.error = err ? err.message : result.error;
          renderTrainingView();
          return;
        }
        state.message = 'Training marked complete.';
        rpc('task_manager_get_next_facility_task', {
          p_business_id: state.businessId,
          p_employee_id: employee.employee_id
        }, function (fetchErr, rows) {
          if (!fetchErr && rows && rows[0] && rows[0].task_id) {
            state.task = rows[0];
          }
          if (hasIncompleteRequiredTraining(state.task)) {
            renderTrainingView();
          } else {
            renderTask();
          }
        });
      });
    });
  }

  function handlePhoto(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) {
      state.photoDataUrl = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      state.photoDataUrl = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function collectChecklist() {
    var boxes = document.getElementsByClassName('checkItem');
    var values = [];
    for (var i = 0; i < boxes.length; i += 1) {
      values.push({
        id: boxes[i].getAttribute('data-id'),
        completed: !!boxes[i].checked
      });
    }
    return values;
  }

  function completeTask() {
    var notes = document.getElementById('notes').value;
    if (state.task.requires_notes && !notes) {
      state.error = 'Notes are required for this task.';
      renderTask();
      return;
    }

    withActiveEmployee(function (employee, pin) {
      var mode = photoRequirementMode(state.task);
      var proceed = function (photoRequired) {
        if (photoRequired && !state.photoDataUrl) {
          state.error = 'Photo evidence is required for this task.';
          state.taskPhotoRequired = true;
          renderTask();
          return;
        }
        shell('<h2>Completing task...</h2>');
        rpc('task_manager_complete_task', {
          p_business_id: state.businessId,
          p_task_id: state.task.task_id,
          p_employee_id: employee.employee_id,
          p_pin: pin,
          p_notes: notes || null,
          p_completed_checklist: collectChecklist(),
          p_evidence: { photo_data_url: state.photoDataUrl || null, kiosk: 'legacy' }
        }, function (err, result) {
          if (err || (result && result.success === false)) {
            state.error = err ? err.message : result.error;
            var staleTaskErrors = {
              'Task is no longer available': true,
              'This task is assigned to another employee': true
            };
            if (result && (result.training_required || staleTaskErrors[result.error])) {
              loadNextTaskForActiveEmployee();
            } else {
              renderTask();
            }
            return;
          }
          finishPinSession('Task complete. Thank you.');
        });
      };

      if (mode === 'always') {
        proceed(true);
        return;
      }
      if (mode === 'never') {
        proceed(false);
        return;
      }
      resolveTaskPhotoRequired(state.task.task_id, employee.employee_id, function (err, result) {
        if (err) {
          state.error = err.message || 'Could not check photo requirement.';
          renderTask();
          return;
        }
        state.taskPhotoRequired = !!(result && result.photo_required);
        proceed(state.taskPhotoRequired);
      });
    });
  }

  init();
}());
