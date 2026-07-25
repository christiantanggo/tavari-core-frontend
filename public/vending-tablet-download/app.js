(function () {
  var cfg = window.__TAVARI_VENDING_TABLET_DOWNLOAD__ || {};
  var androidHint = document.getElementById('androidHint');
  var downloadArea = document.getElementById('downloadArea');
  var versionBadge = document.getElementById('versionBadge');

  if (/android/i.test(navigator.userAgent) && androidHint) {
    androidHint.style.display = 'block';
  }

  function storagePublicUrl(name) {
    return [
      String(cfg.supabaseUrl || '').replace(/\/$/, ''),
      'storage/v1/object/public',
      encodeURIComponent(cfg.bucket || 'vending-installers'),
      encodeURIComponent(name)
    ].join('/');
  }

  function parseVersion(name) {
    var match = String(name || '').match(new RegExp(cfg.filenamePattern || '^Tavari-Vending-Bridge-(\\d+\\.\\d+\\.\\d+)\\.apk$'));
    return match ? match[1] : null;
  }

  function compareVersions(a, b) {
    var aa = String(a.version || '').split('.').map(Number);
    var bb = String(b.version || '').split('.').map(Number);
    for (var i = 0; i < Math.max(aa.length, bb.length); i += 1) {
      var diff = (bb[i] || 0) - (aa[i] || 0);
      if (diff) return diff;
    }
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  }

  function formatBytes(bytes) {
    var n = Number(bytes || 0);
    if (!n) return 'unknown size';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatDate(value) {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString();
    } catch (_err) {
      return '';
    }
  }

  function renderDownloads(files) {
    if (!downloadArea || !versionBadge) return;
    if (!files.length) {
      versionBadge.textContent = 'No APKs found';
      downloadArea.innerHTML =
        '<p class="download-status">No Tavari Vending Bridge APK files were found in Supabase storage.</p>';
      return;
    }

    var latest = files[0];
    versionBadge.textContent = 'Latest version ' + latest.version + ' - ' + files.length + ' APK build' + (files.length === 1 ? '' : 's') + ' available';

    var html = '<div class="download-list">';
    files.forEach(function (file, index) {
      var url = storagePublicUrl(file.name);
      var size = formatBytes(file.metadata && (file.metadata.size || file.metadata.contentLength));
      var date = formatDate(file.updated_at || file.created_at);
      html += [
        '<a class="download-card ' + (index === 0 ? 'latest' : '') + '" href="' + url + '" download="' + file.name + '" rel="noopener noreferrer">',
        '<span class="download-title">',
        '<span>Tavari Vending Bridge ' + file.version + '</span>',
        index === 0 ? '<span class="badge">Newest</span>' : '',
        '</span>',
        '<span class="download-meta">' + file.name + ' - ' + size + (date ? ' - uploaded ' + date : '') + '</span>',
        '</a>'
      ].join('');
    });
    html += '</div>';
    downloadArea.innerHTML = html;
  }

  async function loadDownloads() {
    if (!downloadArea || !versionBadge) return;
    if (!cfg.supabaseUrl || !cfg.anonKey || !cfg.bucket) {
      versionBadge.textContent = 'Download config missing';
      downloadArea.innerHTML = '<p class="download-status">Download configuration is missing.</p>';
      return;
    }

    try {
      var res = await fetch(String(cfg.supabaseUrl).replace(/\/$/, '') + '/storage/v1/object/list/' + encodeURIComponent(cfg.bucket), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: cfg.anonKey,
          Authorization: 'Bearer ' + cfg.anonKey
        },
        body: JSON.stringify({
          prefix: '',
          limit: 100,
          offset: 0,
          sortBy: { column: 'name', order: 'desc' }
        })
      });
      if (!res.ok) {
        throw new Error('Supabase list failed: HTTP ' + res.status);
      }
      var rows = await res.json();
      var files = (Array.isArray(rows) ? rows : [])
        .map(function (row) {
          var version = parseVersion(row.name);
          return version ? Object.assign({}, row, { version: version }) : null;
        })
        .filter(Boolean)
        .sort(compareVersions);
      renderDownloads(files);
    } catch (err) {
      versionBadge.textContent = 'Could not load APK list';
      downloadArea.innerHTML =
        '<p class="download-status">Could not load available APKs from Supabase. Error: ' +
        String(err && err.message ? err.message : err) +
        '</p>';
    }
  }

  loadDownloads();
})();
