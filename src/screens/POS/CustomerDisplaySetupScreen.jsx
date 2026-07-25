import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { openCustomerDisplayWindow } from '../../utils/openCustomerDisplayWindow';
import {
  getCustomerDisplayBusinessId,
  resetCustomerDisplayMirrorToAds
} from '../../services/customerDisplayLocalState';
import { flushCustomerDisplayMirrorPush } from '../../services/customerDisplayMirrorSync';

const CUSTOMER_DISPLAY_INSTALLER_URL = (import.meta.env.VITE_CUSTOMER_DISPLAY_INSTALLER_URL || '').trim();

function formatPairingCode(code) {
  if (!code || String(code).length !== 6) return code;
  const s = String(code);
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

function formatCountdown(totalSec) {
  if (totalSec <= 0) return '0:00';
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Staff hub: pair customer display (.exe) with a 6-digit code; optional JSON download for advanced setups.
 */
const CustomerDisplaySetupScreen = () => {
  const { business } = useBusiness();
  const { hasPermission, userRole, loading: permissionsLoading } = usePermissions();

  const wrapperProps = {
    requiredRoles: null,
    requireBusiness: true,
    componentName: 'CustomerDisplaySetupScreen'
  };

  const [mirrorToken, setMirrorToken] = useState(null);
  const [mirrorTokenLoading, setMirrorTokenLoading] = useState(true);
  const [regeneratingMirrorToken, setRegeneratingMirrorToken] = useState(false);

  const [activePairing, setActivePairing] = useState(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingRemainingSec, setPairingRemainingSec] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const canView =
    !permissionsLoading &&
    (userRole === 'owner' ||
      userRole === 'admin' ||
      userRole === 'manager' ||
      hasPermission('pos.customer_display.view'));

  const canRegenerateToken =
    userRole === 'owner' ||
    userRole === 'admin' ||
    userRole === 'manager' ||
    hasPermission('manage_ads');

  useEffect(() => {
    const bid = business?.id;
    if (!bid) {
      setMirrorToken(null);
      setMirrorTokenLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setMirrorTokenLoading(true);
      const { data, error } = await supabase
        .from('pos_customer_display_mirror')
        .select('read_token')
        .eq('business_id', bid)
        .maybeSingle();
      if (cancelled) return;
      if (!error && data?.read_token) setMirrorToken(data.read_token);
      else setMirrorToken(null);
      setMirrorTokenLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id]);

  useEffect(() => {
    if (!activePairing?.expiresAt) {
      setPairingRemainingSec(null);
      return;
    }
    const tick = () => {
      const end = new Date(activePairing.expiresAt).getTime();
      const s = Math.max(0, Math.floor((end - Date.now()) / 1000));
      setPairingRemainingSec(s);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activePairing?.expiresAt]);

  const refreshMirrorToken = async () => {
    if (!business?.id) return;
    const { data } = await supabase
      .from('pos_customer_display_mirror')
      .select('read_token')
      .eq('business_id', business.id)
      .maybeSingle();
    if (data?.read_token) setMirrorToken(data.read_token);
  };

  const createPairingAndMaybeOpenInstaller = async ({ openInstaller }) => {
    if (!business?.id) return;
    setPairingLoading(true);
    try {
      const productionUrl = window.location.origin.replace(/\/$/, '');
      const { data: raw, error } = await supabase.rpc('create_customer_display_pairing_code', {
        p_business_id: business.id,
        p_production_url: productionUrl
      });
      if (error) throw error;
      let data = raw;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          data = null;
        }
      }
      if (!data || data.ok !== true) {
        throw new Error(data?.error || 'Could not create pairing code');
      }
      setActivePairing({
        code: data.code,
        expiresAt: data.expires_at
      });
      await refreshMirrorToken();
      if (openInstaller && CUSTOMER_DISPLAY_INSTALLER_URL) {
        window.open(CUSTOMER_DISPLAY_INSTALLER_URL, '_blank', 'noopener,noreferrer');
      }
      toast.success(
        openInstaller && CUSTOMER_DISPLAY_INSTALLER_URL
          ? 'Code is ready — enter it in the app on the customer screen.'
          : 'Pairing code is ready.'
      );
    } catch (e) {
      toast.error(e?.message || 'Could not create pairing code');
    } finally {
      setPairingLoading(false);
    }
  };

  const handleDownloadWindowsApp = () => {
    if (!CUSTOMER_DISPLAY_INSTALLER_URL) {
      toast.error('Installer URL is not configured yet.');
      return;
    }
    createPairingAndMaybeOpenInstaller({ openInstaller: true });
  };

  const handleShowNewCodeOnly = () => {
    createPairingAndMaybeOpenInstaller({ openInstaller: false });
  };

  const handleEnsureMirrorToken = async () => {
    if (!business?.id) return;
    try {
      const { data: existing } = await supabase
        .from('pos_customer_display_mirror')
        .select('read_token')
        .eq('business_id', business.id)
        .maybeSingle();
      if (existing?.read_token) {
        setMirrorToken(existing.read_token);
        toast.success('Display sync is ready.');
        return;
      }
      const { data: inserted, error } = await supabase
        .from('pos_customer_display_mirror')
        .insert({ business_id: business.id, payload: {} })
        .select('read_token')
        .single();
      if (error) throw error;
      setMirrorToken(inserted?.read_token || null);
      toast.success('Display sync is ready.');
    } catch (e) {
      toast.error(e?.message || 'Could not create token');
    }
  };

  const handleCopyMirrorToken = async () => {
    if (!mirrorToken) return;
    try {
      await navigator.clipboard.writeText(mirrorToken);
      toast.success('Token copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleRegenerateMirrorToken = async () => {
    if (!business?.id || !canRegenerateToken) return;
    setRegeneratingMirrorToken(true);
    try {
      const { data, error } = await supabase.rpc('regenerate_customer_display_read_token', {
        p_business_id: business.id
      });
      if (error) throw error;
      if (data) setMirrorToken(data);
      toast.success(
        'New security token — customer display PCs must pair again (new 6-digit code) or use a new config file (advanced).'
      );
    } catch (e) {
      toast.error(e?.message || 'Could not regenerate token');
    } finally {
      setRegeneratingMirrorToken(false);
    }
  };

  const handleOpenBrowserDisplay = async () => {
    const result = await openCustomerDisplayWindow({ suppressDesktopTip: true });
    if (!result.ok && result.reason === 'popup_blocked') {
      toast.error('Pop-up blocked. Allow pop-ups for this site to open the customer display window.');
    }
  };

  const handleDownloadConfigFile = () => {
    if (!mirrorToken) return;
    const productionUrl = window.location.origin.replace(/\/$/, '');
    const payload = {
      productionUrl,
      displayToken: mirrorToken,
      hashRoute: '/customer-display'
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'customer-display-config.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Save this file next to the customer display .exe if you are not using the 6-digit code.');
  };

  const pairingExpired = activePairing && pairingRemainingSec !== null && pairingRemainingSec <= 0;

  const handleSyncCustomerDisplayNow = () => {
    const bid = (business?.id || getCustomerDisplayBusinessId()).trim();
    if (!bid) {
      toast.error('No business selected.');
      return;
    }
    flushCustomerDisplayMirrorPush(bid);
    toast.success('Pushed current register state to the customer display.');
  };

  const handleClearCustomerDisplayMirror = () => {
    const bid = (business?.id || getCustomerDisplayBusinessId()).trim();
    if (!bid) {
      toast.error('No business selected.');
      return;
    }
    resetCustomerDisplayMirrorToAds(bid);
    toast.success('Cleared the customer display snapshot. The screen should show ads.');
  };

  return (
    <POSAuthWrapper {...wrapperProps}>
      {permissionsLoading ? (
        <div style={styles.loading}>Loading…</div>
      ) : !canView ? (
        <div style={styles.denied}>
          <h2 style={styles.deniedTitle}>Access denied</h2>
          <p>You do not have permission to manage the customer display.</p>
        </div>
      ) : (
        <div style={styles.page}>
          <h1 style={styles.title}>Customer display</h1>
          <p style={styles.lead}>
            Put the live cart and payment total on a <strong>second screen</strong> for your customer. Install our small
            Windows app on that PC, then link it with a <strong>short code</strong> — no JSON files or IT steps.
          </p>

          <div style={styles.stepsBox}>
            <h2 style={styles.stepsTitle}>Set up in three steps</h2>
            <ol style={styles.stepsList}>
              <li>
                <strong>On this register:</strong> click <strong>Download Windows app</strong>. A <strong>6-digit code</strong>{' '}
                appears here; the installer opens in a new tab.
              </li>
              <li>
                <strong>On the customer-facing PC:</strong> install and open <strong>Tavari Customer Display</strong>.
              </li>
              <li>
                <strong>Enter the code</strong> in the app when asked. The screen will show your ads and live totals.
              </li>
            </ol>
          </div>

          <div style={styles.reopenBox}>
            <strong>Already installed on this PC?</strong> You do <strong>not</strong> need to download the installer
            again. Press the <strong>Windows key</strong>, type <strong>Tavari Customer Display</strong>, and open the
            app — or use the <strong>desktop shortcut</strong> if the installer created one. Use a new 6-digit code from
            this page only if you still need to pair or something failed the first time.
          </div>

          {activePairing && (
            <div style={styles.pairingCard}>
              <div style={styles.pairingLabel}>Enter this code on the customer display computer</div>
              <div style={pairingExpired ? styles.pairingDigitsExpired : styles.pairingDigits}>
                {formatPairingCode(activePairing.code)}
              </div>
              <div style={styles.pairingMeta}>
                {pairingExpired ? (
                  <span style={styles.pairingExpiredText}>This code expired — use the button below to get a new one.</span>
                ) : (
                  <span>
                    Time left: <strong>{formatCountdown(pairingRemainingSec ?? 0)}</strong>
                  </span>
                )}
              </div>
              <button
                type="button"
                style={styles.pairingSecondaryBtn}
                onClick={handleShowNewCodeOnly}
                disabled={pairingLoading}
              >
                {pairingLoading ? 'Working…' : 'Show new code'}
              </button>
            </div>
          )}

          <div style={styles.buttonRow}>
            {CUSTOMER_DISPLAY_INSTALLER_URL ? (
              <button
                type="button"
                style={styles.primaryBtn}
                onClick={handleDownloadWindowsApp}
                disabled={pairingLoading}
              >
                {pairingLoading ? 'Working…' : '1. Download Windows app'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  style={styles.primaryBtnDisabled}
                  disabled
                  title="Set VITE_CUSTOMER_DISPLAY_INSTALLER_URL in deployment"
                >
                  1. Download Windows app (not configured)
                </button>
                <button
                  type="button"
                  style={styles.primaryBtn}
                  onClick={handleShowNewCodeOnly}
                  disabled={pairingLoading}
                >
                  {pairingLoading ? 'Working…' : 'Get pairing code only'}
                </button>
              </>
            )}
            <button type="button" style={styles.secondaryBtn} onClick={handleOpenBrowserDisplay}>
              Open in browser (testing)
            </button>
          </div>

          <div style={styles.troubleshootBox}>
            <strong style={{ display: 'block', marginBottom: '8px' }}>Customer screen stuck on an old sale?</strong>
            <p style={{ ...styles.muted, marginTop: 0, marginBottom: '12px' }}>
              <strong>Sync now</strong> re-sends whatever this register has in memory. <strong>Clear &amp; show ads</strong>{' '}
              wipes the live snapshot so the display falls back to full-screen ads (use if totals will not clear).
            </p>
            <div style={styles.buttonRow}>
              <button type="button" style={styles.outlineBtn} onClick={handleSyncCustomerDisplayNow}>
                Sync customer screen now
              </button>
              <button type="button" style={styles.secondaryBtn} onClick={handleClearCustomerDisplayMirror}>
                Clear &amp; show ads
              </button>
            </div>
          </div>

          {!CUSTOMER_DISPLAY_INSTALLER_URL && (
            <p style={styles.hint}>
              Your administrator can host the installer in storage and set{' '}
              <code style={styles.code}>VITE_CUSTOMER_DISPLAY_INSTALLER_URL</code> so staff get one-click download. You can
              still use <strong>Show new code</strong> after enabling the URL, or open the display in a browser for tests.
            </p>
          )}

          <button
            type="button"
            style={styles.advancedToggle}
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? '▼' : '▶'} Advanced (config file and token)
          </button>

          {showAdvanced && (
            <div style={styles.advancedPanel}>
              <p style={styles.tokenHelp}>
                Use a downloaded <code style={styles.code}>customer-display-config.json</code> only if IT prefers it.
                Pairing with the 6-digit code is the normal setup.
              </p>
              <div style={{ ...styles.buttonRow, marginBottom: '16px' }}>
                <button
                  type="button"
                  style={mirrorToken ? styles.configBtn : styles.primaryBtnDisabled}
                  onClick={handleDownloadConfigFile}
                  disabled={!mirrorToken}
                  title={mirrorToken ? '' : 'Create a sync token first'}
                >
                  Download config file (.json)
                </button>
              </div>
              <h2 style={styles.tokenTitle}>Sync token (support / IT)</h2>
              {mirrorTokenLoading ? (
                <p style={styles.muted}>Loading…</p>
              ) : mirrorToken ? (
                <div style={styles.tokenRow}>
                  <code style={styles.tokenCode}>{mirrorToken}</code>
                  <button type="button" style={styles.outlineBtn} onClick={handleCopyMirrorToken}>
                    Copy token
                  </button>
                  {canRegenerateToken && (
                    <button
                      type="button"
                      style={styles.outlineBtn}
                      onClick={handleRegenerateMirrorToken}
                      disabled={regeneratingMirrorToken}
                    >
                      {regeneratingMirrorToken ? 'Regenerating…' : 'Regenerate token'}
                    </button>
                  )}
                </div>
              ) : (
                <div style={styles.tokenRow}>
                  <p style={{ ...styles.muted, margin: 0, flex: 1 }}>
                    Create a mirror row if an older tool still needs it (pairing usually creates this automatically).
                  </p>
                  <button type="button" style={styles.primaryBtn} onClick={handleEnsureMirrorToken}>
                    Create sync token
                  </button>
                </div>
              )}
            </div>
          )}

          <p style={styles.footerLink}>
            <Link to="/dashboard/pos/display-ads" style={styles.link}>
              Manage customer display ads →
            </Link>
          </p>
        </div>
      )}
    </POSAuthWrapper>
  );
};

const styles = {
  page: {
    maxWidth: '720px',
    margin: '0 auto',
    padding: '24px 20px 48px',
    paddingTop: '72px'
  },
  loading: { padding: '48px', textAlign: 'center', color: TavariStyles.colors.gray600 },
  denied: {
    padding: '48px 24px',
    textAlign: 'center',
    paddingTop: '80px'
  },
  deniedTitle: { marginTop: 0 },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray800,
    margin: '0 0 12px 0'
  },
  lead: {
    fontSize: '16px',
    lineHeight: 1.5,
    color: TavariStyles.colors.gray600,
    margin: '0 0 28px 0'
  },
  buttonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '14px',
    marginBottom: '12px'
  },
  primaryBtn: {
    backgroundColor: TavariStyles.colors.primary,
    color: '#fff',
    border: 'none',
    padding: '14px 22px',
    borderRadius: '10px',
    fontWeight: 'bold',
    fontSize: '15px',
    cursor: 'pointer'
  },
  primaryBtnDisabled: {
    backgroundColor: TavariStyles.colors.gray300,
    color: TavariStyles.colors.gray600,
    border: 'none',
    padding: '14px 22px',
    borderRadius: '10px',
    fontWeight: 'bold',
    fontSize: '15px',
    cursor: 'not-allowed'
  },
  secondaryBtn: {
    backgroundColor: '#fff',
    color: TavariStyles.colors.primary,
    border: `2px solid ${TavariStyles.colors.primary}`,
    padding: '12px 22px',
    borderRadius: '10px',
    fontWeight: 'bold',
    fontSize: '15px',
    cursor: 'pointer'
  },
  configBtn: {
    backgroundColor: TavariStyles.colors.success || '#0d9488',
    color: '#fff',
    border: 'none',
    padding: '14px 22px',
    borderRadius: '10px',
    fontWeight: 'bold',
    fontSize: '15px',
    cursor: 'pointer'
  },
  pairingCard: {
    marginBottom: '22px',
    padding: '24px 22px',
    background: 'linear-gradient(145deg, #1e3a5f 0%, #0f172a 100%)',
    borderRadius: '14px',
    color: '#fff',
    textAlign: 'center',
    border: '1px solid rgba(255,255,255,0.12)'
  },
  pairingLabel: {
    fontSize: '14px',
    fontWeight: 600,
    opacity: 0.9,
    marginBottom: '14px',
    letterSpacing: '0.02em'
  },
  pairingDigits: {
    fontSize: '43px',
    fontWeight: '800',
    letterSpacing: '0.2em',
    fontFamily: 'ui-monospace, Consolas, monospace',
    marginBottom: '12px',
    textShadow: '0 2px 12px rgba(0,0,0,0.35)'
  },
  pairingDigitsExpired: {
    fontSize: '43px',
    fontWeight: '800',
    letterSpacing: '0.2em',
    fontFamily: 'ui-monospace, Consolas, monospace',
    marginBottom: '12px',
    opacity: 0.45,
    textDecoration: 'line-through'
  },
  pairingMeta: {
    fontSize: '14px',
    opacity: 0.85,
    marginBottom: '14px'
  },
  pairingExpiredText: {
    color: '#fca5a5'
  },
  pairingSecondaryBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    color: '#fff',
    border: '2px solid rgba(255,255,255,0.35)',
    padding: '10px 18px',
    borderRadius: '8px',
    fontWeight: 'bold',
    fontSize: '14px',
    cursor: 'pointer'
  },
  stepsBox: {
    marginBottom: '22px',
    padding: '18px 20px',
    backgroundColor: '#f8fafb',
    borderRadius: '12px',
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  stepsTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    margin: '0 0 12px 0',
    color: TavariStyles.colors.gray800
  },
  stepsList: {
    margin: 0,
    paddingLeft: '22px',
    color: TavariStyles.colors.gray700,
    lineHeight: 1.65,
    fontSize: '14px'
  },
  reopenBox: {
    marginBottom: '22px',
    padding: '16px 18px',
    backgroundColor: '#eff6ff',
    borderRadius: '12px',
    border: `1px solid ${TavariStyles.colors.primary}33`,
    fontSize: '14px',
    lineHeight: 1.55,
    color: TavariStyles.colors.gray700
  },
  troubleshootBox: {
    marginBottom: '22px',
    padding: '16px 18px',
    backgroundColor: '#fffbeb',
    borderRadius: '12px',
    border: '1px solid #fcd34d',
    fontSize: '14px',
    lineHeight: 1.55,
    color: TavariStyles.colors.gray700
  },
  hint: {
    fontSize: '13px',
    color: TavariStyles.colors.gray500,
    margin: '0 0 20px 0',
    lineHeight: 1.45
  },
  code: {
    fontSize: '13px',
    background: '#f0f2f5',
    padding: '2px 6px',
    borderRadius: 4
  },
  advancedToggle: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    marginTop: '8px',
    marginBottom: '8px',
    padding: '12px 0',
    background: 'none',
    border: 'none',
    color: TavariStyles.colors.gray600,
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  advancedPanel: {
    padding: '20px',
    backgroundColor: '#f9fafb',
    borderRadius: '12px',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    marginBottom: '20px'
  },
  tokenTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    margin: '0 0 10px 0',
    color: TavariStyles.colors.gray800
  },
  tokenHelp: {
    fontSize: '14px',
    color: TavariStyles.colors.gray600,
    lineHeight: 1.5,
    margin: '0 0 16px 0'
  },
  tokenRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '12px'
  },
  tokenCode: {
    flex: '1 1 240px',
    fontSize: '13px',
    padding: '12px 14px',
    backgroundColor: '#fff',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '8px',
    wordBreak: 'break-all'
  },
  outlineBtn: {
    backgroundColor: '#fff',
    color: TavariStyles.colors.gray700,
    border: `2px solid ${TavariStyles.colors.gray300}`,
    padding: '10px 18px',
    borderRadius: '8px',
    fontWeight: 'bold',
    fontSize: '14px',
    cursor: 'pointer'
  },
  muted: { color: TavariStyles.colors.gray500 },
  footerLink: { marginTop: '28px', fontSize: '15px' },
  link: { color: TavariStyles.colors.primary, fontWeight: 600 }
};

export default CustomerDisplaySetupScreen;
