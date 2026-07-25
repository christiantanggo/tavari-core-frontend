import { useCallback, useEffect, useState } from 'react';
import MachineStatus from './MachineStatus';
import VendingKioskDebugPanel from './VendingKioskDebugPanel';
import VendingKioskPinPad from './VendingKioskPinPad';
import { useVendingStaffPin } from '../../hooks/useVendingStaffPin';
import {
  defaultRs485LaneByte,
  getSlotColsForRow,
  VENDING_SLOT_ROWS
} from '../../utils/vendingSlotChecklist';
import { localRs485Vend } from '../../services/VendingMachine/localRs485Bridge';
import './VendingStaffPanel.css';

const STAFF_SESSION_MS = 10 * 60 * 1000;

export default function VendingStaffPanel({
  businessId,
  kioskShortCode,
  isOnline,
  catalogReady,
  initialLoading,
  lastVendorReport,
  portalMayShowOnline,
  refreshing,
  orderPending,
  showTestVend,
  rs485Override,
  dispenseMode,
  inventory,
  onRefresh,
  onTestVend,
  onTestCheckout,
  cartItemCount = 0,
  cartLineCount = 0,
  debugOpen,
  onDebugOpenChange,
  debugSnapshot,
  debugLogs,
  onRunDiagnostics,
  onClearLog,
  onReload,
  diagnosticsRunning,
  testVending,
  onDebugLog
}) {
  const { verifyPin, prefetchPins } = useVendingStaffPin(businessId);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [manualRow, setManualRow] = useState(1);
  const [manualCol, setManualCol] = useState(1);
  const [manualVending, setManualVending] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);
  const [pinBusy, setPinBusy] = useState(false);

  const maxCols = getSlotColsForRow(manualRow);
  const manualLane = defaultRs485LaneByte(manualRow, manualCol);
  const isRs485 = dispenseMode === 'rs485' || rs485Override;
  const pinLocked = failedAttempts >= 3;

  const lockPanel = useCallback(() => {
    setUnlocked(false);
    setPanelOpen(false);
    setStaffName('');
    setPinInput('');
    setPinError('');
    setSessionExpiresAt(null);
    onDebugOpenChange(false);
  }, [onDebugOpenChange]);

  const closePanelKeepSession = useCallback(() => {
    setPanelOpen(false);
    onDebugOpenChange(false);
  }, [onDebugOpenChange]);

  useEffect(() => {
    if (!unlocked || !sessionExpiresAt) return undefined;
    const remaining = sessionExpiresAt - Date.now();
    if (remaining <= 0) {
      lockPanel();
      return undefined;
    }
    const timer = setTimeout(lockPanel, remaining);
    return () => clearTimeout(timer);
  }, [unlocked, sessionExpiresAt, lockPanel]);

  const touchSession = useCallback(() => {
    setSessionExpiresAt(Date.now() + STAFF_SESSION_MS);
  }, []);

  const openPinModal = () => {
    setPinInput('');
    setPinError('');
    setPinModalOpen(true);
    prefetchPins?.().catch(() => {});
  };

  const closePinModal = () => {
    setPinModalOpen(false);
    setPinInput('');
    setPinError('');
    setPinBusy(false);
  };

  const handleReloadKiosk = () => {
    touchSession();
    setLastAction('Reloading kiosk…');
    onDebugLog?.({ level: 'info', message: 'Staff requested full kiosk reload' });
    // Full page reload — same recovery as desktop browser refresh / debug "Reload page".
    if (typeof onReload === 'function') {
      onReload();
      return;
    }
    window.location.reload();
  };

  const handleRefreshProducts = () => {
    touchSession();
    setLastAction('Refreshing products & status…');
    onRefresh?.();
  };

  const handlePinUnlock = async (pinValue) => {
    const pin = String(pinValue ?? pinInput).trim();
    if (pin.length !== 4 || pinBusy || pinLocked) return;
    setPinBusy(true);
    setPinError('');
    try {
      const result = await verifyPin(pin);
      if (!result.ok) {
        setFailedAttempts((n) => n + 1);
        if (result.reason === 'no_business') {
          setPinError('Kiosk not linked to a business yet.');
        } else if (result.reason === 'no_staff_pins') {
          setPinError('No staff PINs found for this location.');
        } else {
          setPinError('Incorrect PIN.');
        }
        setPinInput('');
        return;
      }
      closePinModal();
      setFailedAttempts(0);
      setStaffName(result.employee?.name || 'Staff');
      setUnlocked(true);
      setPanelOpen(true);
      touchSession();
      onDebugLog?.({ level: 'info', message: 'Staff panel unlocked', detail: { staff: result.employee?.name } });
    } finally {
      setPinBusy(false);
    }
  };

  const handlePinDigit = (digit) => {
    if (pinLocked || pinBusy) return;
    setPinError('');
    setPinInput((prev) => {
      if (prev.length >= 4) return prev;
      const next = `${prev}${digit}`;
      if (next.length === 4) {
        setTimeout(() => handlePinUnlock(next), 0);
      }
      return next;
    });
  };

  const handleManualVend = async () => {
    if (!isRs485 || manualVending) return;
    if (manualCol > maxCols) {
      setLastAction(`Row ${manualRow} only has ${maxCols} columns`);
      return;
    }
    setManualVending(true);
    setLastAction(`Vending row ${manualRow}, col ${manualCol} (lane ${manualLane})…`);
    try {
      await localRs485Vend({ lane: manualLane });
      setLastAction(`Vended lane ${manualLane} (row ${manualRow}-${manualCol})`);
      onDebugLog?.({
        level: 'ok',
        message: 'Staff manual slot vend',
        detail: { row: manualRow, col: manualCol, lane: manualLane }
      });
      touchSession();
    } catch (err) {
      const msg = err.message || 'Manual vend failed';
      setLastAction(msg);
      onDebugLog?.({ level: 'error', message: 'Staff manual vend failed', detail: { message: msg } });
    } finally {
      setManualVending(false);
    }
  };

  const handleStaffTestVend = async () => {
    const product = inventory?.[0];
    if (!product) {
      setLastAction('No products loaded');
      return;
    }
    touchSession();
    await onTestVend?.(product);
  };

  return (
    <>
      <button
        type="button"
        className="vending-staff-trigger"
        onClick={() => {
          // Always require staff PIN to open manage controls (not purchase checkout).
          if (unlocked && panelOpen) {
            closePanelKeepSession();
            return;
          }
          openPinModal();
        }}
        aria-label={panelOpen ? 'Close staff menu' : 'Staff manage login'}
        title={panelOpen ? 'Close staff menu' : 'Staff manage (PIN)'}
      >
        {unlocked && panelOpen ? '⚙' : '🔒'}
      </button>

      {unlocked && panelOpen ? (
        <div className="vending-staff-panel" role="dialog" aria-label="Staff controls">
          <div className="vending-staff-panel-header">
            <div>
              <h2>Staff manage</h2>
              <p className="vending-staff-panel-sub">{staffName}</p>
            </div>
            <button type="button" className="vending-staff-lock-btn" onClick={lockPanel}>
              Lock
            </button>
          </div>

          <section className="vending-staff-reload-section">
            <h3>Kiosk recovery</h3>
            <p className="vending-staff-help">
              Use these on the tablet when products did not load (e.g. Wi‑Fi came on late) or the screen is stuck.
            </p>
            <div className="vending-staff-reload-actions">
              <button
                type="button"
                className="vending-staff-reload-btn vending-staff-reload-btn--primary"
                onClick={handleReloadKiosk}
              >
                Reload kiosk
              </button>
              <button
                type="button"
                className="vending-staff-reload-btn"
                onClick={handleRefreshProducts}
                disabled={refreshing}
              >
                {refreshing ? 'Refreshing…' : 'Refresh products'}
              </button>
            </div>
          </section>

          {showTestVend ? (
            <p className="vending-staff-test-banner">
              Test mode — use cart &quot;Test vend order&quot; for multi-item orders
              {rs485Override ? ' · RS485' : ''}
            </p>
          ) : null}

          {lastAction ? <p className="vending-staff-last-action">{lastAction}</p> : null}

          <MachineStatus
            isOnline={isOnline}
            catalogReady={catalogReady}
            initialLoading={initialLoading}
            lastVendorReport={lastVendorReport}
            portalMayShowOnline={portalMayShowOnline}
            refreshing={refreshing || orderPending}
            onRefresh={handleRefreshProducts}
          />

          {isRs485 ? (
            <section className="vending-staff-manual-vend">
              <h3>Manual slot vend</h3>
              <p className="vending-staff-help">
                Use when a product is stuck or a paid vend failed. Select row and column, then vend.
              </p>
              <div className="vending-staff-manual-row">
                <label>
                  Row
                  <select
                    value={manualRow}
                    onChange={(e) => {
                      const row = Number(e.target.value);
                      setManualRow(row);
                      if (manualCol > getSlotColsForRow(row)) setManualCol(1);
                      touchSession();
                    }}
                  >
                    {Array.from({ length: VENDING_SLOT_ROWS }, (_, i) => i + 1).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Column
                  <select
                    value={manualCol}
                    onChange={(e) => {
                      setManualCol(Number(e.target.value));
                      touchSession();
                    }}
                  >
                    {Array.from({ length: maxCols }, (_, i) => i + 1).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="vending-staff-lane">Lane {manualLane}</span>
                <button
                  type="button"
                  className="vending-staff-vend-btn"
                  onClick={handleManualVend}
                  disabled={manualVending}
                >
                  {manualVending ? 'Vending…' : 'Vend slot'}
                </button>
              </div>
            </section>
          ) : null}

          {showTestVend ? (
            <div className="vending-staff-actions">
              {cartLineCount > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    touchSession();
                    onTestCheckout?.();
                  }}
                  disabled={testVending}
                >
                  {testVending
                    ? 'Dispensing test order…'
                    : `Test vend cart (${cartItemCount} item${cartItemCount === 1 ? '' : 's'})`}
                </button>
              ) : null}
              <button type="button" onClick={handleStaffTestVend} disabled={testVending || !inventory?.length}>
                {testVending ? 'Test vending…' : 'Test vend first product only'}
              </button>
            </div>
          ) : null}

          <div className="vending-staff-debug-wrap">
            <button
              type="button"
              className="vending-staff-debug-toggle"
              onClick={() => {
                touchSession();
                onDebugOpenChange(!debugOpen);
              }}
            >
              {debugOpen ? 'Hide debug' : 'Show debug'}
            </button>
            {debugOpen ? (
              <VendingKioskDebugPanel
                embedded
                open
                snapshot={debugSnapshot}
                logs={debugLogs}
                onRunDiagnostics={() => {
                  touchSession();
                  onRunDiagnostics?.();
                }}
                onTestVend={() => {
                  touchSession();
                  handleStaffTestVend();
                }}
                onRefresh={handleRefreshProducts}
                onClearLog={onClearLog}
                onReload={handleReloadKiosk}
                diagnosticsRunning={diagnosticsRunning}
                testVending={testVending}
              />
            ) : null}
          </div>

          {kioskShortCode ? (
            <p className="vending-staff-meta">Kiosk: {kioskShortCode}</p>
          ) : null}
        </div>
      ) : null}

      {pinModalOpen ? (
        <VendingKioskPinPad
          title="Staff manage login"
          subtitle="Enter your 4-digit staff PIN to manage this machine (refresh, reload, manual vend)."
          pinInput={pinInput}
          pinError={pinError}
          failedAttempts={failedAttempts}
          locked={pinLocked}
          busy={pinBusy}
          onDigit={handlePinDigit}
          onClear={() => {
            setPinInput('');
            setPinError('');
          }}
          onBackspace={() => {
            setPinError('');
            setPinInput((prev) => prev.slice(0, -1));
          }}
          onCancel={closePinModal}
          cancelLabel="Cancel"
        />
      ) : null}
    </>
  );
}
