import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';

const reputationModuleLayoutStyles = {
  outer: {
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    padding: '20px',
    paddingTop: '80px',
    boxSizing: 'border-box',
    fontFamily: TavariStyles.typography.fontFamily,
  },
};

export default function ReputationModuleLayout() {
  const navigate = useNavigate();
  const base = '/dashboard/reputation';
  const tabs = [
    { id: 'dashboard', label: 'Dashboard', to: base, end: true },
    { id: 'settings', label: 'Settings', to: `${base}/settings` },
  ];

  return (
    <div style={reputationModuleLayoutStyles.outer}>
      <TavariModuleHeader
        title="Tavari Reputation"
        description="Review requests, public review links, and feedback capture."
        actionLabel="Settings"
        onAction={() => navigate(`${base}/settings`)}
      />
      <TavariTabSystemComponent
        tabs={tabs}
        mode="route"
        ariaLabel="Reputation module"
        variant="module"
      />
      <Outlet />
    </div>
  );
}
