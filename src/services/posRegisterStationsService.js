import { supabase } from '../supabaseClient';

const RECEIPT_PRINTER_LS_KEYS = [
  'receipt_printer_ip',
  'receipt_printer_port',
  'receipt_printer_type',
];

function normalizePrinterType(type) {
  const value = String(type || '').trim().toLowerCase();
  return value === 'none' ? 'none' : 'escpos';
}

function normalizePrinterPort(port) {
  const parsed = Number.parseInt(port, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) return 9100;
  return parsed;
}

export function applyRegisterStationToDevice(station) {
  if (!station?.terminal_id) return;

  localStorage.setItem('tavari_terminal_id', station.terminal_id);
  localStorage.setItem('tavari_terminal_name', station.terminal_name || station.terminal_id);

  const helcimCode = station.helcim_device_code?.trim();
  if (helcimCode) {
    localStorage.setItem('helcim_device_code', helcimCode.toUpperCase());
  }

  const printerIp = station.receipt_printer_ip?.trim() || '';
  const printerType = normalizePrinterType(station.receipt_printer_type);
  const printerPort = normalizePrinterPort(station.receipt_printer_port);

  if (printerIp && printerType === 'escpos') {
    localStorage.setItem('receipt_printer_ip', printerIp);
    localStorage.setItem('receipt_printer_port', String(printerPort));
    localStorage.setItem('receipt_printer_type', printerType);
  } else {
    RECEIPT_PRINTER_LS_KEYS.forEach((key) => localStorage.removeItem(key));
  }
}

export function getDeviceReceiptPrinterConfig() {
  try {
    const ip = (localStorage.getItem('receipt_printer_ip') || '').trim();
    const type = normalizePrinterType(localStorage.getItem('receipt_printer_type'));
    const port = normalizePrinterPort(localStorage.getItem('receipt_printer_port'));
    if (!ip || type !== 'escpos') return null;
    return { ip, port, type };
  } catch {
    return null;
  }
}

/**
 * Re-apply the active register station's printer settings from Supabase into localStorage.
 * Call before printing so "Use on this device" is not the only way the config sticks.
 */
export async function ensureReceiptPrinterFromActiveStation(businessId) {
  if (!businessId) return getDeviceReceiptPrinterConfig();

  const terminalId = localStorage.getItem('tavari_terminal_id');
  if (terminalId) {
    const station = await syncRegisterStationFromDb(businessId, terminalId);
    if (station) return getDeviceReceiptPrinterConfig();
  }

  // If this browser never selected a station (fingerprint TERM_ id), adopt the
  // only active station that has a network receipt printer.
  const { data: stations } = await fetchRegisterStations(businessId, { activeOnly: true });
  const withPrinter = (stations || []).filter(
    (s) => s.receipt_printer_ip?.trim() && normalizePrinterType(s.receipt_printer_type) === 'escpos'
  );
  if (withPrinter.length === 1) {
    applyRegisterStationToDevice(withPrinter[0]);
  }
  return getDeviceReceiptPrinterConfig();
}

export async function syncRegisterStationFromDb(businessId, terminalId) {
  if (!businessId || !terminalId) return null;

  const { data, error } = await supabase
    .from('pos_terminals')
    .select('*')
    .eq('business_id', businessId)
    .eq('terminal_id', terminalId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;

  applyRegisterStationToDevice(data);
  return data;
}

export async function fetchRegisterStations(businessId, { activeOnly = true } = {}) {
  if (!businessId) {
    return { data: [], error: null };
  }

  let query = supabase
    .from('pos_terminals')
    .select('*')
    .eq('business_id', businessId)
    .order('sort_order', { ascending: true })
    .order('terminal_name', { ascending: true });

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

function generateTerminalId(stationName) {
  const cleanName = stationName.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const timestamp = Date.now().toString(36).toUpperCase();
  return `${cleanName}_${timestamp}`.substring(0, 24);
}

function buildPrinterPayload(payload = {}) {
  const printerType = normalizePrinterType(payload.receipt_printer_type);
  const printerIp = payload.receipt_printer_ip?.trim() || null;
  const printerPort = normalizePrinterPort(payload.receipt_printer_port);

  if (!printerIp || printerType === 'none') {
    return {
      receipt_printer_ip: null,
      receipt_printer_port: 9100,
      receipt_printer_type: 'none',
    };
  }

  return {
    receipt_printer_ip: printerIp,
    receipt_printer_port: printerPort,
    receipt_printer_type: 'escpos',
  };
}

export async function createRegisterStation(businessId, payload, defaultFloat = 200) {
  const terminalId = generateTerminalId(payload.terminal_name || 'STATION');

  const { data: existing } = await supabase
    .from('pos_terminals')
    .select('sort_order')
    .eq('business_id', businessId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const nextSort = (existing?.[0]?.sort_order || 0) + 1;
  const printerFields = buildPrinterPayload(payload);

  return supabase
    .from('pos_terminals')
    .insert([{
      business_id: businessId,
      terminal_name: payload.terminal_name.trim(),
      terminal_id: terminalId,
      location_description: payload.location_description?.trim() || null,
      helcim_device_code: payload.helcim_device_code?.trim().toUpperCase() || null,
      float_amount: Number(payload.float_amount) || defaultFloat,
      sort_order: payload.sort_order ?? nextSort,
      is_active: payload.is_active !== false,
      ...printerFields,
    }])
    .select()
    .maybeSingle();
}

export async function updateRegisterStation(stationId, businessId, payload) {
  const printerFields = buildPrinterPayload(payload);

  return supabase
    .from('pos_terminals')
    .update({
      terminal_name: payload.terminal_name.trim(),
      location_description: payload.location_description?.trim() || null,
      helcim_device_code: payload.helcim_device_code?.trim().toUpperCase() || null,
      float_amount: Number(payload.float_amount) || 200,
      sort_order: payload.sort_order,
      is_active: payload.is_active !== false,
      updated_at: new Date().toISOString(),
      ...printerFields,
    })
    .eq('id', stationId)
    .eq('business_id', businessId)
    .select()
    .maybeSingle();
}

export async function deactivateRegisterStation(stationId, businessId) {
  return supabase
    .from('pos_terminals')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', stationId)
    .eq('business_id', businessId);
}

/** Daily deposits store pos_terminals.terminal_id in terminal_id column. */
export function getStationDepositKey(station) {
  return station?.terminal_id || '';
}

export function resolveStationLabel(terminalKey, stations = []) {
  const match = stations.find(
    (station) => station.terminal_id === terminalKey || station.id === terminalKey
  );
  if (match) return match.terminal_name;
  if (!terminalKey) return 'Unknown';
  if (terminalKey.startsWith('TERM_')) return `Till ${terminalKey.slice(-4).toUpperCase()}`;
  return terminalKey;
}
