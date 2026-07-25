// src/components/VendingMachine/VendingMachineKiosk.jsx
// Main kiosk interface for vending machine

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useVendingMachine } from '../../hooks/useVendingMachine';
import vendingMachineService from '../../services/VendingMachine/VendingMachineService';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { calculateVendingCartTax } from '../../utils/vendingTaxHelpers';
import ProductGrid from './ProductGrid';
import Cart from './Cart';
import VendingCheckout from './VendingCheckout';
import VendingStaffCheckout from './VendingStaffCheckout';
import VendingStaffPanel from './VendingStaffPanel';
import './VendingMachineKiosk.css';

const MAX_DEBUG_LOG = 40;

let debugLogSeq = 0;

const VendingMachineKiosk = ({
  kioskShortCode,
  deviceId,
  businessId,
  kioskSecret,
  testVendMode,
  rs485Override,
  debugMode
}) => {
  const hasShortCode = Boolean(kioskShortCode);
  const hasLegacyAuth = Boolean(businessId && kioskSecret && deviceId);
  const quietMode = !debugMode;

  const [debugOpen, setDebugOpen] = useState(Boolean(debugMode));
  const [debugLogs, setDebugLogs] = useState([]);
  const [diagRunning, setDiagRunning] = useState(false);

  const appendDebugLog = useCallback(({ level, message, detail }) => {
    debugLogSeq += 1;
    const detailStr =
      detail == null
        ? null
        : typeof detail === 'string'
          ? detail
          : JSON.stringify(detail, null, 2);
    setDebugLogs((prev) =>
      [
        {
          id: debugLogSeq,
          time: new Date().toLocaleTimeString(),
          level: level || 'info',
          message,
          detail: detailStr
        },
        ...prev
      ].slice(0, MAX_DEBUG_LOG)
    );
  }, []);

  const {
    isOnline,
    lastVendorReport,
    portalMayShowOnline,
    machineStatus,
    inventory,
    kioskBusinessId,
    testVendEnabled,
    kioskAccessMode,
    dispenseMode,
    initialLoading,
    refreshing,
    orderPending,
    error,
    refreshAll,
    checkStatus,
    createOrder,
    fulfillTestOrder
  } = useVendingMachine({
    kioskShortCode,
    deviceId,
    businessId,
    kioskSecret,
    quietMode,
    testVendBypass: Boolean(testVendMode),
    rs485Override: Boolean(rs485Override),
    onDebug: appendDebugLog
  });

  const showTestVend = Boolean(testVendMode || testVendEnabled);
  const staffPinMode = kioskAccessMode === 'staff_pin' && !showTestVend;
  const firstProduct = inventory[0];

  const debugSnapshot = useMemo(
    () => ({
      kioskShortCode,
      isOnline,
      pingOnline: machineStatus?.pingOnline,
      detailOnline: machineStatus?.detailOnline,
      portalMayShowOnline,
      lastVendorReport,
      showTestVend,
      inventoryCount: inventory.length,
      firstGoodsId: firstProduct?.goodsId || null,
      refreshing,
      orderPending,
      lastError: error,
      statusLabel: isOnline ? 'Online' : inventory.length > 0 ? 'Ready' : 'Offline'
    }),
    [
      kioskShortCode,
      isOnline,
      machineStatus,
      portalMayShowOnline,
      lastVendorReport,
      showTestVend,
      inventory.length,
      firstProduct,
      refreshing,
      orderPending,
      error
    ]
  );

  const taxCalc = useTaxCalculations(businessId || kioskBusinessId);

  const [cart, setCart] = useState([]);
  const [checkoutItems, setCheckoutItems] = useState(null);
  const [testVending, setTestVending] = useState(false);
  const [testProgress, setTestProgress] = useState(null);

  const didLogLoadRef = useRef(false);

  useEffect(() => {
    if (didLogLoadRef.current) return;
    didLogLoadRef.current = true;
    appendDebugLog({
      level: 'info',
      message: 'Kiosk loaded',
      detail: { kioskShortCode, testVendMode, debugMode }
    });
  }, [appendDebugLog, kioskShortCode, testVendMode, debugMode]);

  const cartPricing = useMemo(
    () => calculateVendingCartTax(cart, taxCalc),
    [cart, taxCalc, taxCalc.loading]
  );

  const checkoutPricing = useMemo(
    () => (checkoutItems ? calculateVendingCartTax(checkoutItems, taxCalc) : null),
    [checkoutItems, taxCalc, taxCalc.loading]
  );

  const handleRefresh = useCallback(async () => {
    toast.dismiss();
    try {
      await refreshAll({ silent: true });
    } catch {
      appendDebugLog({ level: 'warn', message: 'Background refresh failed' });
    }
  }, [refreshAll, appendDebugLog]);

  const handleTestVend = useCallback(
    async (product) => {
      if (!product?.goodsId || testVending) return;
      setTestVending(true);
      appendDebugLog({
        level: 'info',
        message: `Test vend: ${product.goodsName || product.goodsId}`,
        detail: { goodsId: product.goodsId, isOnline }
      });
      try {
        await createOrder({
          goodsId: product.goodsId,
          orderNo: `TEST-${Date.now()}`,
          product
        });
        if (!quietMode) toast.success('Test vend sent');
        refreshAll({ silent: true });
      } catch (err) {
        const msg = err.message || 'Test vend failed';
        if (!quietMode) toast.error(msg);
        appendDebugLog({ level: 'error', message: msg });
      } finally {
        setTestVending(false);
      }
    },
    [testVending, appendDebugLog, isOnline, createOrder, quietMode, refreshAll]
  );

  const handleTestCheckout = useCallback(async () => {
    if (!cart.length || testVending) return;
    const unitCount = cart.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
    setTestVending(true);
    setTestProgress(null);
    appendDebugLog({
      level: 'info',
      message: 'Test order checkout',
      detail: { lines: cart.length, units: unitCount }
    });
    try {
      await fulfillTestOrder(cart, {
        onProgress: (progress) => setTestProgress(progress)
      });
      setCart([]);
    } catch (err) {
      appendDebugLog({
        level: 'error',
        message: 'Test order checkout failed',
        detail: { message: err.message }
      });
    } finally {
      setTestVending(false);
      setTestProgress(null);
    }
  }, [cart, testVending, fulfillTestOrder, appendDebugLog]);

  const handleRunDiagnostics = useCallback(async () => {
    if (!kioskShortCode) {
      appendDebugLog({ level: 'warn', message: 'No kiosk short code — diagnostics limited' });
      await checkStatus();
      return;
    }
    setDiagRunning(true);
    appendDebugLog({ level: 'info', message: 'Running diagnostics…' });
    try {
      await checkStatus();
      const status = await vendingMachineService.checkKioskMachineOnline({ kioskShortCode });
      appendDebugLog({
        level: status.online ? 'ok' : 'warn',
        message: 'checkMachineOnline',
        detail: status
      });
      if (firstProduct?.goodsId) {
        const can = await vendingMachineService.checkKioskCanOrder(
          { kioskShortCode },
          firstProduct.goodsId
        );
        appendDebugLog({
          level: can.ok ? 'ok' : 'error',
          message: `checkCanOrder goods_id ${firstProduct.goodsId}`,
          detail: can
        });
      }
    } catch (err) {
      appendDebugLog({ level: 'error', message: 'Diagnostics failed', detail: { message: err.message } });
    } finally {
      setDiagRunning(false);
    }
  }, [kioskShortCode, checkStatus, firstProduct, appendDebugLog]);

  const addToCart = (product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.goodsId === product.goodsId);
      if (existing) {
        return prev.map((item) =>
          item.goodsId === product.goodsId ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (goodsId) => {
    setCart((prev) => prev.filter((item) => item.goodsId !== goodsId));
  };

  const updateCartQuantity = (goodsId, quantity) => {
    if (quantity <= 0) {
      removeFromCart(goodsId);
      return;
    }
    setCart((prev) =>
      prev.map((item) => (item.goodsId === goodsId ? { ...item, quantity } : item))
    );
  };

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  const startCheckout = (items) => {
    if (!items?.length) return;
    setCheckoutItems(items);
  };

  const handleCheckoutComplete = () => {
    setCheckoutItems(null);
    setCart([]);
    refreshAll({ silent: true });
  };

  if (!hasShortCode && !hasLegacyAuth) {
    return (
      <div className="vending-kiosk-error">
        <h2>Kiosk link required</h2>
        <p>
          Open the short URL from <strong>Tavari Vending → Devices</strong> (for example{' '}
          <code>https://www.tavarios.ca/v/ABC123</code>).
        </p>
      </div>
    );
  }

  return (
    <div className="vending-kiosk">
      {refreshing && inventory.length > 0 ? (
        <div className="vending-kiosk-sync-dot" aria-hidden="true" title="Syncing" />
      ) : null}

      <VendingStaffPanel
        businessId={businessId || kioskBusinessId}
        kioskShortCode={kioskShortCode}
        isOnline={isOnline}
        catalogReady={inventory.length > 0}
        initialLoading={initialLoading}
        lastVendorReport={lastVendorReport}
        portalMayShowOnline={portalMayShowOnline}
        refreshing={refreshing}
        orderPending={orderPending}
        showTestVend={showTestVend}
        rs485Override={Boolean(rs485Override)}
        dispenseMode={dispenseMode}
        inventory={inventory}
        onRefresh={handleRefresh}
        onTestVend={handleTestVend}
        onTestCheckout={handleTestCheckout}
        cartItemCount={cart.reduce((sum, item) => sum + Number(item.quantity || 1), 0)}
        cartLineCount={cart.length}
        debugOpen={debugOpen}
        onDebugOpenChange={setDebugOpen}
        debugSnapshot={debugSnapshot}
        debugLogs={debugLogs}
        onRunDiagnostics={handleRunDiagnostics}
        onClearLog={() => setDebugLogs([])}
        onReload={() => window.location.reload()}
        diagnosticsRunning={diagRunning}
        testVending={testVending}
        onDebugLog={appendDebugLog}
      />

      <div className="vending-kiosk-topbar">
        <div className="vending-kiosk-topbar-banner">
          {showTestVend ? (
            <div className="vending-kiosk-test-strip" aria-live="polite">
              Test mode — cart checkout vends all items with no payment
            </div>
          ) : null}
          {staffPinMode ? (
            <div className="vending-kiosk-test-strip vending-kiosk-staff-strip" aria-live="polite">
              Staff mode — enter your PIN at checkout (no payment). Usage is logged.
            </div>
          ) : null}
          {!showTestVend && !staffPinMode ? (
            <div className="vending-kiosk-topbar-spacer" aria-hidden="true" />
          ) : null}
        </div>
        <div className="vending-kiosk-topbar-lock-slot" aria-hidden="true" />
      </div>

      <div className="vending-kiosk-content">
        <div className="vending-kiosk-main">
          <ProductGrid
            products={inventory}
            onSelect={addToCart}
            initialLoading={initialLoading}
            loadError={!initialLoading && inventory.length === 0 ? error : null}
            onRetry={handleRefresh}
            taxCalc={taxCalc}
          />
        </div>

        <div className="vending-kiosk-cart-dock">
          <Cart
            items={cart}
            onRemove={removeFromCart}
            onUpdateQuantity={updateCartQuantity}
            onClearCart={clearCart}
            subtotal={cartPricing.subtotal}
            taxCalculation={cartPricing}
            taxCalc={taxCalc}
            totalWithTax={cartPricing.totalWithTax}
            onCheckout={
              showTestVend ? handleTestCheckout : () => startCheckout(cart)
            }
            disabled={cart.length === 0 || orderPending || testVending}
            testMode={showTestVend}
            staffPinMode={staffPinMode}
            testProgress={testProgress}
            dockLayout
            pauseClearTimer={Boolean(checkoutItems) || testVending || orderPending}
          />
        </div>
      </div>

      {checkoutItems ? (
        staffPinMode ? (
          <VendingStaffCheckout
            businessId={businessId || kioskBusinessId}
            kioskShortCode={kioskShortCode}
            deviceId={deviceId}
            kioskSecret={kioskSecret}
            items={checkoutItems}
            dispenseMode={dispenseMode}
            rs485Override={Boolean(rs485Override)}
            quietMode={quietMode}
            onClose={() => setCheckoutItems(null)}
            onComplete={handleCheckoutComplete}
          />
        ) : (
          <VendingCheckout
            kioskShortCode={kioskShortCode}
            businessId={businessId || kioskBusinessId}
            deviceId={deviceId}
            kioskSecret={kioskSecret}
            items={checkoutItems}
            cartPricing={checkoutPricing}
            taxCalc={taxCalc}
            isOnline={isOnline}
            dispenseMode={dispenseMode}
            rs485Override={Boolean(rs485Override)}
            quietMode={quietMode}
            onClose={() => setCheckoutItems(null)}
            onComplete={handleCheckoutComplete}
          />
        )
      ) : null}
    </div>
  );
};

export default VendingMachineKiosk;
