// src/services/VendingMachine/VendingMachineService.js
// Frontend service for vending machine operations
// Uses Supabase Edge Functions for secure API communication

import { supabase } from '../../supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/** Kiosk tablets often run older WebViews without AbortSignal.timeout. */
function fetchAbortSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

/** Trim device id from Tavari / vendor portal (paste mistakes are common). */
export function normalizeVendorDeviceId(deviceId) {
  return String(deviceId ?? '')
    .trim()
    .replace(/\s+/g, '');
}

/**
 * Human-readable hint after vendor Chinese/reason codes (Yishouyun-style API).
 */
export function augmentVendorErrorMessage(msg) {
  const m = String(msg || '').trim();
  if (!m) return 'Vendor API returned an error';
  if (/设备ID不存在/.test(m)) {
    return `${m} — The vendor cloud does not have this device ID under your merchant account. Use the exact cloud device ID from the manufacturer admin (often different from a serial or screen label). The machine must be activated/bound to your merchant before ping works.`;
  }
  if (/参数不全/.test(m)) {
    return `${m} — Request was missing required fields for the vendor API.`;
  }
  if (/设备已离线|设备不在线/.test(m)) {
    return `${m} — The vendor cloud reports this machine as offline. Check power and network (Wi‑Fi/SIM), restart the unit from the manufacturer portal, then use Ping in Tavari Vending until it shows online.`;
  }
  return m;
}

/**
 * Call Supabase Edge Function for vending machine operations
 */
/** Yishouyun-style envelope: { err: number, msg?: string, data?: object } */
export function assertVendorOk(result) {
  if (result == null) return;
  if (typeof result.err === 'number' && result.err !== 0) {
    throw new Error(augmentVendorErrorMessage(result.msg));
  }
}

/**
 * Normalize vendor `check_dev_online` / device payload — booleans may be 1/0 or alternate keys.
 */
export function parseVendorOnlineFlag(data) {
  if (!data || typeof data !== 'object') return false;
  const v =
    data.is_online ??
    data.isOnline ??
    data.online ??
    data.dev_online ??
    data.status;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes' || s === 'online') return true;
    if (s === '0' || s === 'false' || s === 'no' || s === 'offline' || s === '') return false;
  }
  return Boolean(v);
}

/** Human-readable vendor last_report_at (unix seconds). */
export function formatVendorLastReport(lastReportAt) {
  if (lastReportAt == null || lastReportAt === '') return null;
  const sec = Number(lastReportAt);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const ms = sec < 1e12 ? sec * 1000 : sec;
  const diffMs = Date.now() - ms;
  if (diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} hr ago`;
  return new Date(ms).toLocaleString();
}

/** JSON string, keyed object map, or plain array → row array */
export function parseMaybeInventoryRows(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t.startsWith('[') && !t.startsWith('{')) return null;
    try {
      const p = JSON.parse(t);
      if (Array.isArray(p)) return p;
      if (p && typeof p === 'object') return Object.values(p);
    } catch {
      return null;
    }
    return null;
  }
  if (typeof value === 'object') {
    const vals = Object.values(value);
    if (vals.length && vals.every((x) => x != null && typeof x === 'object' && !Array.isArray(x))) {
      return vals;
    }
  }
  return null;
}

/** Loose match for Yishouyun-style slot / lane rows */
export function looksLikeInventorySlotRow(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  if (Object.keys(o).some((k) => /goodsid/i.test(k))) return true;
  return (
    'goods_id' in o ||
    'goodsId' in o ||
    'goods_sn' in o ||
    'goodsSn' in o ||
    'goods_name' in o ||
    'goodsName' in o ||
    'row' in o ||
    'col' in o ||
    'layer' in o ||
    'hang' in o ||
    'num' in o ||
    'max_num' in o ||
    'maxNum' in o ||
    'sev_no' in o ||
    'sevNo' in o
  );
}

function findInventoryArrayByDeepScan(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 10) return [];
  if (Array.isArray(obj)) {
    if (obj.length && looksLikeInventorySlotRow(obj[0])) return obj;
    return [];
  }
  const skipKeys = new Set(['sign', 'mch_no', 'msg', 'err']);
  for (const key of Object.keys(obj)) {
    if (skipKeys.has(key)) continue;
    const v = obj[key];
    const parsed = parseMaybeInventoryRows(v);
    if (parsed && parsed.length && looksLikeInventorySlotRow(parsed[0])) return parsed;
    if (parsed && parsed.length && parsed.some(looksLikeInventorySlotRow)) {
      return parsed.filter(looksLikeInventorySlotRow);
    }
    if (v && typeof v === 'object') {
      const inner = findInventoryArrayByDeepScan(v, depth + 1);
      if (inner.length > 0) return inner;
    }
  }
  return [];
}

/**
 * device_detail payloads vary: inventory may live under inventory, goods_list, nested cabinets, etc.
 */
export function extractInventoryArrayFromDeviceDetail(data, depth = 0) {
  if (!data || typeof data !== 'object') return [];

  const pickFirstNonEmpty = (keys) => {
    for (const k of keys) {
      const v = data[k];
      if (Array.isArray(v) && v.length > 0) return v;
      const parsed = parseMaybeInventoryRows(v);
      if (parsed && parsed.length > 0) return parsed;
    }
    return null;
  };

  const keysPriority = [
    'inventory',
    'inventory_list',
    'inventoryList',
    'goods_list',
    'goodsList',
    'stock_list',
    'stockList',
    'slot_list',
    'slotList',
    'slots',
    'device_goods',
    'deviceGoods',
    'device_inventory',
    'deviceInventory',
    'cargo_lane',
    'cargoLane',
    'cargo_lanes',
    'lane_list',
    'goods',
    'list',
    'rows',
    'stock',
    'detail',
    'details'
  ];

  const hit = pickFirstNonEmpty(keysPriority);
  if (hit) return hit;

  for (const k of keysPriority) {
    const v = data[k];
    if (Array.isArray(v) && v.length > 0) return v;
    const parsed = parseMaybeInventoryRows(v);
    if (parsed && parsed.length > 0) return parsed;
  }

  const cabinets = data.cabinets ?? data.cabinet_list ?? data.cabinetList ?? data.sev_list ?? data.sevList;
  if (Array.isArray(cabinets)) {
    const out = [];
    for (const cab of cabinets) {
      const sevDefault = cab.sev_no ?? cab.sevNo ?? cab.cabinet_no ?? cab.cabinetNo ?? '1';
      const slots =
        cab.slots ??
        cab.inventory ??
        cab.goods_list ??
        cab.goodsList ??
        cab.goods ??
        cab.list ??
        cab.stock;
      const slotRows = Array.isArray(slots) ? slots : parseMaybeInventoryRows(slots);
      if (slotRows && slotRows.length) {
        for (const s of slotRows) {
          out.push({
            ...s,
            sev_no: s.sev_no ?? s.sevNo ?? sevDefault
          });
        }
      }
    }
    if (out.length > 0) return out;
  }

  if (depth < 2 && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    const inner = extractInventoryArrayFromDeviceDetail(data.data, depth + 1);
    if (inner.length > 0) return inner;
  }

  const scanned = findInventoryArrayByDeepScan(data);
  if (scanned.length > 0) return scanned;

  return [];
}

/** Best-effort parse of goods_id after sync_goods (vendor shapes differ: nested keys, id-only, numeric data). */
export function extractGoodsIdFromSyncResponse(result) {
  if (result == null) return '';

  /** Known exact keys across Yishouyun / portal-style payloads */
  const ID_KEYS_EXACT = [
    'goods_id',
    'goodsId',
    'goodsID',
    'goods_id_str',
    'goods_index_goodsid',
    'goodsIndexGoodsId',
    'GOODS_INDEX_GOODSID',
    'goodsid',
    'goods_no',
    'goodsNo',
    'product_id',
    'productId'
  ];

  const pickFromObject = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
    for (const k of ID_KEYS_EXACT) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        const v = obj[k];
        if (v != null && String(v).trim() !== '' && String(v).trim() !== '0') return String(v).trim();
      }
    }
    // Keys like goods_index_goodsid / GOODS_INDEX_GOODSID if vendor echoes UI slugs
    for (const k of Object.keys(obj)) {
      if (k === 'sign' || k === 'mch_no' || k === 'err' || k === 'msg') continue;
      if (/goodsid/i.test(k) || /^goods_.*_id$/i.test(k)) {
        const v = obj[k];
        if (v != null && String(v).trim() !== '' && String(v).trim() !== '0') return String(v).trim();
      }
    }
    const idVal = obj.id;
    if (
      idVal != null &&
      String(idVal).trim() !== '' &&
      ('goods_name' in obj ||
        'goodsName' in obj ||
        'goods_sn' in obj ||
        'goodsSn' in obj ||
        'pic_url' in obj ||
        'picUrl' in obj)
    ) {
      return String(idVal).trim();
    }
    return '';
  };

  const walk = (obj, depth, rootKeys) => {
    if (depth > 14 || obj == null) return '';
    if (typeof obj !== 'object') return '';

    const direct = pickFromObject(obj);
    if (direct) return direct;

    if (Array.isArray(obj)) {
      for (const el of obj) {
        const found = walk(el, depth + 1, rootKeys);
        if (found) return found;
      }
      return '';
    }
    for (const key of Object.keys(obj)) {
      if (rootKeys && (key === 'err' || key === 'msg')) continue;
      const found = walk(obj[key], depth + 1, rootKeys);
      if (found) return found;
    }
    return '';
  };

  const data = result.data;
  if (typeof data === 'number' && Number.isFinite(data)) {
    const s = String(Math.trunc(data));
    if (s !== '0' && s !== '-1') return s;
  }
  if (typeof data === 'string') {
    const t = data.trim();
    if (t && /^\d+$/.test(t)) return t;
  }
  if (data !== undefined && data !== null) {
    const fromData = walk(data, 0, false);
    if (fromData) return fromData;
  }

  return walk(result, 0, true);
}

/** Merge vendor slot rows with Tavari-persisted slots (key = sev-row-col). */
export function mergeVendorAndTavariSlots(vendorRows, tavariRows) {
  const map = new Map();

  for (const row of tavariRows || []) {
    const key = `${row.sevNo}-${row.row}-${row.col}`;
    map.set(key, { ...row, source: 'tavari' });
  }

  for (const row of vendorRows || []) {
    const key = `${row.sevNo}-${row.row}-${row.col}`;
    const existing = map.get(key);
    if (existing) {
      map.set(key, {
        ...existing,
        goodsId: row.goodsId || existing.goodsId,
        goodsName: row.goodsName || existing.goodsName,
        num: row.num ?? existing.num,
        maxNum: row.maxNum ?? existing.maxNum,
        source: 'vendor'
      });
    } else {
      map.set(key, { ...row, source: 'vendor' });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const sev = String(a.sevNo).localeCompare(String(b.sevNo));
    if (sev !== 0) return sev;
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });
}

/** Normalize a vending_device_slots DB row for dashboard / kiosk merge. */
export function normalizePersistedSlotRow(row, catalogItem) {
  const sevNo = String(row.sev_no ?? '1');
  const rowN = Number(row.row_num ?? 0);
  const colN = Number(row.col_num ?? 0);
  const goodsId = String(row.manufacturer_goods_id ?? '').trim();
  return {
    key: `${sevNo}-${rowN}-${colN}`,
    sevNo,
    row: rowN,
    col: colN,
    goodsId,
    goodsName: catalogItem?.name || row.goods_name || '—',
    num: row.num != null ? Number(row.num) : 0,
    maxNum: row.max_num != null ? Number(row.max_num) : 0,
    picUrl: catalogItem?.image_url || row.pic_url || '',
    price: catalogItem?.price != null ? Number(catalogItem.price) : row.price,
    posInventoryId: row.pos_inventory_id || catalogItem?.id || null,
    source: 'tavari'
  };
}

const callVendingEdgeFunction = async (action, params = {}) => {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session || !session.access_token) {
      throw new Error('Not authenticated - please log in again');
    }

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/vending-machine-api`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action, ...params }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      let msg = data.error || data.message || `Edge Function Error: ${response.status}`;
      if (/connect|timed out|Connection refused|ECONNRESET/i.test(String(msg))) {
        msg +=
          " — Supabase Edge may be unable to reach the vendor API host from its network region (common with overseas APIs). Confirm the VENDING_API_BASE_URL secret with the vendor, or use a relay the Edge runtime can reach.";
      }
      throw new Error(msg);
    }

    return data;
  } catch (error) {
    console.error(`Vending Machine Edge Function Failed:`, error);
    throw error;
  }
};

const callVendingKioskApi = async (action, params = {}, timeoutMs = 25000) => {
  const { businessId, externalDeviceId, kioskSecret, kioskShortCode, deviceId, ...rest } = params;
  const shortCode = kioskShortCode
    ? String(kioskShortCode).trim().toUpperCase()
    : '';

  if (!shortCode && (!businessId || !(externalDeviceId || deviceId) || !kioskSecret)) {
    throw new Error('Kiosk requires kioskShortCode or businessId+externalDeviceId+kioskSecret');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/vending-kiosk-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify(
      shortCode
        ? { action, kioskShortCode: shortCode, ...rest }
        : {
            action,
            businessId,
            externalDeviceId: normalizeVendorDeviceId(externalDeviceId || deviceId),
            kioskSecret,
            ...rest
          }
    ),
    signal: fetchAbortSignal(timeoutMs)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || data.message || `Kiosk API error: ${response.status}`);
  }
  return data;
};

class VendingMachineService {

  // Machine Status
  async checkMachineStatus(deviceId) {
    const id = normalizeVendorDeviceId(deviceId);
    const result = await callVendingEdgeFunction('checkMachineOnline', { deviceId: id });
    assertVendorOk(result);
    const online = parseVendorOnlineFlag(result.data ?? result);
    return {
      online,
      deviceId: id,
      ...(result.data && typeof result.data === 'object' ? result.data : result)
    };
  }

  async checkMachineOnline(deviceId) {
    const id = normalizeVendorDeviceId(deviceId);
    const result = await callVendingEdgeFunction('checkMachineOnline', { deviceId: id });
    assertVendorOk(result);
    return parseVendorOnlineFlag(result.data ?? result);
  }

  async checkCanOrder(deviceId, goodsId) {
    const result = await callVendingEdgeFunction('checkCanOrder', {
      deviceId: normalizeVendorDeviceId(deviceId),
      goodsId
    });
    return result.err === 0;
  }

  async getCanOrderStatus(deviceId, goodsId) {
    const result = await callVendingEdgeFunction('checkCanOrder', {
      deviceId: normalizeVendorDeviceId(deviceId),
      goodsId
    });
    return {
      ok: result.err === 0,
      msg: String(result.msg ?? (result.err === 0 ? 'OK' : 'Cannot order'))
    };
  }

  async testRemoteChannel({ deviceId, sevNo = '1', row = 1, col = 1 }) {
    const result = await callVendingEdgeFunction('testRemoteChannel', {
      deviceId: normalizeVendorDeviceId(deviceId),
      sevNo: String(sevNo),
      row: Number(row),
      col: Number(col)
    });
    assertVendorOk(result);
    return result;
  }

  async getDeviceDetails(deviceId) {
    const id = normalizeVendorDeviceId(deviceId);
    const result = await callVendingEdgeFunction('getDeviceDetails', { deviceId: id });
    if (result.err !== 0) {
      throw new Error(augmentVendorErrorMessage(result.msg) || 'Failed to get device details');
    }
    const raw = result.data || {};
    const inventory = extractInventoryArrayFromDeviceDetail(raw);
    if (inventory.length === 0 && raw && typeof raw === 'object') {
      console.info(
        '[vending] device_detail has no inventory array yet (keys: %s). Often normal until save_stock creates lanes — use Program a new slot + pasted goods_id.',
        Object.keys(raw).join(', ')
      );
    }
    return {
      deviceId: raw.device_id,
      devNo: raw.dev_no,
      devTypeNo: raw.dev_type_no,
      isOnline: parseVendorOnlineFlag(raw),
      lastReportAt: raw.last_report_at,
      ...raw,
      inventory
    };
  }

  // Inventory
  async getInventory(deviceId) {
    const details = await this.getDeviceDetails(deviceId);
    return {
      deviceId: details.deviceId,
      inventory: details.inventory || []
    };
  }

  async getTerminalGoodsList(deviceId) {
    const result = await callVendingEdgeFunction('getTerminalGoodsList', {
      deviceId: normalizeVendorDeviceId(deviceId)
    });
    assertVendorOk(result);
    return result.data || { items: [] };
  }

  async resolveGoodsIdAfterSync({ deviceId, goodsSn, goodsName }) {
    const result = await callVendingEdgeFunction('resolveGoodsIdAfterSync', {
      deviceId: normalizeVendorDeviceId(deviceId),
      goodsSn,
      goodsName
    });
    assertVendorOk(result);
    return {
      goodsId: String(result.data?.goodsId ?? '').trim(),
      terminalError: result.data?.terminalError || null
    };
  }

  /** Kiosk: load sellable products (Tavari slots + vendor + catalog fallback). */
  async recordKioskLocalDispense({ goodsId, orderNo, ...kioskAuth }) {
    const result = await callVendingKioskApi('recordLocalDispense', {
      ...kioskAuth,
      goodsId,
      orderNo
    });
    assertVendorOk(result);
    return result.data;
  }

  /** Tablet polls for dashboard remote RS485 test vends. */
  async pollKioskRemoteDispense(kioskAuth) {
    const result = await callVendingKioskApi('pollRemoteDispense', kioskAuth, 12000);
    assertVendorOk(result);
    return result.data || { command: null };
  }

  async completeKioskRemoteDispense({ commandId, ok, result, errorMessage, ...kioskAuth }) {
    const res = await callVendingKioskApi('completeRemoteDispense', {
      ...kioskAuth,
      commandId,
      ok: ok === true,
      result,
      errorMessage
    });
    assertVendorOk(res);
    return res.data;
  }

  async getKioskProducts(kioskAuth) {
    const result = await callVendingKioskApi('getProducts', kioskAuth, 35000);
    assertVendorOk(result);
    return result.data || { products: [], mergedSlots: [] };
  }

  async checkKioskMachineOnline(kioskAuth) {
    const result = await callVendingKioskApi('checkMachineOnline', kioskAuth, 15000);
    assertVendorOk(result);
    const data = result.data ?? result;
    return {
      online: parseVendorOnlineFlag(data),
      lastReportAt: data?.lastReportAt ?? data?.last_report_at ?? null,
      portalMayShowOnline: Boolean(data?.portalMayShowOnline),
      pingOnline: data?.pingOnline === true,
      detailOnline: data?.detailOnline === true
    };
  }

  async checkKioskCanOrder(kioskAuth, goodsId) {
    const result = await callVendingKioskApi('checkCanOrder', { ...kioskAuth, goodsId });
    return {
      ok: result.err === 0,
      msg: String(result.msg ?? (result.err === 0 ? 'OK' : 'Cannot order'))
    };
  }

  async createKioskOrder({ goodsId, orderNo, notifyUrl, testVendBypass, ...kioskAuth }) {
    const result = await callVendingKioskApi(
      'createOrder',
      {
        ...kioskAuth,
        goodsId,
        orderNo,
        notifyUrl,
        testVendBypass: testVendBypass === true
      },
      45000
    );
    assertVendorOk(result);
    return result;
  }

  async createKioskOrderWithPayment({
    goodsItems,
    orderNo,
    totalFee,
    notifyUrl,
    ...kioskAuth
  }) {
    return callVendingKioskApi('createOrderWithPayment', {
      ...kioskAuth,
      goodsItems,
      orderNo,
      totalFee,
      notifyUrl
    });
  }

  /** After Helcim kiosk payment completes — verify payment and dispense from machine. */
  async fulfillPaidOrder({ checkoutToken, expectedTotal, items, ...kioskAuth }) {
    const result = await callVendingKioskApi('fulfillPaidOrder', {
      ...kioskAuth,
      checkoutToken,
      expectedTotal,
      items
    });
    if (typeof result.err === 'number' && result.err !== 0) {
      throw new Error(result.msg || 'Fulfillment failed');
    }
    if (result.error) throw new Error(result.error);
    const data = result.data || {};
    return {
      ...data,
      clientDispense: Boolean(data.clientDispense),
      alreadyFulfilled: Boolean(data.alreadyFulfilled),
      dispenseResults: data.dispenseResults || [],
      partial: Boolean(data.partial)
    };
  }

  /** Staff PIN kiosk checkout — no payment; logs who took what. */
  async fulfillStaffOrder({
    staffUserId,
    staffName,
    items,
    batchOrderNo,
    dispenseResults,
    ...kioskAuth
  }) {
    const result = await callVendingKioskApi(
      'fulfillStaffOrder',
      {
        ...kioskAuth,
        staffUserId,
        staffName,
        items,
        batchOrderNo,
        dispenseResults
      },
      45000
    );
    if (typeof result.err === 'number' && result.err !== 0) {
      throw new Error(result.msg || 'Staff dispense failed');
    }
    if (result.error) throw new Error(result.error);
    const data = result.data || {};
    return {
      ...data,
      clientDispense: Boolean(data.clientDispense),
      dispenseResults: data.dispenseResults || [],
      partial: Boolean(data.partial),
      loggedCount: data.loggedCount ?? 0
    };
  }

  async saveInventory({ deviceId, sevNo, row, col, goodsId, maxNum, num }) {
    const result = await callVendingEdgeFunction('saveInventory', {
      deviceId: normalizeVendorDeviceId(deviceId),
      sevNo,
      row,
      col,
      goodsId,
      maxNum,
      num
    });
    assertVendorOk(result);
    return result;
  }

  async fillInventory({ deviceId, sevNo, row, col, goodsId, maxNum, num }) {
    const result = await callVendingEdgeFunction('fillInventory', {
      deviceId: normalizeVendorDeviceId(deviceId),
      sevNo,
      row,
      col,
      goodsId,
      maxNum,
      num
    });
    assertVendorOk(result);
    return result;
  }

  async fillAllInventory(deviceId, sevNo) {
    const result = await callVendingEdgeFunction('fillAllInventory', {
      deviceId: normalizeVendorDeviceId(deviceId),
      sevNo
    });
    assertVendorOk(result);
    return result;
  }

  async removeInventory({ deviceId, sevNo, row, col }) {
    const result = await callVendingEdgeFunction('removeInventory', {
      deviceId: normalizeVendorDeviceId(deviceId),
      sevNo,
      row,
      col
    });
    assertVendorOk(result);
    return result;
  }

  async downAllInventory(deviceId, sevNo) {
    const result = await callVendingEdgeFunction('downAllInventory', {
      deviceId: normalizeVendorDeviceId(deviceId),
      sevNo
    });
    assertVendorOk(result);
    return result;
  }

  // Orders
  async createOrder({ deviceId, goodsId, orderNo, notifyUrl }) {
    const result = await callVendingEdgeFunction('createOrder', {
      deviceId: normalizeVendorDeviceId(deviceId),
      goodsId,
      orderNo,
      notifyUrl
    });
    assertVendorOk(result);
    return result;
  }

  async createOrderWithPayment({ deviceId, goodsItems, orderNo, totalFee, notifyUrl }) {
    return callVendingEdgeFunction('createOrderWithPayment', {
      deviceId: normalizeVendorDeviceId(deviceId),
      goodsItems,
      orderNo,
      totalFee,
      notifyUrl
    });
  }

  // Sales
  async getRecentSales() {
    const result = await callVendingEdgeFunction('getRecentSales');
    return {
      records: result.data || [],
      count: result.data?.length || 0
    };
  }

  // Products
  async syncProduct({
    goodsName,
    goodsSn,
    picUrl,
    comePrice,
    price,
    vipPrice,
    usage,
    existingGoodsId,
    deviceId
  }) {
    const result = await callVendingEdgeFunction('syncProduct', {
      goodsName,
      goodsSn,
      picUrl,
      comePrice,
      price,
      vipPrice,
      usage,
      ...(deviceId ? { deviceId: normalizeVendorDeviceId(deviceId) } : {}),
      ...(existingGoodsId ? { existingGoodsId: String(existingGoodsId).trim() } : {})
    });
    assertVendorOk(result);
    let goodsId = extractGoodsIdFromSyncResponse(result);
    if (!goodsId && existingGoodsId) {
      goodsId = String(existingGoodsId).trim();
    }
    return { result, goodsId };
  }
}

export default new VendingMachineService();

