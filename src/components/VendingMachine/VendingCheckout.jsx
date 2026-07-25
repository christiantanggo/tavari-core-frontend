// Vending kiosk checkout: Helcim QR pay → verified dispense

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import SelfServeHelcimQrPayment from '../Kiosk/SelfServeHelcimQrPayment';
import vendingService from '../../services/VendingMachine/VendingMachineService';
import { localRs485VendLanes } from '../../services/VendingMachine/localRs485Bridge';
import TaxBreakdown from '../POS/POSPaymentScreenComponents/TaxBreakdown';
import { calculateVendingCartTax } from '../../utils/vendingTaxHelpers';
import './VendingCheckout.css';

function formatMoney(amount, currency = 'CAD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `$${Number(amount).toFixed(2)}`;
  }
}

function buildKioskAuth({ kioskShortCode, businessId, deviceId, kioskSecret }) {
  if (kioskShortCode) return { kioskShortCode };
  return { businessId, externalDeviceId: deviceId, kioskSecret };
}

async function dispenseItemsLocally({ items, kioskAuth, orderPrefix }) {
  const dispenseResults = [];

  for (const item of items) {
    const goodsId = String(item.goodsId || '').trim();
    const qty = Math.max(1, Math.min(20, Number(item.quantity) || 1));
    if (!goodsId) continue;

    for (let q = 0; q < qty; q += 1) {
      const orderNo = `${orderPrefix}-${goodsId}-${q}`;
      try {
        await localRs485VendLanes({ product: item, lanes: item.rs485LaneBytes });
        await vendingService.recordKioskLocalDispense({
          ...kioskAuth,
          goodsId,
          orderNo
        });
        dispenseResults.push({ goodsId, orderNo, ok: true });
      } catch (err) {
        dispenseResults.push({
          goodsId,
          orderNo,
          ok: false,
          msg: err.message || 'RS485 dispense failed'
        });
      }
    }
  }

  return dispenseResults;
}

export default function VendingCheckout({
  kioskShortCode,
  businessId,
  deviceId,
  kioskSecret,
  items,
  cartPricing,
  taxCalc,
  currency = 'CAD',
  isOnline,
  dispenseMode,
  rs485Override = false,
  quietMode = false,
  onClose,
  onComplete
}) {
  const [checkoutError, setCheckoutError] = useState('');
  const [dispensePhase, setDispensePhase] = useState('idle');

  const isRs485 = dispenseMode === 'rs485' || rs485Override;
  const kioskAuth = buildKioskAuth({ kioskShortCode, businessId, deviceId, kioskSecret });

  const pricing = useMemo(() => {
    if (cartPricing) return cartPricing;
    return calculateVendingCartTax(items, taxCalc);
  }, [cartPricing, items, taxCalc, taxCalc?.loading]);

  const { subtotal, totalTax, totalWithTax, aggregatedTaxes, aggregatedRebates } = pricing;

  const checkoutLabel = items
    .map((item) => `${item.quantity}× ${item.goodsName || 'Item'}`)
    .join(', ')
    .slice(0, 240);

  const totalItemCount = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);

  const notifyError = (message) => {
    setCheckoutError(message);
    if (!quietMode) toast.error(message, { duration: 8000 });
  };

  const handlePaymentComplete = async ({ checkoutToken }) => {
    setCheckoutError('');
    if (!checkoutToken) {
      notifyError('Payment session missing — contact staff.');
      return;
    }

    try {
      setDispensePhase('dispensing');
      if (!quietMode) {
        toast.loading(
          totalItemCount > 1 ? 'Payment received — dispensing items…' : 'Payment received — dispensing…',
          { id: 'vending-dispense' }
        );
      }

      const result = await vendingService.fulfillPaidOrder({
        ...kioskAuth,
        checkoutToken,
        expectedTotal: totalWithTax,
        items: items.map((item) => ({
          goodsId: item.goodsId,
          goodsName: item.goodsName,
          price: Number(item.price || 0),
          quantity: Number(item.quantity || 1),
          rs485LaneByte: item.rs485LaneByte,
          rs485LaneBytes: item.rs485LaneBytes
        }))
      });

      let dispenseResults = result.dispenseResults || [];
      let partial = Boolean(result.partial);

      if (result.alreadyFulfilled) {
        // Idempotent retry — payment already fulfilled.
      } else if (result.clientDispense && isRs485) {
        dispenseResults = await dispenseItemsLocally({
          items,
          kioskAuth,
          orderPrefix: `PAID-${Date.now()}`
        });
        partial = dispenseResults.some((r) => !r.ok) && dispenseResults.some((r) => r.ok);
        if (!dispenseResults.some((r) => r.ok)) {
          throw new Error(
            dispenseResults[0]?.msg || 'Could not dispense any items — contact staff for help.'
          );
        }
      }

      toast.dismiss('vending-dispense');
      setDispensePhase('done');
      if (partial) {
        notifyError('Some items could not dispense — contact staff if needed.');
      } else if (!quietMode) {
        toast.success(totalItemCount > 1 ? 'Enjoy your purchases!' : 'Enjoy your purchase!');
      }
      onComplete?.({ ...result, dispenseResults, partial });
    } catch (err) {
      toast.dismiss('vending-dispense');
      setDispensePhase('failed');
      notifyError(err.message || 'Dispense failed — contact staff for help.');
      console.error('[VendingCheckout]', err);
    }
  };

  return (
    <div className="vending-checkout-overlay">
      <div className="vending-checkout-panel">
        <button type="button" className="vending-checkout-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="vending-checkout-summary">
          <h2>Checkout</h2>
          {!isOnline && !isRs485 ? (
            <p className="vending-checkout-warn">
              Machine may be offline — payment will still process; if nothing vends, ask staff for help.
            </p>
          ) : null}
          {checkoutError ? <p className="vending-checkout-error">{checkoutError}</p> : null}
          {dispensePhase === 'dispensing' ? (
            <p className="vending-checkout-warn">
              Payment confirmed — dispensing {totalItemCount > 1 ? `${totalItemCount} items` : 'your item'}…
            </p>
          ) : null}
          <ul className="vending-checkout-items">
            {items.map((item) => (
              <li key={item.goodsId}>
                <span>
                  {item.quantity}× {item.goodsName}
                </span>
                <span>{formatMoney(Number(item.price) * item.quantity, currency)}</span>
              </li>
            ))}
          </ul>
          <p className="vending-checkout-subtotal">Subtotal: {formatMoney(subtotal, currency)}</p>
          {totalTax > 0 ? (
            <div className="vending-checkout-tax">
              <TaxBreakdown
                taxCalculation={{ aggregatedTaxes, aggregatedRebates }}
                taxCalc={taxCalc}
              />
              <p className="vending-checkout-tax-total">Tax: {formatMoney(totalTax, currency)}</p>
            </div>
          ) : null}
          <p className="vending-checkout-total">Total: {formatMoney(totalWithTax, currency)}</p>
        </div>

        <SelfServeHelcimQrPayment
          businessId={businessId}
          currency={currency}
          checkoutAmount={totalWithTax}
          checkoutLabel={checkoutLabel}
          completeDelayMs={2500}
          quietMode={quietMode}
          onCancelCheckout={onClose}
          onPaymentComplete={handlePaymentComplete}
        />
      </div>
    </div>
  );
}
