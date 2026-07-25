import React, { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import {
  Briefcase,
  FileText,
  LayoutDashboard,
  Plus,
  Settings,
  Sparkles,
} from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import { useModuleEnabled } from '../../hooks/useModuleEnabled';
import ModuleCatalogService from '../../services/ModuleCatalogService';

const FUNDING_TABS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    to: '/dashboard/funding',
    matchPaths: [{ path: '/dashboard/funding', end: true }],
  },
  {
    id: 'plans',
    label: 'Business plans',
    icon: Briefcase,
    to: '/dashboard/funding/plans',
    isActive: ({ pathname }) =>
      pathname.startsWith('/dashboard/funding/plans') || pathname.startsWith('/dashboard/funding/plan/'),
  },
  {
    id: 'applications',
    label: 'Applications',
    icon: FileText,
    to: '/dashboard/funding/applications',
    isActive: ({ pathname }) =>
      pathname.startsWith('/dashboard/funding/applications')
      || pathname.startsWith('/dashboard/funding/application/'),
  },
  {
    id: 'opportunities',
    label: 'Opportunities',
    icon: Sparkles,
    to: '/dashboard/funding/opportunities',
    matchPaths: [{ path: '/dashboard/funding/opportunities', end: true }],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    to: '/dashboard/funding/settings',
    matchPaths: [{ path: '/dashboard/funding/settings', end: true }],
  },
];

const layoutStyles = {
  shell: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
    padding: '20px',
    paddingTop: '80px',
    boxSizing: 'border-box',
  },
};

export default function FundingModuleLayout() {
  const navigate = useNavigate();
  const { isEnabled, loading } = useModuleEnabled('funding');

  useEffect(() => {
    ModuleCatalogService.trackModuleUsage('funding');
  }, []);

  if (loading) {
    return (
      <div style={{ ...layoutStyles.shell, textAlign: 'center', paddingTop: '120px' }}>
        Loading Tavari Funding…
      </div>
    );
  }

  if (!isEnabled) {
    return (
      <div style={{ ...layoutStyles.shell, textAlign: 'center', paddingTop: '120px' }}>
        <h2 style={{ marginBottom: '8px' }}>Tavari Funding is not activated</h2>
        <p style={{ color: TavariStyles.colors.gray600 }}>
          Enable this paid add-on from the dashboard marketplace to manage business plans, loans, and grants.
        </p>
      </div>
    );
  }

  return (
    <div style={layoutStyles.shell}>
      <TavariModuleHeader
        title="Tavari Funding"
        description="Business plans, loan and grant applications, scenarios, collaborators, and Canadian program alerts."
        actionLabel="+ New plan"
        actionIcon={<Plus size={18} />}
        onAction={() => navigate('/dashboard/funding/plans/new')}
        secondaryActionLabel="New application"
        onSecondaryAction={() => navigate('/dashboard/funding/applications/new')}
      />
      <TavariTabSystemComponent
        tabs={FUNDING_TABS}
        mode="route"
        ariaLabel="Tavari Funding module navigation"
      />
      <Outlet />
    </div>
  );
}
