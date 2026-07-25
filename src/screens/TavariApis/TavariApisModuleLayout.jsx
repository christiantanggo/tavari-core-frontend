import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { FiGlobe, FiHome, FiMonitor, FiSettings } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { useModuleEnabled } from '../../hooks/useModuleEnabled';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';

const BASE = '/dashboard/tavari-apis';

const TAVARI_APIS_TABS = [
  { id: 'overview', label: 'Overview', icon: FiHome, to: BASE, end: true },
  { id: 'endpoints', label: 'Endpoints', icon: FiGlobe, to: `${BASE}/endpoints` },
  { id: 'consumers', label: 'Consumers', icon: FiMonitor, to: `${BASE}/consumers` },
  { id: 'settings', label: 'Settings', icon: FiSettings, to: `${BASE}/settings` },
];

const layoutStyles = {
  shell: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
    padding: '20px',
    paddingTop: '80px',
    boxSizing: 'border-box',
  },
  centered: {
    padding: TavariStyles.spacing.xl,
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.base,
  },
};

export default function TavariApisModuleLayout() {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { isEnabled, loading: moduleLoading } = useModuleEnabled('tavari_apis');

  if (moduleLoading) {
    return <div style={layoutStyles.centered}>Loading Tavari APIs…</div>;
  }

  if (!selectedBusinessId) {
    return <div style={layoutStyles.centered}>Select a business to manage Tavari APIs.</div>;
  }

  if (!isEnabled) {
    return (
      <div style={layoutStyles.shell}>
        <TavariModuleHeader
          title="Tavari APIs"
          description="Publish read-only business data to external websites and apps. Enable this module from the home marketplace to get started."
        />
        <p style={layoutStyles.centered}>
          Tavari APIs is not enabled for this business yet.
        </p>
      </div>
    );
  }

  return (
    <div style={layoutStyles.shell}>
      <TavariModuleHeader
        title="Tavari APIs"
        description="Expose public read-only endpoints so external sites — like your marketing website — stay in sync when you update Tavari."
        actionLabel="View Endpoints"
        actionIcon={<FiGlobe size={18} />}
        onAction={() => navigate(`${BASE}/endpoints`)}
      />
      <TavariTabSystemComponent
        tabs={TAVARI_APIS_TABS}
        mode="route"
        ariaLabel="Tavari APIs module navigation"
      />
      <Outlet />
    </div>
  );
}
