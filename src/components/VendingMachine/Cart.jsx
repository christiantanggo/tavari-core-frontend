// src/components/VendingMachine/Cart.jsx

import { useEffect, useMemo, useRef, useState } from 'react';
import './Cart.css';

const CART_IDLE_CLEAR_SECONDS = 60;

const Cart = ({
  items,
  onRemove,
  onUpdateQuantity,
  onClearCart,
  subtotal,
  taxCalculation,
  taxCalc,
  totalWithTax,
  onCheckout,
  disabled,
  testMode = false,
  staffPinMode = false,
  testProgress = null,
  dockLayout = false,
  pauseClearTimer = false
}) => {
  const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
  const rootClass = dockLayout ? 'cart cart--dock' : 'cart';
  const [secondsLeft, setSecondsLeft] = useState(CART_IDLE_CLEAR_SECONDS);
  const onClearCartRef = useRef(onClearCart);
  onClearCartRef.current = onClearCart;

  const cartFingerprint = useMemo(
    () => items.map((item) => `${item.goodsId}:${item.quantity}`).join('|'),
    [items]
  );

  useEffect(() => {
    if (!items.length || pauseClearTimer || disabled) {
      setSecondsLeft(CART_IDLE_CLEAR_SECONDS);
      return undefined;
    }

    setSecondsLeft(CART_IDLE_CLEAR_SECONDS);
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onClearCartRef.current?.();
          return CART_IDLE_CLEAR_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [cartFingerprint, items.length, pauseClearTimer, disabled]);

  const formatTax = (amount) =>
    taxCalc?.formatTaxAmount ? taxCalc.formatTaxAmount(amount) : Number(amount).toFixed(2);

  if (items.length === 0) {
    return (
      <div className={`${rootClass} cart--empty`}>
        <div className="cart-empty">
          <p>Your cart is empty</p>
          <span>🛒</span>
        </div>
      </div>
    );
  }

  const summaryBlock = (
    <div className="cart-footer-summary">
      <p className="cart-clear-timer" aria-live="polite">
        Clears in <strong>{secondsLeft}s</strong>
      </p>

      {!staffPinMode ? (
        <>
          <div className="cart-summary-row">
            <span className="cart-summary-label">Subtotal:</span>
            <span className="cart-summary-value">${subtotal.toFixed(2)}</span>
          </div>

          {taxCalculation?.totalTax > 0 ? (
            <>
              {Object.entries(taxCalculation.aggregatedTaxes).map(([taxName, amount]) => (
                <div key={taxName} className="cart-summary-row cart-summary-tax">
                  <span className="cart-summary-label">{taxName}:</span>
                  <span className="cart-summary-value">${formatTax(amount)}</span>
                </div>
              ))}
              {Object.entries(taxCalculation.aggregatedRebates || {}).map(([rebateName, amount]) => (
                <div key={rebateName} className="cart-summary-row cart-summary-rebate">
                  <span className="cart-summary-label">{rebateName}:</span>
                  <span className="cart-summary-value">-${formatTax(amount)}</span>
                </div>
              ))}
            </>
          ) : null}
        </>
      ) : null}

      <div className="cart-total">
        <span className="cart-total-label">
          {testMode ? 'Order total (test):' : staffPinMode ? 'Items:' : 'Total:'}
        </span>
        <span className="cart-total-amount">
          {staffPinMode ? totalUnits : `$${totalWithTax.toFixed(2)}`}
        </span>
      </div>

      <button
        type="button"
        className="cart-clear-btn"
        onClick={() => onClearCart?.()}
        disabled={disabled}
      >
        Clear cart
      </button>

      {testProgress ? (
        <p className="cart-test-progress">
          Dispensing {testProgress.current} of {testProgress.total}
          {testProgress.goodsName ? ` — ${testProgress.goodsName}` : ''}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className={rootClass}>
      <div className="cart-dock-left">
        <h2 className="cart-title">Cart ({items.length})</h2>
        {testMode ? (
          <p className="cart-test-hint">
            Test mode — no payment; vends all {totalUnits} item{totalUnits === 1 ? '' : 's'}
          </p>
        ) : null}
        {staffPinMode ? (
          <p className="cart-test-hint">
            Staff mode — PIN required; {totalUnits} item{totalUnits === 1 ? '' : 's'} will be logged
          </p>
        ) : null}

        <div className="cart-items">
          {items.map((item) => (
            <div key={item.goodsId} className="cart-item">
              <div className="cart-item-info">
                <h4 className="cart-item-name">{item.goodsName || item.name}</h4>
                {!staffPinMode ? (
                  <p className="cart-item-price">${parseFloat(item.price || 0).toFixed(2)}</p>
                ) : null}
              </div>

              <div className="cart-item-controls">
                <button
                  type="button"
                  className="cart-quantity-btn"
                  onClick={() => onUpdateQuantity(item.goodsId, item.quantity - 1)}
                  disabled={disabled}
                >
                  −
                </button>
                <span className="cart-quantity">{item.quantity}</span>
                <button
                  type="button"
                  className="cart-quantity-btn"
                  onClick={() => onUpdateQuantity(item.goodsId, item.quantity + 1)}
                  disabled={disabled}
                >
                  +
                </button>
                <button
                  type="button"
                  className="cart-remove-btn"
                  onClick={() => onRemove(item.goodsId)}
                  disabled={disabled}
                  aria-label={`Remove ${item.goodsName || 'item'}`}
                >
                  ×
                </button>
              </div>

              {!staffPinMode ? (
                <div className="cart-item-total">
                  ${(parseFloat(item.price || 0) * item.quantity).toFixed(2)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="cart-footer">
        {summaryBlock}
        <button
          type="button"
          className={`cart-checkout-btn ${testMode ? 'cart-checkout-btn--test' : ''} ${staffPinMode ? 'cart-checkout-btn--staff' : ''}`}
          onClick={onCheckout}
          disabled={disabled}
        >
          {disabled && testProgress
            ? 'Dispensing…'
            : testMode
              ? `Test vend order (${totalUnits})`
              : staffPinMode
                ? `Staff checkout (${totalUnits})`
                : 'Pay & checkout'}
        </button>
      </div>
    </div>
  );
};

export default Cart;
