import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiCheckCircle, FiList } from 'react-icons/fi';
import { SecurityWrapper } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import PartyCheckInScreen from './PartyCheckInScreen';
import PartyGuestListsScreen from './PartyGuestListsScreen';

const PARTY_TABS = [
  { id: 'guest-lists', label: 'Guest lists', icon: <FiList /> },
  { id: 'check-in', label: 'Check-in', icon: <FiCheckCircle /> },
];

export default function PartiesDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('guest-lists');

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && PARTY_TABS.some((tab) => tab.id === tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const handleTabChange = (tabId) => {
    if (!PARTY_TABS.some((tab) => tab.id === tabId)) return;
    setActiveTab(tabId);
    if (tabId === 'guest-lists') {
      if (searchParams.get('tab')) setSearchParams({});
    } else {
      setSearchParams({ tab: tabId });
    }
  };

  const tabContent = useMemo(() => {
    if (activeTab === 'check-in') {
      return <PartyCheckInScreen embedded />;
    }
    return <PartyGuestListsScreen embedded />;
  }, [activeTab]);

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="PartiesDashboard"
      >
        <div style={{ padding: 'clamp(16px, 3vw, 30px)', width: '100%', boxSizing: 'border-box' }}>
          <TavariModuleHeader
            title="Parties"
            description="Manage party guest lists and day-of check-in."
          />

          <TavariTabSystemComponent
            tabs={PARTY_TABS}
            mode="state"
            activeTab={activeTab}
            onTabChange={handleTabChange}
            ariaLabel="Parties module"
            variant="module"
          />

          <div
            style={{
              backgroundColor: 'white',
              borderRadius: 12,
              padding: 'clamp(16px, 3vw, 30px)',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
              minHeight: 400,
              marginTop: 0,
            }}
          >
            {tabContent}
          </div>
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
}
