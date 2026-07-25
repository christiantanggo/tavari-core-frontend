// src/screens/TavariDiningDashboard.jsx
import React, { useState } from 'react';
import SessionManager from '../components/SessionManager';
import TavariTabSystemComponent from '../components/UI/TavariTabSystemComponent';

// Import the actual screen components
import TableMapScreen from './Dining/TableMapScreen';
import ReservationsScreen from './Dining/ReservationsScreen';
import FloorPlanEditor from './Dining/FloorPlanEditor';
import ModuleSettingsTabContent from '../components/Modules/ModuleSettingsTabContent';
import TavariModuleHeader from '../components/UI/TavariModuleHeader';

const DINING_TABS = [
  { id: 'table-map', label: '🪑 Table Map' },
  { id: 'reservations', label: '📅 Reservations' },
  { id: 'floor-editor', label: '🏗️ Floor Plan Editor' },
  { id: 'settings', label: '⚙️ Settings' },
];

const TavariDiningDashboard = () => {
  const [activeTab, setActiveTab] = useState('table-map');

  return (
    <SessionManager>
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        padding: '20px',
        paddingTop: '80px',
        boxSizing: 'border-box',
      }}>
        <TavariModuleHeader
          title="Tavari Dining"
          description="Manage table maps, reservations, floor plans, and dining operations."
          actionLabel="Table Map"
          onAction={() => setActiveTab('table-map')}
        />

        <TavariTabSystemComponent
          tabs={DINING_TABS}
          mode="state"
          activeTab={activeTab}
          onTabChange={setActiveTab}
          ariaLabel="Dining module"
          variant="module"
        />

        {/* Tab Content */}
        <div>
          {activeTab === 'table-map' && <TableMapScreen />}
          {activeTab === 'reservations' && <ReservationsScreen />}
          {activeTab === 'floor-editor' && <FloorPlanEditor />}
          {activeTab === 'settings' && <ModuleSettingsTabContent moduleKey="dining" />}
        </div>
      </div>
    </SessionManager>
  );
};

export default TavariDiningDashboard;
