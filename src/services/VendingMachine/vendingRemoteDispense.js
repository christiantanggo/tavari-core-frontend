/**
 * Remote RS485 dispense: dashboard queues commands; tablet kiosk executes via APK bridge.
 */

import { supabase } from '../../supabaseClient';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getTabletBridgeStatus(vendingDeviceId) {
  if (!vendingDeviceId) return { online: false, lastSeenAt: null };
  const { data, error } = await supabase
    .from('vending_devices')
    .select('kiosk_bridge_last_seen_at, dispense_mode')
    .eq('id', vendingDeviceId)
    .maybeSingle();
  if (error) throw error;
  const lastSeenAt = data?.kiosk_bridge_last_seen_at || null;
  const seenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  const online = seenMs > 0 && Date.now() - seenMs < 120_000;
  return { online, lastSeenAt, dispenseMode: data?.dispense_mode || 'cloud' };
}

export async function requestRemoteDispense({
  businessId,
  vendingDeviceId,
  laneByte,
  laneByteSecondary,
  rowNum,
  colNum
}) {
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('vending_device_dispense_commands')
    .insert({
      business_id: businessId,
      vending_device_id: vendingDeviceId,
      lane_byte: laneByte,
      lane_byte_secondary: laneByteSecondary ?? null,
      row_num: rowNum ?? null,
      col_num: colNum ?? null,
      source: 'dashboard',
      requested_by: user?.id ?? null
    })
    .select('id, status, created_at')
    .single();

  if (error) throw error;
  return data;
}

export async function getRemoteDispenseCommand(commandId) {
  const { data, error } = await supabase
    .from('vending_device_dispense_commands')
    .select('id, status, error_message, result, lane_byte, started_at, completed_at')
    .eq('id', commandId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function waitForRemoteDispense(commandId, { timeoutMs = 45_000, pollMs = 800 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await getRemoteDispenseCommand(commandId);
    if (!row) return { ok: false, error: 'Command not found' };
    if (row.status === 'completed') {
      return { ok: true, result: row.result, laneByte: row.lane_byte };
    }
    if (row.status === 'failed') {
      return { ok: false, error: row.error_message || 'Dispense failed on tablet' };
    }
    if (row.status === 'expired') {
      return { ok: false, error: 'Command expired' };
    }
    await sleep(pollMs);
  }
  return {
    ok: false,
    error:
      'Timed out waiting for tablet — reinstall Tavari Vending APK (v1.0.1+) or force-stop and reopen the app on the tablet'
  };
}
