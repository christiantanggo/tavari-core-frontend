// Public download page for Tavari Vending Bridge APK (install on machine tablet).

import { useEffect, useMemo, useState } from 'react';
import { FiDownload, FiTablet, FiExternalLink } from 'react-icons/fi';
import {
  getVendingBridgeKioskUrl,
  isAndroidTablet,
  listVendingBridgeApks
} from '../../utils/vendingKioskDownload';
import './VendingKioskDownloadScreen.css';

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return 'unknown size';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedAt(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '';
  }
}

export default function VendingKioskDownloadScreen({ embedded = false }) {
  const [apks, setApks] = useState([]);
  const [loadingApks, setLoadingApks] = useState(true);
  const [apkError, setApkError] = useState('');
  const android = isAndroidTablet();
  const kioskUrl = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return getVendingBridgeKioskUrl(params.get('code') || params.get('kiosk') || 'NUQJTT');
  }, []);
  const latestApk = apks[0];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingApks(true);
      setApkError('');
      try {
        const files = await listVendingBridgeApks();
        if (!cancelled) setApks(files);
      } catch (err) {
        if (!cancelled) setApkError(err.message || 'Could not load APK list');
      } finally {
        if (!cancelled) setLoadingApks(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={embedded ? 'vending-download-embedded' : 'vending-download-page'}>
      <div className="vending-download-card">
        <div className="vending-download-icon">
          <FiTablet size={40} />
        </div>
        <h1>Tavari Vending — Tablet app</h1>
        <p className="vending-download-lead">
          Install this app on the <strong>vending machine tablet</strong>. It shows only the Tavari kiosk and
          controls the machine over RS485 — <strong>no manufacturer app required</strong>.
        </p>

        <div className="vending-download-version">
          {latestApk ? `Latest version ${latestApk.version}` : loadingApks ? 'Loading available APKs...' : 'No APKs found'}
        </div>

        {apkError ? (
          <p className="vending-download-warn">
            Could not load the Supabase APK list: <strong>{apkError}</strong>
          </p>
        ) : null}

        <div className="vending-download-list">
          {loadingApks ? (
            <p className="vending-download-status">Checking Supabase for uploaded APK builds...</p>
          ) : null}
          {!loadingApks && !apks.length && !apkError ? (
            <p className="vending-download-status">No Tavari Vending Bridge APKs were found in Supabase storage.</p>
          ) : null}
          {apks.map((apk, index) => (
            <a
              key={apk.filename}
              className={`vending-download-apk ${index === 0 ? 'latest' : ''}`}
              href={apk.url}
              download={apk.filename}
              rel="noopener noreferrer"
            >
              <span className="vending-download-apk-title">
                <span>
                  <FiDownload size={18} /> Tavari Vending Bridge {apk.version}
                </span>
                {index === 0 ? <strong>Newest</strong> : null}
              </span>
              <span className="vending-download-apk-meta">
                {apk.filename} · {formatBytes(apk.size)}
                {apk.updatedAt ? ` · uploaded ${formatUploadedAt(apk.updatedAt)}` : ''}
              </span>
            </a>
          ))}
        </div>

        <ol className="vending-download-steps">
          <li>Download the newest APK at the top (allow &quot;Install unknown apps&quot; if Android asks).</li>
          <li>Open <strong>Tavari Vending</strong> on the tablet.</li>
          <li>Use <strong>Test vend</strong> on Bubly to confirm the motor runs.</li>
          <li>Uninstall or hide the manufacturer customer app — not needed for RS485 mode.</li>
        </ol>

        {android ? (
          <p className="vending-download-hint">
            You&apos;re on Android — tap Download, then open the file from your Downloads folder.
          </p>
        ) : null}

        <a className="vending-download-link" href={kioskUrl}>
          <FiExternalLink size={16} /> Open kiosk in browser (Chrome only — cannot dispense)
        </a>

        <p className="vending-download-foot">
          Staff: configure devices in Tavari Dashboard → Tavari Vending.
        </p>
      </div>
    </div>
  );
}
