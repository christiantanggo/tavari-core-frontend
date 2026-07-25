import { formatVendorLastReport } from '../../services/VendingMachine/VendingMachineService';
import './VendingKioskDebugPanel.css';

function levelClass(level) {
  if (level === 'error') return 'vending-debug-log--error';
  if (level === 'ok') return 'vending-debug-log--ok';
  if (level === 'warn') return 'vending-debug-log--warn';
  return '';
}

export default function VendingKioskDebugPanel({
  open,
  onToggle,
  embedded = false,
  snapshot,
  logs,
  onRunDiagnostics,
  onTestVend,
  onRefresh,
  onClearLog,
  onReload,
  diagnosticsRunning,
  testVending
}) {
  const lastSeen = formatVendorLastReport(snapshot?.lastVendorReport);

  return (
    <>
      {!embedded ? (
        <button
          type="button"
          className="vending-debug-fab"
          onClick={onToggle}
          aria-label="Open debug panel"
          aria-expanded={open}
        >
          {open ? '✕' : 'DBG'}
        </button>
      ) : null}

      {open ? (
        <div className="vending-debug-panel" role="dialog" aria-label="Kiosk debug">
          <div className="vending-debug-panel-header">
            <h3>Kiosk debug</h3>
            <span className="vending-debug-panel-time">{new Date().toLocaleTimeString()}</span>
          </div>

          <dl className="vending-debug-meta">
            <dt>Kiosk code</dt>
            <dd>{snapshot?.kioskShortCode || '—'}</dd>
            <dt>Status badge</dt>
            <dd>{snapshot?.statusLabel || '—'}</dd>
            <dt>Dispense API</dt>
            <dd className={snapshot?.isOnline ? 'vending-debug-val-ok' : 'vending-debug-val-bad'}>
              {snapshot?.isOnline ? 'online (can vend)' : 'offline (cannot vend)'}
            </dd>
            <dt>pingOnline</dt>
            <dd>{snapshot?.pingOnline == null ? '—' : snapshot.pingOnline ? 'true' : 'false'}</dd>
            <dt>detailOnline</dt>
            <dd>{snapshot?.detailOnline == null ? '—' : snapshot.detailOnline ? 'true' : 'false'}</dd>
            <dt>Portal stale?</dt>
            <dd>{snapshot?.portalMayShowOnline ? 'yes — portal may show Online while API is offline' : 'no'}</dd>
            <dt>Last check-in</dt>
            <dd>{lastSeen || '—'}</dd>
            <dt>Test vend</dt>
            <dd>{snapshot?.showTestVend ? 'enabled' : 'off'}</dd>
            <dt>Products</dt>
            <dd>
              {snapshot?.inventoryCount ?? 0}
              {snapshot?.firstGoodsId ? ` · first goods_id ${snapshot.firstGoodsId}` : ''}
            </dd>
            <dt>Busy</dt>
            <dd>
              {[
                snapshot?.refreshing ? 'refreshing' : null,
                snapshot?.orderPending ? 'order' : null,
                testVending ? 'test-vend' : null
              ]
                .filter(Boolean)
                .join(', ') || 'idle'}
            </dd>
            {snapshot?.lastError ? (
              <>
                <dt>Last error</dt>
                <dd className="vending-debug-val-bad">{snapshot.lastError}</dd>
              </>
            ) : null}
          </dl>

          <div className="vending-debug-actions">
            <button type="button" onClick={onRunDiagnostics} disabled={diagnosticsRunning}>
              {diagnosticsRunning ? 'Checking…' : 'Run diagnostics'}
            </button>
            <button type="button" onClick={onTestVend} disabled={testVending || !snapshot?.firstGoodsId}>
              {testVending ? 'Vending…' : 'Test vend'}
            </button>
            <button type="button" onClick={onRefresh}>
              Refresh
            </button>
            <button type="button" onClick={onClearLog}>
              Clear log
            </button>
            <button type="button" onClick={onReload}>
              Reload page
            </button>
          </div>

          <div className="vending-debug-log-wrap">
            <h4>Event log</h4>
            {logs?.length ? (
              <ul className="vending-debug-log">
                {logs.map((entry) => (
                  <li key={entry.id} className={levelClass(entry.level)}>
                    <span className="vending-debug-log-time">{entry.time}</span>{' '}
                    <span className="vending-debug-log-msg">{entry.message}</span>
                    {entry.detail ? (
                      <pre className="vending-debug-log-detail">{entry.detail}</pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="vending-debug-muted">No events yet — tap Run diagnostics.</p>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
