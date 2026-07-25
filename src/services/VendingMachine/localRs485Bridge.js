// Local RS485 bridge on the vending tablet (Tavari Vending Bridge APK).

import { resolveRs485Lanes } from '../../utils/vendingDualVend';

export { resolveRs485Lanes };

const BRIDGE_HTTP = 'http://127.0.0.1:8765';

export function resolveRs485Lane(product) {
  const lanes = resolveRs485Lanes(product);
  return lanes[0] ?? 0;
}

export function isRs485BridgeAvailable() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.TavariVendingBridge?.vend);
}

function parseBridgeJson(raw) {
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function parseVendResult(raw, fallbackMsg) {
  const parsed = parseBridgeJson(raw);
  if (!parsed?.ok) {
    throw new Error(parsed?.message || fallbackMsg);
  }
  return parsed;
}

function isMissingMethod(err) {
  return /not a function|undefined is not|no such method/i.test(String(err?.message || err || ''));
}

function tryNativeDual(bridge, l1, l2, slave) {
  const sl = Number(slave) || 1;
  const tries = [
    () => bridge.vend3(l1, sl, l2),
    () => bridge.vendSecond(l1, l2),
    () => bridge.vendDual(l1, l2, sl)
  ];
  for (const fn of tries) {
    try {
      return fn();
    } catch (err) {
      if (!isMissingMethod(err)) throw err;
    }
  }
  return null;
}

async function tryLocalHttpDual(l1, l2, slave) {
  const res = await fetch(`${BRIDGE_HTTP}/vend-dual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lanes: [l1, l2], slave: Number(slave) || 1 })
  });
  const data = await res.json();
  if (!data?.ok) {
    throw new Error(data?.message || 'Dual RS485 vend failed');
  }
  return data;
}

/** One motor. */
export async function localRs485Vend({ lane, slave = 0x01 }) {
  const laneByte = Number(lane);
  if (!Number.isFinite(laneByte) || laneByte < 0 || laneByte > 0x63) {
    throw new Error(`Invalid RS485 lane: ${lane}`);
  }
  const bridge = window.TavariVendingBridge;
  if (!bridge?.vend) {
    throw new Error('Open Tavari Vending on the tablet');
  }
  return parseVendResult(bridge.vend(laneByte, slave), 'RS485 vend failed');
}

/** Two motors at the same time. */
export async function localRs485VendLanes({ lanes, product, slave = 0x01 }) {
  const resolved = Array.isArray(lanes) && lanes.length ? lanes : resolveRs485Lanes(product);
  const unique = [...new Set(resolved.map(Number))].filter(
    (l) => Number.isFinite(l) && l >= 0 && l <= 0x63
  );

  if (!unique.length) throw new Error('No RS485 lanes to vend');
  if (unique.length === 1) return localRs485Vend({ lane: unique[0], slave });

  const bridge = window.TavariVendingBridge;
  if (!bridge?.vend) {
    throw new Error('Open Tavari Vending on the tablet');
  }

  const l1 = unique[0];
  const l2 = unique[1];

  const nativeRaw = tryNativeDual(bridge, l1, l2, slave);
  if (nativeRaw != null) {
    return parseVendResult(nativeRaw, 'Dual RS485 vend failed');
  }

  try {
    return await tryLocalHttpDual(l1, l2, slave);
  } catch (httpErr) {
    throw new Error(
      `Wide vend needs Tavari Vending v1.0.17 — uninstall app, install from tavarios.ca/vending/download, reload kiosk. (${httpErr.message || 'bridge missing dual vend'})`
    );
  }
}

export async function localRs485Health() {
  const bridge = window.TavariVendingBridge;
  if (!bridge?.health) throw new Error('Bridge not available');
  const raw = bridge.health();
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
