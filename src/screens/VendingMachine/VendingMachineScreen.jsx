// src/screens/VendingMachine/VendingMachineScreen.jsx
// Main screen for vending machine kiosk mode

import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import VendingMachineKiosk from '../../components/VendingMachine/VendingMachineKiosk';
import { normalizeKioskShortCode } from '../../utils/vendingKioskSecret';

const VendingMachineScreen = () => {
  const { shortCode: routeShortCode } = useParams();
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);

  const kioskShortCode =
    normalizeKioskShortCode(routeShortCode) ||
    normalizeKioskShortCode(searchParams.get('code')) ||
    normalizeKioskShortCode(localStorage.getItem('vending_kiosk_short_code'));

  const deviceId =
    searchParams.get('deviceId') ||
    import.meta.env.VITE_VENDING_DEVICE_ID ||
    localStorage.getItem('vending_device_id');

  const businessId = searchParams.get('businessId') || localStorage.getItem('vending_business_id');
  const kioskSecret = searchParams.get('kioskSecret') || localStorage.getItem('vending_kiosk_secret');

  useEffect(() => {
    if (kioskShortCode) localStorage.setItem('vending_kiosk_short_code', kioskShortCode);
    if (deviceId) localStorage.setItem('vending_device_id', deviceId);
    if (businessId) localStorage.setItem('vending_business_id', businessId);
    if (kioskSecret) localStorage.setItem('vending_kiosk_secret', kioskSecret);
  }, [kioskShortCode, deviceId, businessId, kioskSecret]);

  const testVendMode =
    searchParams.get('testVend') === '1' || searchParams.get('test') === '1';

  const rs485Override =
    searchParams.get('dispense') === 'rs485' || searchParams.get('rs485') === '1';

  const debugMode =
    import.meta.env.DEV ||
    testVendMode ||
    rs485Override ||
    searchParams.get('debug') === '1';

  useEffect(() => {
    const handleContextMenu = (e) => e.preventDefault();
    const handleSelectStart = (e) => e.preventDefault();
    const handleKeyDown = (e) => {
      if (e.key === 'F12' || (e.ctrlKey && (e.key === 'u' || e.key === 'i'))) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('selectstart', handleSelectStart);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('selectstart', handleSelectStart);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, []);

  return (
    <div
      className="vending-machine-screen"
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        WebkitTouchCallout: 'none'
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <VendingMachineKiosk
        kioskShortCode={kioskShortCode || undefined}
        deviceId={deviceId}
        businessId={businessId}
        kioskSecret={kioskSecret}
        testVendMode={testVendMode}
        rs485Override={rs485Override}
        debugMode={debugMode}
      />
    </div>
  );
};

export default VendingMachineScreen;
