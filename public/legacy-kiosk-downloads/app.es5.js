/* global window, document */
(function () {
  var FILES = {
    windows: 'Tavari-Waiver-Kiosk-Setup-1.0.0.exe',
    mac: 'Tavari-Waiver-Kiosk.dmg',
    linux: 'Tavari-Waiver-Kiosk.AppImage'
  };

  function esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function installerBase() {
    var cfg = window.__TAVARI_LEGACY_DOWNLOADS__ || {};
    var b = (cfg.installerBaseUrl || '').replace(/\/$/, '');
    if (b) return b;
    return window.location.origin.replace(/\/$/, '') + '/installers';
  }

  function waiverBrowserKioskUrl() {
    var cfg = window.__TAVARI_LEGACY_DOWNLOADS__ || {};
    var base = String(cfg.waiverBrowserKioskUrl || '').replace(/\/$/, '');
    if (base) return base;
    return '../waiver-browser-kiosk/';
  }

  function urlFor(key) {
    var b = installerBase();
    var name = FILES[key];
    if (!name) return '';
    return b + '/' + name;
  }

  var root = document.getElementById('app');
  if (!root) return;

  var base = installerBase();
  var html = '';
  html += '<div class="card">';
  html += '<h2>Desktop kiosk app</h2>';
  html +=
    '<p class="lead">Choose your computer type. After installing, enter the location details your manager gave you when the app asks.</p>';
  html +=
    '<a class="dl" href="' +
    esc(urlFor('windows')) +
    '" download>Download for Windows</a>';
  html += '<a class="dl" href="' + esc(urlFor('mac')) + '" download>Download for macOS</a>';
  html += '<a class="dl" href="' + esc(urlFor('linux')) + '" download>Download for Linux</a>';
  html +=
    '<p class="sub">If a button does nothing, press and hold it and choose Open in Browser, or open this page on a PC or Mac.</p>';
  html += '<button type="button" class="staff-toggle" id="techToggle">Technical details</button>';
  html += '<div class="tech" id="techPanel">File host: ' + esc(base) + '</div>';
  html +=
    '<p class="hint">Phone check-in only (no install)? <a href="' + esc(waiverBrowserKioskUrl()) + '">Open browser waiver kiosk</a></p>';
  html += '</div>';

  if (!window.__TAVARI_LEGACY_DOWNLOADS__) {
    html += '<p class="err">This page is not fully configured. Ask your administrator to redeploy.</p>';
  }

  root.innerHTML = html;

  var tBtn = document.getElementById('techToggle');
  var tPan = document.getElementById('techPanel');
  if (tBtn && tPan) {
    tBtn.onclick = function () {
      var open = tPan.className.indexOf('open') >= 0;
      tPan.className = open ? 'tech' : 'tech open';
      tBtn.textContent = open ? 'Technical details' : 'Hide technical details';
    };
  }
})();
