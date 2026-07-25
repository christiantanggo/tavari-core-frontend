// src/hooks/useVendingMachine.js
// React hook for vending machine operations

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import vendingService from '../services/VendingMachine/VendingMachineService';
import { localRs485VendLanes, isRs485BridgeAvailable } from '../services/VendingMachine/localRs485Bridge';
import { pollAndExecuteRemoteDispense } from '../services/VendingMachine/remoteDispenseExecutor';
import { useRemoteDispenseListener } from './useRemoteDispenseListener';
import { normalizeKioskShortCode } from '../utils/vendingKioskSecret';
import toast from 'react-hot-toast';

/** Vendor device_detail rows use snake_case; kiosk UI expects camelCase on product cards */
function normalizeVendorInventoryRow(raw, idx) {
  if (!raw || typeof raw !== 'object') return raw;
  const goodsId = String(
    raw.goodsId ?? raw.goods_id ?? raw.goodsID ?? raw.goods_id_str ?? ''
  ).trim();
  const goodsName = raw.goodsName || raw.goods_name || raw.name || 'Product';
  const picUrl = raw.picUrl || raw.pic_url || '';
  const price = Number(raw.price ?? raw.sale_price ?? 0);
  const maxNum = Number(raw.max_num ?? raw.maxNum ?? 10) || 10;
  let num = raw.num != null ? Number(raw.num) : raw.stock != null ? Number(raw.stock) : NaN;
  if (Number.isNaN(num)) num = 0;
  return {
    ...raw,
    goodsId,
    goodsName,
    picUrl,
    price,
    num,
    max_num: maxNum,
    posInventoryId: raw.posInventoryId ?? raw.pos_inventory_id ?? null,
    categoryId: raw.categoryId ?? raw.category_id ?? null,
    itemTaxOverrides: raw.itemTaxOverrides ?? raw.item_tax_overrides ?? [],
    _rowIndex: idx
  };
}

function normalizeKioskProduct(raw, idx) {
  return normalizeVendorInventoryRow(
    {
      goodsId: raw.goodsId,
      goodsName: raw.goodsName,
      picUrl: raw.picUrl,
      price: raw.price,
      num: raw.num,
      max_num: raw.maxNum ?? raw.max_num,
      posInventoryId: raw.posInventoryId,
      categoryId: raw.categoryId,
      itemTaxOverrides: raw.itemTaxOverrides,
      rs485LaneByte: raw.rs485LaneByte,
      rs485LaneBytes: raw.rs485LaneBytes,
      slots: raw.slots
    },
    idx
  );
}

export const useVendingMachine = ({
  deviceId,
  businessId,
  kioskSecret,
  kioskShortCode,
  quietMode = false,
  testVendBypass = false,
  rs485Override = false,
  onDebug
} = {}) => {
  const shortCode = normalizeKioskShortCode(kioskShortCode);
  const isKioskMode = Boolean(shortCode || (businessId && kioskSecret && deviceId));

  const [machineStatus, setMachineStatus] = useState(null);
  const [isOnline, setIsOnline] = useState(false);
  const [lastVendorReport, setLastVendorReport] = useState(null);
  const [portalMayShowOnline, setPortalMayShowOnline] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [kioskBusinessId, setKioskBusinessId] = useState(null);
  const [testVendEnabled, setTestVendEnabled] = useState(false);
  const [kioskAccessMode, setKioskAccessMode] = useState('payment');
  const [dispenseMode, setDispenseMode] = useState(rs485Override ? 'rs485' : 'cloud');
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [orderPending, setOrderPending] = useState(false);
  const [error, setError] = useState(null);

  const inventoryRef = useRef([]);
  const onDebugRef = useRef(onDebug);
  useEffect(() => {
    onDebugRef.current = onDebug;
  }, [onDebug]);

  const debugLog = useCallback((level, message, detail) => {
    onDebugRef.current?.({ level, message, detail });
  }, []);

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  const kioskAuth = useMemo(() => {
    if (shortCode) return { kioskShortCode: shortCode };
    if (businessId && kioskSecret && deviceId) {
      return {
        businessId,
        externalDeviceId: deviceId,
        kioskSecret
      };
    }
    return null;
  }, [shortCode, businessId, deviceId, kioskSecret]);

  const checkStatus = useCallback(async () => {
    if (!kioskAuth) return;

    try {
      if (dispenseMode === 'rs485' || rs485Override) {
        const bridgeReady = isRs485BridgeAvailable();
        setMachineStatus({ online: bridgeReady, dispenseMode: 'rs485' });
        setIsOnline(bridgeReady);
        setPortalMayShowOnline(false);
        debugLog(bridgeReady ? 'ok' : 'warn', bridgeReady ? 'RS485 bridge ready' : 'RS485 bridge not found — install Tavari Vending app on tablet', {});
        if (bridgeReady) {
          pollAndExecuteRemoteDispense(kioskAuth, debugLog).catch(() => {});
        }
        return;
      }
      if (kioskAuth.kioskShortCode) {
        const status = await vendingService.checkKioskMachineOnline(kioskAuth);
        setMachineStatus({
          online: status.online,
          lastReportAt: status.lastReportAt,
          portalMayShowOnline: status.portalMayShowOnline,
          pingOnline: status.pingOnline,
          detailOnline: status.detailOnline,
          kioskShortCode: kioskAuth.kioskShortCode
        });
        setIsOnline(status.online);
        setLastVendorReport(status.lastReportAt);
        setPortalMayShowOnline(Boolean(status.portalMayShowOnline));
        debugLog(status.online ? 'ok' : 'warn', `Status check: ${status.online ? 'dispense API online' : 'dispense API offline'}`, {
          pingOnline: status.pingOnline,
          detailOnline: status.detailOnline,
          portalMayShowOnline: status.portalMayShowOnline,
          lastReportAt: status.lastReportAt
        });
      } else {
        const status = await vendingService.checkMachineStatus(deviceId);
        setMachineStatus(status);
        setIsOnline(status.online || false);
        debugLog(status.online ? 'ok' : 'warn', `Status check: ${status.online ? 'online' : 'offline'}`, status);
      }
    } catch (err) {
      setError(err.message);
      debugLog('error', 'Status check failed', { message: err.message });
    }
  }, [deviceId, kioskAuth, debugLog, dispenseMode, rs485Override]);

  const loadInventory = useCallback(async ({ silent } = {}) => {
    if (!kioskAuth) return;

    const hasCatalog = inventoryRef.current.length > 0;
    const background = silent ?? hasCatalog;

    if (background) setRefreshing(true);
    else setInitialLoading(true);

    if (!background) setError(null);

    try {
      if (kioskAuth.kioskShortCode || kioskAuth.kioskSecret) {
        const data = await vendingService.getKioskProducts(kioskAuth);
        const products = data.products || [];
        if (data.businessId) setKioskBusinessId(data.businessId);
        setTestVendEnabled(Boolean(data.testVendEnabled));
        setKioskAccessMode(data.kioskAccessMode === 'staff_pin' ? 'staff_pin' : 'payment');
        const mode =
          rs485Override || data.dispenseMode === 'rs485' ? 'rs485' : 'cloud';
        setDispenseMode(mode);
        setInventory((prev) => {
          const next = products.map(normalizeKioskProduct);
          if (
            prev.length === next.length &&
            prev.every((p, i) => p.goodsId === next[i]?.goodsId && p.num === next[i]?.num && p.price === next[i]?.price)
          ) {
            return prev;
          }
          return next;
        });
        debugLog('info', `Products loaded: ${products.length}`, {
          testVendEnabled: Boolean(data.testVendEnabled),
          kioskAccessMode: data.kioskAccessMode === 'staff_pin' ? 'staff_pin' : 'payment',
          dispenseMode: mode,
          goodsIds: products.map((p) => p.goodsId).filter(Boolean)
        });
        if (mode === 'rs485' && isRs485BridgeAvailable()) {
          pollAndExecuteRemoteDispense(kioskAuth, debugLog).catch(() => {});
        }
      } else {
        const data = await vendingService.getInventory(deviceId);
        const raw = data.inventory || [];
        setInventory((prev) => {
          const next = raw.map(normalizeVendorInventoryRow);
          if (
            prev.length === next.length &&
            prev.every((p, i) => p.goodsId === next[i]?.goodsId && p.num === next[i]?.num)
          ) {
            return prev;
          }
          return next;
        });
      }
    } catch (err) {
      setError(err.message);
      debugLog('error', 'Products load failed', { message: err.message });
      if (!background && !quietMode) {
        toast.error(`Failed to load inventory: ${err.message}`);
      }
    } finally {
      if (background) setRefreshing(false);
      else setInitialLoading(false);
    }
  }, [deviceId, kioskAuth, quietMode, debugLog, rs485Override]);

  const refreshAll = useCallback(
    async ({ silent = true } = {}) => {
      await Promise.all([checkStatus(), loadInventory({ silent })]);
    },
    [checkStatus, loadInventory]
  );

  const createOrder = useCallback(
    async ({ goodsId, orderNo, notifyUrl, product }) => {
      if (!kioskAuth) throw new Error('Kiosk is not configured');

      setOrderPending(true);
      setError(null);
      const resolvedOrderNo = orderNo || `ORDER-${Date.now()}`;
      debugLog('info', 'createOrder started', { goodsId, orderNo: resolvedOrderNo, dispenseMode });

      try {
        if (dispenseMode === 'rs485') {
          const invProduct =
            product || inventoryRef.current.find((p) => p.goodsId === goodsId);
          debugLog('info', 'RS485 vend', {
            lanes: invProduct?.rs485LaneBytes,
            goodsId
          });
          const vend = await localRs485VendLanes({ product: invProduct });
          await vendingService.recordKioskLocalDispense({
            ...kioskAuth,
            goodsId,
            orderNo: resolvedOrderNo
          });
          debugLog('ok', 'RS485 vend success', vend);
          if (!quietMode) toast.success('Product dispensed');
          return { err: 0, msg: vend.message, data: vend };
        }

        const result = kioskAuth.kioskShortCode || kioskAuth.kioskSecret
          ? await vendingService.createKioskOrder({
              ...kioskAuth,
              goodsId,
              orderNo: resolvedOrderNo,
              notifyUrl,
              testVendBypass
            })
          : await vendingService.createOrder({
              deviceId,
              goodsId,
              orderNo: resolvedOrderNo,
              notifyUrl
            });

        debugLog('ok', 'createOrder success', { msg: result?.msg, err: result?.err });
        if (!quietMode) toast.success('Order created successfully');
        return result;
      } catch (err) {
        setError(err.message);
        debugLog('error', 'createOrder failed', { message: err.message });
        if (!quietMode) toast.error(`Failed to create order: ${err.message}`);
        throw err;
      } finally {
        setOrderPending(false);
      }
    },
    [deviceId, kioskAuth, quietMode, testVendBypass, debugLog, dispenseMode]
  );

  const fulfillTestOrder = useCallback(
    async (items, { onProgress } = {}) => {
      if (!kioskAuth) throw new Error('Kiosk is not configured');
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Add items to the cart first');
      }

      const expanded = [];
      for (const item of items) {
        const goodsId = String(item.goodsId || '').trim();
        const qty = Math.max(1, Math.min(20, Number(item.quantity) || 1));
        if (!goodsId) continue;
        for (let q = 0; q < qty; q += 1) {
          expanded.push({ ...item, goodsId, unitIndex: q });
        }
      }

      if (!expanded.length) throw new Error('Cart items are missing product ids');

      setOrderPending(true);
      setError(null);
      const orderPrefix = `TEST-${Date.now()}`;
      const dispenseResults = [];

      debugLog('info', 'Test order started', {
        orderPrefix,
        lineCount: items.length,
        unitCount: expanded.length
      });

      try {
        for (let i = 0; i < expanded.length; i += 1) {
          const item = expanded[i];
          const orderNo = `${orderPrefix}-${item.goodsId}-${item.unitIndex}`;
          onProgress?.({
            current: i + 1,
            total: expanded.length,
            goodsName: item.goodsName || item.goodsId
          });

          try {
            if (dispenseMode === 'rs485') {
              const invProduct =
                item.rs485LaneByte != null || item.rs485LaneBytes?.length
                  ? item
                  : inventoryRef.current.find((p) => p.goodsId === item.goodsId) || item;
              debugLog('info', 'RS485 test vend', {
                lanes: invProduct?.rs485LaneBytes,
                goodsId: item.goodsId,
                orderNo
              });
              const vend = await localRs485VendLanes({ product: invProduct });
              await vendingService.recordKioskLocalDispense({
                ...kioskAuth,
                goodsId: item.goodsId,
                orderNo
              });
              dispenseResults.push({
                goodsId: item.goodsId,
                orderNo,
                ok: true,
                msg: vend?.message
              });
            } else {
              const result =
                kioskAuth.kioskShortCode || kioskAuth.kioskSecret
                  ? await vendingService.createKioskOrder({
                      ...kioskAuth,
                      goodsId: item.goodsId,
                      orderNo,
                      testVendBypass: true
                    })
                  : await vendingService.createOrder({
                      deviceId,
                      goodsId: item.goodsId,
                      orderNo
                    });
              dispenseResults.push({
                goodsId: item.goodsId,
                orderNo,
                ok: true,
                msg: result?.msg
              });
            }
          } catch (itemErr) {
            dispenseResults.push({
              goodsId: item.goodsId,
              orderNo,
              ok: false,
              msg: itemErr.message || 'Dispense failed'
            });
          }
        }

        const successCount = dispenseResults.filter((r) => r.ok).length;
        const partial = successCount > 0 && successCount < dispenseResults.length;
        if (successCount === 0) {
          throw new Error(
            dispenseResults[0]?.msg || 'Test order failed — nothing dispensed'
          );
        }

        debugLog(partial ? 'warn' : 'ok', 'Test order complete', {
          orderPrefix,
          successCount,
          total: dispenseResults.length,
          partial
        });

        if (!quietMode) {
          if (partial) {
            toast(`Test order partial — ${successCount}/${dispenseResults.length} dispensed`, {
              icon: '⚠️'
            });
          } else {
            toast.success(
              `Test order dispensed — ${successCount} item${successCount === 1 ? '' : 's'}`
            );
          }
        }

        return { orderNo: orderPrefix, dispenseResults, partial, successCount };
      } catch (err) {
        setError(err.message);
        debugLog('error', 'Test order failed', { message: err.message });
        if (!quietMode) toast.error(err.message);
        throw err;
      } finally {
        setOrderPending(false);
        loadInventory({ silent: true }).catch(() => {});
      }
    },
    [deviceId, kioskAuth, quietMode, debugLog, dispenseMode, loadInventory]
  );

  const createOrderWithPayment = useCallback(
    async ({ goodsItems, orderNo, totalFee, notifyUrl }) => {
      if (!kioskAuth) throw new Error('Kiosk is not configured');

      setOrderPending(true);
      setError(null);

      try {
        const result = kioskAuth.kioskShortCode || kioskAuth.kioskSecret
          ? await vendingService.createKioskOrderWithPayment({
              ...kioskAuth,
              goodsItems,
              orderNo: orderNo || `ORDER-${Date.now()}`,
              totalFee,
              notifyUrl
            })
          : await vendingService.createOrderWithPayment({
              deviceId,
              goodsItems,
              orderNo: orderNo || `ORDER-${Date.now()}`,
              totalFee,
              notifyUrl
            });

        if (!quietMode) toast.success('Order created with payment QR code');
        return result;
      } catch (err) {
        setError(err.message);
        if (!quietMode) toast.error(`Failed to create order: ${err.message}`);
        throw err;
      } finally {
        setOrderPending(false);
      }
    },
    [deviceId, kioskAuth]
  );

  const updateInventory = useCallback(
    async (inventoryData) => {
      setRefreshing(true);
      setError(null);

      try {
        await vendingService.saveInventory({ deviceId, ...inventoryData });
        toast.success('Inventory updated successfully');
        await loadInventory({ silent: true });
      } catch (err) {
        setError(err.message);
        toast.error(`Failed to update inventory: ${err.message}`);
        throw err;
      } finally {
        setRefreshing(false);
      }
    },
    [deviceId, loadInventory]
  );

  const fillInventory = useCallback(
    async (inventoryData) => {
      setRefreshing(true);
      setError(null);

      try {
        await vendingService.fillInventory({ deviceId, ...inventoryData });
        toast.success('Inventory filled successfully');
        await loadInventory({ silent: true });
      } catch (err) {
        setError(err.message);
        toast.error(`Failed to fill inventory: ${err.message}`);
        throw err;
      } finally {
        setRefreshing(false);
      }
    },
    [deviceId, loadInventory]
  );

  useEffect(() => {
    if (kioskAuth) {
      loadInventory().then(() => checkStatus());
      const statusInterval = setInterval(checkStatus, 15000);
      const inventoryInterval = setInterval(() => loadInventory({ silent: true }), 60000);
      return () => {
        clearInterval(statusInterval);
        clearInterval(inventoryInterval);
      };
    }
    setInitialLoading(false);
  }, [kioskAuth, checkStatus, loadInventory]);

  useRemoteDispenseListener({
    kioskAuth,
    dispenseMode,
    rs485Override,
    debugLog,
    enabled: Boolean(kioskAuth)
  });

  return {
    machineStatus,
    isOnline,
    lastVendorReport,
    portalMayShowOnline,
    inventory,
    kioskBusinessId,
    testVendEnabled,
    kioskAccessMode,
    dispenseMode,
    initialLoading,
    refreshing,
    orderPending,
    loading: initialLoading,
    error,
    checkStatus,
    loadInventory,
    refreshAll,
    createOrder,
    fulfillTestOrder,
    createOrderWithPayment,
    updateInventory,
    fillInventory
  };
};
