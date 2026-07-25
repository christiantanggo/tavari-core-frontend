/**
 * Poll dashboard remote dispense queue and execute RS485 on this tablet.
 */

import vendingService from './VendingMachineService';
import { isRs485BridgeAvailable, localRs485VendLanes } from './localRs485Bridge';

export async function pollAndExecuteRemoteDispense(kioskAuth, debugLog) {
  if (!kioskAuth) return { skipped: true, reason: 'no-auth' };
  if (!isRs485BridgeAvailable()) return { skipped: true, reason: 'no-bridge' };

  const { command } = await vendingService.pollKioskRemoteDispense(kioskAuth);
  if (!command?.id) return { command: null };

  const lanes = [command.lane_byte];
  if (command.lane_byte_secondary != null) {
    lanes.push(command.lane_byte_secondary);
  }

  debugLog?.('info', 'Remote dispense command received', {
    commandId: command.id,
    lanes,
    row: command.row_num,
    col: command.col_num
  });

  try {
    const vend = await localRs485VendLanes({ lanes });
    await vendingService.completeKioskRemoteDispense({
      ...kioskAuth,
      commandId: command.id,
      ok: true,
      result: vend
    });
    debugLog?.('ok', 'Remote dispense completed', { lanes, vend });
    return { command, ok: true, vend };
  } catch (err) {
    await vendingService.completeKioskRemoteDispense({
      ...kioskAuth,
      commandId: command.id,
      ok: false,
      errorMessage: err.message || 'RS485 vend failed'
    });
    debugLog?.('error', 'Remote dispense failed', { message: err.message });
    return { command, ok: false, error: err.message };
  }
}
