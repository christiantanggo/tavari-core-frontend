// src/components/VendingMachine/MachineStatus.jsx

// Machine status indicator



import { formatVendorLastReport } from '../../services/VendingMachine/VendingMachineService';

import './MachineStatus.css';



const MachineStatus = ({

  isOnline,

  catalogReady,

  initialLoading,

  lastVendorReport,

  portalMayShowOnline,

  refreshing,

  onRefresh

}) => {

  const lastSeen = formatVendorLastReport(lastVendorReport);



  let state = 'offline';

  let label = 'Machine disconnected';



  if (initialLoading && !catalogReady) {

    state = 'ready';

    label = 'Loading…';

  } else if (isOnline) {

    state = 'online';

    label = 'Online — can vend';

  } else if (catalogReady) {

    state = 'ready';

    label = 'Catalog ready';

  }



  const showHelp = !isOnline && !initialLoading;



  return (

    <div className="machine-status">

      <div className={`machine-status-indicator machine-status-indicator--${state}`}>

        <span className={`machine-status-dot machine-status-dot--${state}`} />

        <span className="machine-status-text">{label}</span>

      </div>



      {showHelp ? (

        <span className="machine-status-sub">

          {catalogReady

            ? 'Products show from Tavari, but the manufacturer cloud says this machine cannot dispense yet.'

            : 'Waiting for product catalog.'}

          {lastSeen ? ` Last vendor check-in: ${lastSeen}.` : ' No recent vendor check-in.'}

          {portalMayShowOnline

            ? ' The manufacturer portal may still show Online — that view can lag.'

            : ''}

          {catalogReady

            ? ' On the tablet: open the manufacturer vending app, confirm it shows online, leave it running in the background, then tap Refresh.'

            : ''}

        </span>

      ) : null}

      <button

        type="button"

        className="machine-status-refresh"

        onClick={onRefresh}

        disabled={refreshing}

        aria-label="Refresh products and status"

      >

        {refreshing ? '…' : '↻ Refresh'}

      </button>

    </div>

  );

};



export default MachineStatus;

