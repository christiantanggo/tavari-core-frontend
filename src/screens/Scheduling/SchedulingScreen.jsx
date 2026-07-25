// src/screens/Scheduling/SchedulingScreen.jsx
import React, { useState } from 'react';
import SchedulesTab from '../../components/Scheduling/SchedulesTab';
import AvailabilityTab from '../../components/Scheduling/AvailabilityTab';
import TimeOffRequestsTab from '../../components/Scheduling/TimeOffRequestsTab';
import ShiftCoverageRequestsTab from '../../components/Scheduling/ShiftCoverageRequestsTab';
import TimesheetsTab from '../../components/Scheduling/TimesheetsTab';
import SchedulingSettingsPanel from '../../components/Scheduling/SchedulingSettingsPanel';
import EmployeeStatsTab from '../../components/Scheduling/EmployeeStatsTab.jsx';
import SchedulingNotificationsTab from '../../components/Scheduling/SchedulingNotificationsTab.jsx';
import { useBusiness } from '../../contexts/BusinessContext';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';

const SchedulingScreen = () => {
  const { business } = useBusiness();
  const [activeTab, setActiveTab] = useState('schedules');

  const tabs = [
    { id: 'schedules', label: 'Schedules' },
    { id: 'availability', label: 'Availability' },
    { id: 'timeOff', label: 'Time Off' },
    { id: 'shiftCoverage', label: 'Shift Coverage' },
    { id: 'timesheets', label: 'Timesheets' },
    { id: 'employeeStats', label: 'Employee Stats' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'settings', label: 'Settings' }
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'schedules':
        return <SchedulesTab businessId={business?.id} />;
      case 'availability':
        return <AvailabilityTab businessId={business?.id} />;
      case 'timeOff':
        return <TimeOffRequestsTab businessId={business?.id} />;
      case 'shiftCoverage':
        return <ShiftCoverageRequestsTab businessId={business?.id} />;
      case 'timesheets':
        return <TimesheetsTab businessId={business?.id} />;
      case 'employeeStats':
        return <EmployeeStatsTab businessId={business?.id} />;
      case 'notifications':
        return <SchedulingNotificationsTab businessId={business?.id} />;
      case 'settings':
        return <SchedulingSettingsPanel businessId={business?.id} />;
      default:
        return <SchedulesTab businessId={business?.id} />;
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      padding: '20px',
      paddingTop: '80px',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
    }}>
      <TavariModuleHeader
        title="Tavari Scheduling"
        description="Manage schedules, availability, time off, shift coverage, timesheets, and employee notifications."
        actionLabel="View Schedules"
        onAction={() => setActiveTab('schedules')}
      />

      <TavariTabSystemComponent
        tabs={tabs}
        mode="state"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Scheduling module"
        variant="module"
      />
      
      {/* Tab Content */}
      <div style={{ 
        flex: 1, 
        overflow: 'auto',
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '0'
      }}>
        {renderTabContent()}
      </div>
    </div>
  );
};

export default SchedulingScreen;
