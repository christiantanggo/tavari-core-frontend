import React, { useCallback, useEffect, useState } from 'react';
import { TavariStyles } from '../../../utils/TavariStyles';
import {
  applyRegisterStationToDevice,
  createRegisterStation,
  deactivateRegisterStation,
  fetchRegisterStations,
  updateRegisterStation,
} from '../../../services/posRegisterStationsService';
import {
  buildEscPosTestSlipBytes,
  checkPrintAgentHealth,
  ensurePrintAgentReachable,
  getPrintAgentBaseUrl,
  sendEscPosToPrintAgent,
  setPrintAgentBaseUrl,
} from '../../../helpers/escposReceipt';
import { getDeviceReceiptPrinterConfig } from '../../../services/posRegisterStationsService';

const emptyDraft = (defaultFloatAmount) => ({
  terminal_name: '',
  location_description: '',
  helcim_device_code: '',
  float_amount: defaultFloatAmount,
  receipt_printer_ip: '',
  receipt_printer_port: 9100,
  receipt_printer_type: 'escpos',
});

const formatPrinterSummary = (station) => {
  const ip = station.receipt_printer_ip?.trim();
  const type = String(station.receipt_printer_type || '').toLowerCase();
  if (!ip || type === 'none') return 'Printer: not set';
  const port = Number(station.receipt_printer_port) || 9100;
  return `Printer: ${ip}:${port} (ESC/POS)`;
};

function resolveReceiptPrinterInstallerUrl() {
  const explicit = (import.meta.env.VITE_POS_PRINT_AGENT_INSTALLER_URL || '').trim();
  if (explicit) return explicit;

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  if (supabaseUrl) {
    return `${supabaseUrl}/storage/v1/object/public/waiver-installers/Tavari-Receipt-Printer-Setup.exe`;
  }

  return 'https://iagcamwcfuiopmwefohz.supabase.co/storage/v1/object/public/waiver-installers/Tavari-Receipt-Printer-Setup.exe';
}

function resolveChromeOsInstallerUrl() {
  const explicit = (import.meta.env.VITE_POS_PRINT_AGENT_CHROMEOS_URL || '').trim();
  if (explicit) return explicit;

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  if (supabaseUrl) {
    return `${supabaseUrl}/storage/v1/object/public/waiver-installers/Tavari-Receipt-Printer-ChromeOS-Install.sh`;
  }

  return 'https://iagcamwcfuiopmwefohz.supabase.co/storage/v1/object/public/waiver-installers/Tavari-Receipt-Printer-ChromeOS-Install.sh';
}

function detectLikelyChromeOs() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /CrOS/i.test(ua) || /Chromebook/i.test(ua);
}

const RegisterStationsSettings = ({
  businessId,
  defaultFloatAmount = 200,
  canEdit = false,
  currentTerminalId = null,
  onStationSelected,
  onStationsChanged,
}) => {
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(() => emptyDraft(defaultFloatAmount));
  const [agentHealthy, setAgentHealthy] = useState(null);
  const [agentUrlDraft, setAgentUrlDraft] = useState(() => getPrintAgentBaseUrl());
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const [testPrintBusy, setTestPrintBusy] = useState(false);
  const [testPrintMessage, setTestPrintMessage] = useState(null);
  const installerUrl = resolveReceiptPrinterInstallerUrl();
  const chromeOsInstallerUrl = resolveChromeOsInstallerUrl();
  const isChromeOs = detectLikelyChromeOs();
  const agentUrl = getPrintAgentBaseUrl();

  const refreshAgentHealth = useCallback(async () => {
    const ok = await checkPrintAgentHealth();
    setAgentHealthy(ok);
    setAgentUrlDraft(getPrintAgentBaseUrl());
    return ok;
  }, []);

  const handleReconnectHelper = async () => {
    setReconnectBusy(true);
    setError(null);
    try {
      const result = await ensurePrintAgentReachable();
      setAgentUrlDraft(result.url);
      setAgentHealthy(result.ok);
      if (!result.ok) {
        setError(
          isChromeOs
            ? 'Helper still offline. Open the Linux app once, then add Chrome OS port forwarding for 19100 and save http://127.0.0.1:19100.'
            : 'Helper still offline. Start Tavari Receipt Printer on this PC, then try again.'
        );
      }
    } finally {
      setReconnectBusy(false);
    }
  };

  const loadStations = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await fetchRegisterStations(businessId, { activeOnly: false });
    if (fetchError) {
      setError(fetchError.message || 'Failed to load register stations');
      setStations([]);
    } else {
      setStations((data || []).filter((station) => station.is_active));
    }
    setLoading(false);
    onStationsChanged?.(data || []);
  }, [businessId, onStationsChanged]);

  useEffect(() => {
    loadStations();
  }, [loadStations]);

  useEffect(() => {
    if (!editingId) {
      setDraft((prev) => ({ ...prev, float_amount: defaultFloatAmount }));
    }
  }, [defaultFloatAmount, editingId]);

  const hasAnyPrinterConfigured = stations.some(
    (station) =>
      station.receipt_printer_ip?.trim() &&
      String(station.receipt_printer_type || '').toLowerCase() !== 'none'
  );

  useEffect(() => {
    if (!hasAnyPrinterConfigured) {
      setAgentHealthy(null);
      return undefined;
    }

    let cancelled = false;
    const poll = async () => {
      const ok = await checkPrintAgentHealth();
      if (!cancelled) {
        setAgentHealthy(ok);
        setAgentUrlDraft(getPrintAgentBaseUrl());
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasAnyPrinterConfigured]);

  const resetDraft = () => {
    setEditingId(null);
    setDraft(emptyDraft(defaultFloatAmount));
  };

  const handleSave = async () => {
    if (!canEdit || !businessId) return;
    if (!draft.terminal_name.trim()) {
      setError('Station name is required');
      return;
    }

    setError(null);
    const payload = {
      terminal_name: draft.terminal_name,
      location_description: draft.location_description,
      helcim_device_code: draft.helcim_device_code,
      float_amount: draft.float_amount,
      receipt_printer_ip: draft.receipt_printer_ip,
      receipt_printer_port: draft.receipt_printer_port,
      receipt_printer_type: draft.receipt_printer_type,
    };

    const { error: saveError } = editingId
      ? await updateRegisterStation(editingId, businessId, payload)
      : await createRegisterStation(businessId, payload, defaultFloatAmount);

    if (saveError) {
      setError(saveError.message || 'Failed to save register station');
      return;
    }

    resetDraft();
    await loadStations();
  };

  const handleEdit = (station) => {
    setEditingId(station.id);
    setDraft({
      terminal_name: station.terminal_name,
      location_description: station.location_description || '',
      helcim_device_code: station.helcim_device_code || '',
      float_amount: Number(station.float_amount) || defaultFloatAmount,
      receipt_printer_ip: station.receipt_printer_ip || '',
      receipt_printer_port: Number(station.receipt_printer_port) || 9100,
      receipt_printer_type:
        String(station.receipt_printer_type || '').toLowerCase() === 'none' ? 'none' : 'escpos',
    });
  };

  const handleRemove = async (stationId) => {
    if (!canEdit || !window.confirm('Remove this register station?')) return;
    const { error: removeError } = await deactivateRegisterStation(stationId, businessId);
    if (removeError) {
      setError(removeError.message || 'Failed to remove register station');
      return;
    }
    if (editingId === stationId) resetDraft();
    await loadStations();
  };

  const handleUseOnThisDevice = (station) => {
    applyRegisterStationToDevice(station);
    onStationSelected?.(station.terminal_id, station);
  };

  const resolvePrinterTarget = (station = null) => {
    if (station?.receipt_printer_ip?.trim()) {
      const type = String(station.receipt_printer_type || '').toLowerCase();
      if (type === 'none') return null;
      return {
        ip: station.receipt_printer_ip.trim(),
        port: Number(station.receipt_printer_port) || 9100,
        stationName: station.terminal_name || null,
      };
    }
    const device = getDeviceReceiptPrinterConfig();
    if (!device?.ip) return null;
    return {
      ip: device.ip,
      port: device.port || 9100,
      stationName: null,
    };
  };

  const handleTestPrint = async (station = null) => {
    setTestPrintBusy(true);
    setTestPrintMessage(null);
    setError(null);
    try {
      const healthy = await checkPrintAgentHealth();
      setAgentHealthy(healthy);
      if (!healthy) {
        throw new Error(
          'Print helper is not reachable. Fix the helper URL / reconnect, then try again.'
        );
      }

      const target = resolvePrinterTarget(station);
      if (!target?.ip) {
        throw new Error(
          'No printer IP on this device. Click “Use on this device” on a station that has a printer, or tap Test print on that station row.'
        );
      }

      const bytes = buildEscPosTestSlipBytes({
        stationName: target.stationName,
        printerHost: target.ip,
        printerPort: target.port,
      });
      await sendEscPosToPrintAgent(bytes, { host: target.ip, port: target.port });
      setTestPrintMessage(`Test print sent to ${target.ip}:${target.port}`);
    } catch (err) {
      const detail = err?.message || String(err);
      setError(detail);
      setTestPrintMessage(null);
    } finally {
      setTestPrintBusy(false);
    }
  };

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Register Stations</h3>
      <p style={styles.description}>
        One station ties together POS sales, Helcim card terminal, cash drawer float, and receipt printer.
        Example: &quot;Concession counter&quot; with Helcim device code and ESC/POS printer IP.
      </p>

      {error && <div style={styles.error}>{error}</div>}

      {hasAnyPrinterConfigured && (
        <div style={styles.agentUrlBox}>
          <div style={styles.agentUrlRow}>
            <label style={styles.label}>
              Print helper URL (this device)
              <input
                type="text"
                value={agentUrlDraft}
                onChange={(e) => setAgentUrlDraft(e.target.value)}
                style={styles.input}
                placeholder="http://127.0.0.1:19100"
              />
            </label>
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => {
                const next = setPrintAgentBaseUrl(agentUrlDraft);
                setAgentUrlDraft(next);
                refreshAgentHealth();
              }}
            >
              Save helper URL
            </button>
            <button
              type="button"
              style={styles.secondaryButton}
              disabled={reconnectBusy}
              onClick={handleReconnectHelper}
            >
              {reconnectBusy ? 'Reconnecting…' : 'Reconnect helper'}
            </button>
          </div>
          <p style={styles.muted}>
            Current: <code>{agentUrl}/health</code>
            {agentHealthy === true ? ' · connected' : agentHealthy === false ? ' · not reachable' : ''}
            {'. After a power cut, open Linux once, then tap Reconnect. Prefer '}
            <code>http://127.0.0.1:19100</code>
            {' with Chrome OS port forwarding so reboots do not change the address.'}
          </p>
        </div>
      )}

      {hasAnyPrinterConfigured && agentHealthy === true && (
        <div style={styles.testPrintRow}>
          <p style={styles.healthOk}>
            Receipt printer helper is running on this PC. Employees can tap Print on the sale screen —
            no extra steps.
          </p>
          <button
            type="button"
            style={styles.primaryButton}
            disabled={testPrintBusy}
            onClick={() => handleTestPrint(null)}
          >
            {testPrintBusy ? 'Sending…' : 'Test print'}
          </button>
        </div>
      )}

      {testPrintMessage && <p style={styles.testPrintOk}>{testPrintMessage}</p>}

      {hasAnyPrinterConfigured && agentHealthy === false && (
        <div style={styles.healthWarn}>
          {isChromeOs ? (
            <>
              <p style={styles.healthWarnText}>
                This device looks like <strong>Chrome OS</strong>. After unplug/reboot, Linux often
                needs one wake-up — then printing should work again. Do this once so power cuts stay
                simple:
              </p>
              <ol style={styles.steps}>
                <li>
                  Open the <strong>Linux</strong> app once (wakes the helper). Tap{' '}
                  <strong>Reconnect helper</strong> above.
                </li>
                <li>
                  Chrome OS <strong>Settings → Developers → Linux → Port forwarding</strong> → add
                  port <code>19100</code> (TCP). Leave it on.
                </li>
                <li>
                  Save helper URL as <code>http://127.0.0.1:19100</code> — this survives reboots
                  (no more chasing <code>100.115.92.x</code>).
                </li>
                <li>
                  First-time only: in Linux terminal, install with:
                  <pre style={styles.codeBlock}>{`curl -fsSL "${chromeOsInstallerUrl}" | bash`}</pre>
                </li>
                <li>Click <strong>Use on this device</strong> on the concession station below</li>
              </ol>
              <a
                href={chromeOsInstallerUrl}
                style={styles.downloadButton}
                target="_blank"
                rel="noopener noreferrer"
                download="Tavari-Receipt-Printer-ChromeOS-Install.sh"
              >
                Download Chrome OS installer (.sh)
              </a>
              <p style={styles.muted}>
                Prefer a file? Download the <code>.sh</code>, move it into Linux, then run{' '}
                <code>bash Tavari-Receipt-Printer-ChromeOS-Install.sh</code>.
              </p>
            </>
          ) : (
            <>
              <p style={styles.healthWarnText}>
                Install <strong>Tavari Receipt Printer</strong> once on this PC. It starts at login and
                stays in the system tray so staff never need to run anything. After install, click
                &quot;Use on this device&quot; on the concession station.
              </p>
              <a
                href={installerUrl}
                style={styles.downloadButton}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download for Windows
              </a>
              <p style={styles.muted}>
                On a Chromebook instead? Open Linux terminal and run:{' '}
                <code>{`curl -fsSL "${chromeOsInstallerUrl}" | bash`}</code>
                {' '}Then add port forwarding for 19100 and set the helper URL to{' '}
                <code>http://127.0.0.1:19100</code>.
              </p>
            </>
          )}
        </div>
      )}

      {loading ? (
        <p style={styles.muted}>Loading register stations...</p>
      ) : stations.length === 0 ? (
        <p style={styles.muted}>No register stations yet. Add your first station below.</p>
      ) : (
        <div style={styles.list}>
          {stations.map((station) => (
            <div
              key={station.id}
              style={{
                ...styles.stationRow,
                ...(currentTerminalId === station.terminal_id ? styles.stationRowActive : {}),
              }}
            >
              <div>
                <strong>{station.terminal_name}</strong>
                {currentTerminalId === station.terminal_id && (
                  <span style={styles.activeBadge}>This device</span>
                )}
                <div style={styles.muted}>
                  POS ID: <code>{station.terminal_id}</code>
                </div>
                <div style={styles.muted}>
                  Float: ${Number(station.float_amount || 0).toFixed(2)}
                  {station.helcim_device_code
                    ? ` · Helcim: ${station.helcim_device_code}`
                    : ' · Helcim: not set'}
                  {station.location_description ? ` · ${station.location_description}` : ''}
                </div>
                <div style={styles.muted}>{formatPrinterSummary(station)}</div>
              </div>
              <div style={styles.actions}>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => handleUseOnThisDevice(station)}
                >
                  Use on this device
                </button>
                {station.receipt_printer_ip?.trim() &&
                  String(station.receipt_printer_type || '').toLowerCase() !== 'none' && (
                    <button
                      type="button"
                      style={styles.secondaryButton}
                      disabled={testPrintBusy}
                      onClick={() => handleTestPrint(station)}
                    >
                      {testPrintBusy ? 'Sending…' : 'Test print'}
                    </button>
                  )}
                {canEdit && (
                  <>
                    <button type="button" style={styles.secondaryButton} onClick={() => handleEdit(station)}>
                      Edit
                    </button>
                    <button type="button" style={styles.dangerButton} onClick={() => handleRemove(station.id)}>
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div style={styles.form}>
          <h4 style={styles.formTitle}>{editingId ? 'Edit Register Station' : 'Add Register Station'}</h4>
          <div style={styles.formGrid}>
            <label style={styles.label}>
              Station name
              <input
                type="text"
                value={draft.terminal_name}
                onChange={(e) => setDraft((prev) => ({ ...prev, terminal_name: e.target.value }))}
                style={styles.input}
                placeholder="Concession counter"
              />
            </label>
            <label style={styles.label}>
              Location (optional)
              <input
                type="text"
                value={draft.location_description}
                onChange={(e) => setDraft((prev) => ({ ...prev, location_description: e.target.value }))}
                style={styles.input}
                placeholder="Front entrance"
              />
            </label>
            <label style={styles.label}>
              Helcim device code
              <input
                type="text"
                value={draft.helcim_device_code}
                onChange={(e) => setDraft((prev) => ({ ...prev, helcim_device_code: e.target.value }))}
                style={styles.input}
                placeholder="JSV5"
              />
            </label>
            <label style={styles.label}>
              Cash drawer float
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.float_amount}
                onChange={(e) => setDraft((prev) => ({ ...prev, float_amount: parseFloat(e.target.value) || 0 }))}
                style={styles.input}
              />
            </label>
            <label style={styles.label}>
              Receipt printer type
              <select
                value={draft.receipt_printer_type}
                onChange={(e) => setDraft((prev) => ({ ...prev, receipt_printer_type: e.target.value }))}
                style={styles.input}
              >
                <option value="escpos">ESC/POS (network)</option>
                <option value="none">None (browser print only)</option>
              </select>
            </label>
            <label style={styles.label}>
              Receipt printer IP
              <input
                type="text"
                value={draft.receipt_printer_ip}
                onChange={(e) => setDraft((prev) => ({ ...prev, receipt_printer_ip: e.target.value }))}
                style={styles.input}
                placeholder="192.168.123.100"
                disabled={draft.receipt_printer_type === 'none'}
              />
            </label>
            <label style={styles.label}>
              Receipt printer port
              <input
                type="number"
                min="1"
                max="65535"
                value={draft.receipt_printer_port}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    receipt_printer_port: parseInt(e.target.value, 10) || 9100,
                  }))
                }
                style={styles.input}
                placeholder="9100"
                disabled={draft.receipt_printer_type === 'none'}
              />
            </label>
          </div>
          <div style={styles.formActions}>
            <button type="button" style={styles.primaryButton} onClick={handleSave}>
              {editingId ? 'Save Station' : 'Add Station'}
            </button>
            {editingId && (
              <button type="button" style={styles.secondaryButton} onClick={resetDraft}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  section: {
    marginTop: TavariStyles.spacing.xl,
    paddingTop: TavariStyles.spacing.lg,
    borderTop: `1px solid ${TavariStyles.colors.gray200}`,
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    marginBottom: TavariStyles.spacing.sm,
  },
  description: {
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.lg,
    lineHeight: TavariStyles.typography.lineHeight.relaxed,
  },
  healthOk: {
    color: TavariStyles.colors.gray700,
    backgroundColor: '#e8f7f0',
    border: '1px solid #a7e3c4',
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.md,
    marginBottom: 0,
    flex: 1,
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: TavariStyles.typography.lineHeight.relaxed,
  },
  testPrintRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.lg,
  },
  testPrintOk: {
    color: '#047857',
    backgroundColor: '#ecfdf5',
    border: '1px solid #a7f3d0',
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.sm + ' ' + TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.lg,
    fontSize: TavariStyles.typography.fontSize.sm,
  },
  healthWarn: {
    color: TavariStyles.colors.gray700,
    backgroundColor: '#fff8e8',
    border: '1px solid #f0d48a',
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.lg,
  },
  healthWarnText: {
    marginTop: 0,
    marginBottom: TavariStyles.spacing.md,
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: TavariStyles.typography.lineHeight.relaxed,
  },
  steps: {
    margin: `0 0 ${TavariStyles.spacing.md}`,
    paddingLeft: TavariStyles.spacing.lg,
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: TavariStyles.typography.lineHeight.relaxed,
    color: TavariStyles.colors.gray700,
  },
  codeBlock: {
    display: 'block',
    marginTop: TavariStyles.spacing.xs,
    marginBottom: TavariStyles.spacing.sm,
    padding: TavariStyles.spacing.sm,
    backgroundColor: TavariStyles.colors.gray100 || '#f3f4f6',
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: '13px',
    whiteSpace: 'pre-wrap',
    overflowX: 'auto',
  },
  agentUrlRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: TavariStyles.spacing.sm,
    alignItems: 'flex-end',
    marginBottom: TavariStyles.spacing.sm,
  },
  agentUrlBox: {
    marginBottom: TavariStyles.spacing.lg,
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: TavariStyles.borderRadius.md,
    backgroundColor: TavariStyles.colors.white,
  },
  downloadButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary,
    display: 'inline-block',
    textDecoration: 'none',
    marginBottom: TavariStyles.spacing.sm,
  },
  muted: {
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.sm,
  },
  error: {
    color: TavariStyles.colors.danger,
    marginBottom: TavariStyles.spacing.md,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm,
    marginBottom: TavariStyles.spacing.lg,
  },
  stationRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: TavariStyles.borderRadius.md,
    backgroundColor: TavariStyles.colors.gray50,
  },
  stationRowActive: {
    borderColor: TavariStyles.colors.primary,
    backgroundColor: `${TavariStyles.colors.primary}10`,
  },
  activeBadge: {
    marginLeft: TavariStyles.spacing.sm,
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.primary,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: TavariStyles.spacing.sm,
    justifyContent: 'flex-end',
  },
  form: {
    padding: TavariStyles.spacing.lg,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: TavariStyles.borderRadius.md,
    backgroundColor: TavariStyles.colors.white,
  },
  formTitle: {
    marginTop: 0,
    marginBottom: TavariStyles.spacing.md,
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: TavariStyles.spacing.md,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs,
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.medium,
  },
  input: {
    padding: TavariStyles.spacing.sm,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
  },
  formActions: {
    display: 'flex',
    gap: TavariStyles.spacing.sm,
    marginTop: TavariStyles.spacing.md,
  },
  primaryButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary,
  },
  secondaryButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.secondary,
  },
  dangerButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.danger,
  },
};

export default RegisterStationsSettings;
