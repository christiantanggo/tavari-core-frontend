import './VendingKioskPinPad.css';

const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

/**
 * Large on-screen PIN pad for tablet kiosks (no Android soft keyboard).
 */
export default function VendingKioskPinPad({
  title = 'Enter staff PIN',
  subtitle = '',
  children = null,
  pinInput = '',
  pinError = '',
  failedAttempts = 0,
  locked = false,
  busy = false,
  busyLabel = 'Checking PIN…',
  confirmLabel = null,
  cancelLabel = 'Cancel',
  onDigit,
  onClear,
  onBackspace,
  onConfirm = null,
  onCancel = null
}) {
  const handleKey = (key) => {
    if (locked || busy) return;
    if (key === 'clear') {
      onClear?.();
      return;
    }
    if (key === 'back') {
      onBackspace?.();
      return;
    }
    onDigit?.(key);
  };

  return (
    <div className="vending-kiosk-pin-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="vending-kiosk-pin-panel">
        <div className="vending-kiosk-pin">
          <h2>{title}</h2>
          {subtitle ? <p className="vending-kiosk-pin-hint">{subtitle}</p> : null}
          {children}

          <div className="vending-kiosk-pin-dots" aria-live="polite" aria-label="PIN length">
            {[0, 1, 2, 3].map((idx) => (
              <span
                key={idx}
                className={`vending-kiosk-pin-dot ${pinInput.length > idx ? 'is-filled' : ''}`}
              />
            ))}
          </div>

          {pinError ? <p className="vending-kiosk-pin-error">{pinError}</p> : null}
          {locked ? (
            <p className="vending-kiosk-pin-error">Locked — contact a manager</p>
          ) : (
            <p className="vending-kiosk-pin-attempts">Attempts: {failedAttempts}/3</p>
          )}
          {busy ? <p className="vending-kiosk-pin-busy">{busyLabel}</p> : null}

          <div className="vending-kiosk-pin-pad" role="group" aria-label="PIN number pad">
            {PAD_KEYS.map((key) => {
              const isAction = key === 'clear' || key === 'back';
              const label = key === 'clear' ? 'Clear' : key === 'back' ? '⌫' : key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`vending-kiosk-pin-key ${isAction ? 'vending-kiosk-pin-key--action' : ''}`}
                  onClick={() => handleKey(key)}
                  disabled={locked || busy}
                  aria-label={key === 'back' ? 'Backspace' : key === 'clear' ? 'Clear' : `Digit ${key}`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="vending-kiosk-pin-actions">
            {onCancel ? (
              <button
                type="button"
                className="vending-kiosk-pin-cancel"
                onClick={onCancel}
                disabled={busy}
              >
                {cancelLabel}
              </button>
            ) : null}
            {onConfirm && confirmLabel ? (
              <button
                type="button"
                className="vending-kiosk-pin-confirm"
                onClick={onConfirm}
                disabled={locked || busy || pinInput.length !== 4}
              >
                {confirmLabel}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
