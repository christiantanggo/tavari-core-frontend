// Staff PIN checkout — no payment; dispense and log who took what

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import vendingService from '../../services/VendingMachine/VendingMachineService';
import { localRs485VendLanes } from '../../services/VendingMachine/localRs485Bridge';
import { useVendingStaffPin } from '../../hooks/useVendingStaffPin';
import VendingKioskPinPad from './VendingKioskPinPad';
import './VendingStaffCheckout.css';

function buildKioskAuth({ kioskShortCode, businessId, deviceId, kioskSecret }) {
  if (kioskShortCode) return { kioskShortCode };
  return { businessId, externalDeviceId: deviceId, kioskSecret };
}

async function dispenseItemsLocally({ items, orderPrefix }) {
  const dispenseResults = [];

  for (const item of items) {
    const goodsId = String(item.goodsId || '').trim();
    const qty = Math.max(1, Math.min(20, Number(item.quantity) || 1));
    if (!goodsId) continue;

    for (let q = 0; q < qty; q += 1) {
      const orderNo = `${orderPrefix}-${goodsId}-${q}`;
      try {
        await localRs485VendLanes({ product: item, lanes: item.rs485LaneBytes });
        dispenseResults.push({
          goodsId,
          goodsName: item.goodsName,
          price: Number(item.price || 0),
          orderNo,
          ok: true
        });
      } catch (err) {
        dispenseResults.push({
          goodsId,
          goodsName: item.goodsName,
          price: Number(item.price || 0),
          orderNo,
          ok: false,
          msg: err.message || 'RS485 dispense failed'
        });
      }
    }
  }

  return dispenseResults;
}

export default function VendingStaffCheckout({
  businessId,
  kioskShortCode,
  deviceId,
  kioskSecret,
  items,
  dispenseMode,
  rs485Override = false,
  quietMode = false,
  onClose,
  onComplete
}) {
  const { verifyPin, prefetchPins } = useVendingStaffPin(businessId);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [verifiedStaff, setVerifiedStaff] = useState(null);
  const [checkoutError, setCheckoutError] = useState('');
  const [dispensePhase, setDispensePhase] = useState('pin');
  const [pinBusy, setPinBusy] = useState(false);

  useEffect(() => {
    prefetchPins?.().catch(() => {});
  }, [prefetchPins]);

  const isRs485 = dispenseMode === 'rs485' || rs485Override;
  const kioskAuth = buildKioskAuth({ kioskShortCode, businessId, deviceId, kioskSecret });
  const locked = failedAttempts >= 3;

  const totalItemCount = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);

  const apiItems = useMemo(
    () =>
      items.map((item) => ({
        goodsId: item.goodsId,
        goodsName: item.goodsName,
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 1),
        posInventoryId: item.posInventoryId ?? null,
        rs485LaneByte: item.rs485LaneByte,
        rs485LaneBytes: item.rs485LaneBytes
      })),
    [items]
  );

  const notifyError = (message) => {
    setCheckoutError(message);
    if (!quietMode) toast.error(message, { duration: 8000 });
  };

  const verifyEnteredPin = async (pin) => {
    if (pin.length !== 4 || pinBusy || locked) return;
    setPinBusy(true);
    setPinError('');
    try {
      const result = await verifyPin(pin);
      if (!result.ok) {
        const nextAttempts = failedAttempts + 1;
        setFailedAttempts(nextAttempts);
        if (result.reason === 'no_staff_pins') {
          setPinError('No staff PINs configured — add PINs in HR or user settings.');
        } else {
          setPinError('Incorrect PIN — try again.');
        }
        setPinInput('');
        return;
      }

      setVerifiedStaff(result.employee);
      setPinInput('');
      setFailedAttempts(0);
      await runStaffDispense(result.employee);
    } finally {
      setPinBusy(false);
    }
  };

  const handleDigit = (digit) => {
    if (locked || pinBusy || dispensePhase !== 'pin') return;
    setPinError('');
    setPinInput((prev) => {
      if (prev.length >= 4) return prev;
      const next = `${prev}${digit}`;
      if (next.length === 4) {
        setTimeout(() => verifyEnteredPin(next), 0);
      }
      return next;
    });
  };

  const runStaffDispense = async (staff) => {
    setCheckoutError('');
    setDispensePhase('dispensing');

    if (!quietMode) {
      toast.loading(
        totalItemCount > 1 ? `Dispensing ${totalItemCount} items…` : 'Dispensing your item…',
        { id: 'vending-staff-dispense' }
      );
    }

    try {
      const batchOrderNo = `STAFF-${Date.now()}`;
      const prepare = await vendingService.fulfillStaffOrder({
        ...kioskAuth,
        staffUserId: staff.id,
        staffName: staff.name,
        items: apiItems,
        batchOrderNo
      });

      let dispenseResults = prepare.dispenseResults || [];
      let partial = Boolean(prepare.partial);

      if (prepare.clientDispense && isRs485) {
        dispenseResults = await dispenseItemsLocally({
          items,
          orderPrefix: batchOrderNo
        });
        partial = dispenseResults.some((r) => !r.ok) && dispenseResults.some((r) => r.ok);
        if (!dispenseResults.some((r) => r.ok)) {
          throw new Error(
            dispenseResults[0]?.msg || 'Could not dispense any items — try again or contact a manager.'
          );
        }

        const logged = await vendingService.fulfillStaffOrder({
          ...kioskAuth,
          staffUserId: staff.id,
          staffName: staff.name,
          items: apiItems,
          batchOrderNo,
          dispenseResults
        });
        partial = partial || Boolean(logged.partial);
      }

      toast.dismiss('vending-staff-dispense');
      setDispensePhase('done');
      if (partial) {
        notifyError('Some items could not dispense — a manager can review the staff report.');
      } else if (!quietMode) {
        toast.success(totalItemCount > 1 ? 'Items dispensed — enjoy!' : 'Item dispensed — enjoy!');
      }
      onComplete?.({ staff, dispenseResults, partial, batchOrderNo });
    } catch (err) {
      toast.dismiss('vending-staff-dispense');
      setDispensePhase('failed');
      notifyError(err.message || 'Dispense failed — contact a manager.');
      console.error('[VendingStaffCheckout]', err);
    }
  };

  if (dispensePhase === 'pin') {
    return (
      <VendingKioskPinPad
        title="Enter staff PIN"
        subtitle="Tap your 4-digit PIN to dispense. No payment — usage is logged."
        pinInput={pinInput}
        pinError={pinError}
        failedAttempts={failedAttempts}
        locked={locked}
        busy={pinBusy}
        onDigit={handleDigit}
        onClear={() => {
          setPinInput('');
          setPinError('');
        }}
        onBackspace={() => {
          setPinError('');
          setPinInput((prev) => prev.slice(0, -1));
        }}
        onCancel={onClose}
        cancelLabel="Cancel"
      >
        <div className="vending-staff-pin-items" aria-label="Items to dispense">
          {items.map((item) => (
            <span key={item.goodsId}>
              {item.quantity}× {item.goodsName}
            </span>
          ))}
        </div>
      </VendingKioskPinPad>
    );
  }

  return (
    <div className="vending-staff-checkout-overlay">
      <div className="vending-staff-checkout-panel">
        <button type="button" className="vending-staff-checkout-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="vending-staff-checkout-summary">
          <h2>Staff checkout</h2>
          {verifiedStaff ? (
            <p className="vending-staff-checkout-staff">
              Staff: <strong>{verifiedStaff.name}</strong>
            </p>
          ) : null}
          {checkoutError ? <p className="vending-staff-checkout-error">{checkoutError}</p> : null}
          {dispensePhase === 'dispensing' ? (
            <p className="vending-staff-checkout-warn">
              Dispensing {totalItemCount > 1 ? `${totalItemCount} items` : 'your item'}…
            </p>
          ) : null}
          <ul className="vending-staff-checkout-items">
            {items.map((item) => (
              <li key={item.goodsId}>
                <span>
                  {item.quantity}× {item.goodsName}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
