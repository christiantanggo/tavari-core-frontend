/**

 * Tablet kiosk: poll for dashboard remote dispense commands and run RS485 locally.

 */



import { useEffect, useRef } from 'react';

import { isRs485BridgeAvailable } from '../services/VendingMachine/localRs485Bridge';

import { pollAndExecuteRemoteDispense } from '../services/VendingMachine/remoteDispenseExecutor';



export function useRemoteDispenseListener({

  kioskAuth,

  dispenseMode,

  rs485Override,

  debugLog,

  enabled = true

}) {

  const busyRef = useRef(false);



  useEffect(() => {

    const rs485 = dispenseMode === 'rs485' || rs485Override;

    if (!enabled || !kioskAuth || !rs485) return undefined;



    let cancelled = false;



    const tick = async () => {

      if (cancelled || busyRef.current || !isRs485BridgeAvailable()) return;

      busyRef.current = true;

      try {

        await pollAndExecuteRemoteDispense(kioskAuth, debugLog);

      } catch (err) {

        debugLog?.('warn', 'Remote dispense poll failed', { message: err.message });

      } finally {

        busyRef.current = false;

      }

    };



    tick();

    const interval = setInterval(tick, 2000);

    return () => {

      cancelled = true;

      clearInterval(interval);

    };

  }, [kioskAuth, dispenseMode, rs485Override, debugLog, enabled]);

}


