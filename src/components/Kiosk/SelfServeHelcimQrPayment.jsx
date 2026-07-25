/**
 * Self-serve kiosk: Helcim hosted checkout URL shown as a QR code so the customer pays on their phone
 * (card entry, Google Pay on supported Android/Chrome — wallet options are controlled by Helcim).
 *
 * Two flows:
 * - Manual: enter amount (standalone kiosk URL).
 * - Checkout: fixed total + label from cart (`checkoutAmount` / `checkoutLabel`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../../supabaseClient';
import { getHelcimPayCheckoutPageUrl } from '../../helpers/helcimPayIframe.js';
import { getFunctionsInvokeErrorMessage } from '../../helpers/functionsInvokeError';
import './SelfServeHelcimQrPayment.css';

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'CAD' }).format(
      Number(amount),
    );
  } catch {
    return `${Number(amount).toFixed(2)} ${currency || 'CAD'}`;
  }
}

export default function SelfServeHelcimQrPayment({
  businessId,
  initialAmount = null,
  initialLabel = '',
  currency = 'CAD',
  /** Cart checkout: fixed total — hides manual amount fields */
  checkoutAmount = null,
  checkoutLabel = '',
  onCancelCheckout,
  onPaymentComplete,
  /** Ms before resetting UI after success (default 8s). Vending uses 0 + immediate onPaymentComplete. */
  completeDelayMs = 8000,
  /** Customer kiosk: avoid stacking toasts over header controls */
  quietMode = false,
}) {
  const isCheckoutMode =
    checkoutAmount != null && Number.isFinite(Number(checkoutAmount)) && Number(checkoutAmount) > 0;

  const [step, setStep] = useState('setup');
  const [amountInput, setAmountInput] = useState(
    !isCheckoutMode && initialAmount != null && Number(initialAmount) > 0
      ? String(Number(initialAmount).toFixed(2))
      : '',
  );
  const [labelInput, setLabelInput] = useState(
    isCheckoutMode ? String(checkoutLabel || '') : initialLabel || '',
  );
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [checkoutToken, setCheckoutToken] = useState(null);
  const [payUrl, setPayUrl] = useState(null);

  const finalizedRef = useRef(false);
  const channelRef = useRef(null);
  const pollRef = useRef(null);
  const checkoutTokenRef = useRef(null);

  const cleanupListeners = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const handlePaid = useCallback(
    (tokenOverride) => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      cleanupListeners();
      const token = tokenOverride ?? checkoutTokenRef.current ?? checkoutToken;
      if (!token) {
        finalizedRef.current = false;
        setErrorMessage('Payment detected but session token is missing — tap “I paid on my phone”.');
        return;
      }
      onPaymentComplete?.({ checkoutToken: token });
      setStep('paid');
      if (!quietMode) toast.success('Payment received');
      window.setTimeout(() => {
        finalizedRef.current = false;
        setStep('setup');
        setCheckoutToken(null);
        checkoutTokenRef.current = null;
        setPayUrl(null);
        if (!isCheckoutMode) {
          setAmountInput(
            initialAmount != null && Number(initialAmount) > 0 ? String(Number(initialAmount).toFixed(2)) : '',
          );
        }
      }, completeDelayMs);
    },
    [cleanupListeners, initialAmount, isCheckoutMode, onPaymentComplete, checkoutToken, completeDelayMs, quietMode],
  );

  const pollStatus = useCallback(
    async (token) => {
      try {
        const { data, error } = await supabase.functions.invoke('helcim-pay-status', {
          body: { checkoutToken: token },
        });
        if (error) return;
        if (data?.status === 'completed') handlePaid(token);
      } catch {
        /* ignore */
      }
    },
    [handlePaid],
  );

  const subscribeRealtime = useCallback(
    (token) => {
      const channelName = `helcim-payment-${token}`;
      const ch = supabase
        .channel(channelName)
        .on('broadcast', { event: 'payment_completed' }, (payload) => {
          if (finalizedRef.current) return;
          const p = payload?.payload ?? payload;
          if (p?.kioskPayment || p?.status === 'completed') handlePaid(token);
        });
      ch.subscribe();
      channelRef.current = ch;

      pollRef.current = window.setInterval(() => pollStatus(token), 2800);
    },
    [handlePaid, pollStatus],
  );

  const startCheckout = async () => {
    const raw = isCheckoutMode
      ? Number(checkoutAmount)
      : parseFloat(String(amountInput).replace(/,/g, '.'));
    const helcimLabel = isCheckoutMode
      ? String(checkoutLabel || '').trim()
      : labelInput.trim();

    if (!businessId || !Number.isFinite(raw) || raw <= 0) {
      setErrorMessage(isCheckoutMode ? 'Invalid order total.' : 'Enter a valid amount.');
      return;
    }
    setErrorMessage('');
    finalizedRef.current = false;
    cleanupListeners();
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('helcim-pay-init', {
        body: {
          mode: 'kiosk',
          businessId,
          amount: Number(raw.toFixed(2)),
          currency: (currency || 'CAD').toUpperCase(),
          kioskLabel: helcimLabel || undefined,
        },
      });
      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        throw new Error(msg);
      }
      const token = data?.checkoutToken;
      if (!token) throw new Error(data?.error || 'No checkout session');

      const url = getHelcimPayCheckoutPageUrl(token, { allowExit: true });
      if (!url) throw new Error('Could not build payment link');

      setCheckoutToken(token);
      checkoutTokenRef.current = token;
      setPayUrl(url);
      setStep('paying');
      subscribeRealtime(token);
    } catch (e) {
      console.error('[SelfServeHelcimQrPayment]', e);
      const msg = e?.message || 'Could not start payment';
      setErrorMessage(msg);
      if (!quietMode) toast.error(msg);
      setStep('setup');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => () => cleanupListeners(), [cleanupListeners]);

  const displayAmount = isCheckoutMode
    ? Number(checkoutAmount)
    : parseFloat(amountInput) || 0;
  const amountDisplay = formatMoney(displayAmount, currency);

  if (step === 'paid') {
    return (
      <div className="self-serve-helcim self-serve-helcim--success">
        <div className="self-serve-helcim__card">
          <h1 className="self-serve-helcim__title">Thank you</h1>
          <p className="self-serve-helcim__subtitle">Your payment went through.</p>
          <p className="self-serve-helcim__hint">This screen will reset shortly for the next guest.</p>
        </div>
      </div>
    );
  }

  if (step === 'paying' && payUrl && checkoutToken) {
    return (
      <div className="self-serve-helcim">
        <div className="self-serve-helcim__card">
          <p className="self-serve-helcim__amount">{amountDisplay}</p>
          <p className="self-serve-helcim__instructions">
            Scan with your phone to pay with card or Google Pay (where your phone and browser support it).
          </p>
          <div className="self-serve-helcim__qr-wrap">
            <QRCodeSVG value={payUrl} size={280} level="M" includeMargin />
          </div>
          <p className="self-serve-helcim__waiting">Waiting for payment…</p>
          <button
            type="button"
            className="self-serve-helcim__btn"
            onClick={() => pollStatus(checkoutToken)}
          >
            I paid on my phone
          </button>
          <button
            type="button"
            className="self-serve-helcim__btn self-serve-helcim__btn--ghost"
            onClick={() => {
              cleanupListeners();
              finalizedRef.current = false;
              setCheckoutToken(null);
              checkoutTokenRef.current = null;
              setPayUrl(null);
              setStep('setup');
              onCancelCheckout?.();
            }}
          >
            {isCheckoutMode ? '← Back to order' : 'Cancel'}
          </button>
        </div>
      </div>
    );
  }

  if (isCheckoutMode) {
    return (
      <div className="self-serve-helcim">
        <div className="self-serve-helcim__card">
          <h1 className="self-serve-helcim__title">Pay on your phone</h1>
          <p className="self-serve-helcim__subtitle">
            We’ll show a QR code. Scan it to complete checkout with your mobile wallet or card.
          </p>
          <p className="self-serve-helcim__amount">{amountDisplay}</p>
          {checkoutLabel ? (
            <p className="self-serve-helcim__checkout-summary">{checkoutLabel}</p>
          ) : null}
          {errorMessage ? <p className="self-serve-helcim__error">{errorMessage}</p> : null}
          <button type="button" className="self-serve-helcim__btn" onClick={startCheckout} disabled={loading}>
            {loading ? 'Starting…' : 'Show payment QR'}
          </button>
          <button
            type="button"
            className="self-serve-helcim__btn self-serve-helcim__btn--ghost"
            onClick={() => onCancelCheckout?.()}
            disabled={loading}
          >
            ← Back to review
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="self-serve-helcim">
      <div className="self-serve-helcim__card">
        <h1 className="self-serve-helcim__title">Pay here</h1>
        <p className="self-serve-helcim__subtitle">Enter the amount, then show the QR code to pay on your phone.</p>

        <label className="self-serve-helcim__label">
          Amount ({currency})
          <input
            className="self-serve-helcim__input"
            type="text"
            inputMode="decimal"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="0.00"
            disabled={loading}
          />
        </label>

        <label className="self-serve-helcim__label">
          Description (optional)
          <input
            className="self-serve-helcim__input"
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            placeholder="e.g. Drop-in pass"
            maxLength={240}
            disabled={loading}
          />
        </label>

        {errorMessage ? <p className="self-serve-helcim__error">{errorMessage}</p> : null}

        <button type="button" className="self-serve-helcim__btn" onClick={startCheckout} disabled={loading}>
          {loading ? 'Starting…' : 'Show payment QR'}
        </button>
      </div>
    </div>
  );
}
