import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import OnboardingCenter from './OnboardingCenter';
import MilestoneTracker from './MilestoneTracker';
import OrientationCalendar from './OrientationCalendar';
import PolicyCenter from './PolicyCenter';
import TrainingCenter from './TrainingCenter';

const TAB_DEFS = [
  {
    id: 'onboarding',
    label: 'Onboarding',
    icon: '📋',
    requiredPermissions: ['hr.onboarding.view'],
  },
  {
    id: 'milestones',
    label: 'Milestones',
    icon: '🎯',
    requiredPermissions: ['hr.onboarding.view'],
  },
  {
    id: 'orientation',
    label: 'Orientation',
    icon: '📅',
    requiredPermissions: ['hr.onboarding.view'],
  },
  {
    id: 'policies',
    label: 'Policies',
    icon: '📜',
    requiredPermissions: ['hr.policies.view'],
  },
  {
    id: 'training',
    label: 'Training',
    icon: '📚',
    requiredPermissions: ['hr.onboarding.view', 'hr.policies.view'],
  },
];

const HRTrainingHub = () => {
  const navigate = useNavigate();
  const { recordAction } = useSecurityContext({
    componentName: 'HRTrainingHub',
    sensitiveComponent: false,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'low',
  });

  const { selectedBusinessId, authLoading, authError } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'HRTrainingHub',
  });

  const { hasAnyPermission, hasElevatedPrivileges, loading: permissionsLoading } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('onboarding');

  const availableTabs = useMemo(() => {
    return TAB_DEFS.filter((t) => {
      if (!t.requiredPermissions?.length) return true;
      return hasAnyPermission(t.requiredPermissions) || hasElevatedPrivileges();
    });
  }, [hasAnyPermission, hasElevatedPrivileges, permissionsLoading]);

  useEffect(() => {
    if (permissionsLoading || !availableTabs.length) return;
    const fromUrl = searchParams.get('tab');
    if (fromUrl && availableTabs.some((t) => t.id === fromUrl)) {
      if (fromUrl !== activeTab) setActiveTab(fromUrl);
      return;
    }
    if (!availableTabs.find((t) => t.id === activeTab)) {
      const next = availableTabs[0].id;
      setActiveTab(next);
      setSearchParams({ tab: next }, { replace: true });
    }
  }, [permissionsLoading, availableTabs, searchParams, activeTab, setSearchParams]);

  const handleTabChange = useCallback(
    (tabId) => {
      const def = TAB_DEFS.find((t) => t.id === tabId);
      if (!def) return;
      if (def.requiredPermissions?.length && !hasAnyPermission(def.requiredPermissions) && !hasElevatedPrivileges()) {
        toast.error('You do not have permission to open this tab');
        return;
      }
      setActiveTab(tabId);
      setSearchParams({ tab: tabId });
      setTimeout(() => {
        recordAction('hr_training_tab', true).catch(() => {});
      }, 0);
    },
    [hasAnyPermission, hasElevatedPrivileges, setSearchParams, recordAction]
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'onboarding':
        return (
          <PermissionGate
            permissions={['hr.onboarding.view']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to view onboarding.</p>
              </div>
            }
          >
            <OnboardingCenter />
          </PermissionGate>
        );
      case 'milestones':
        return (
          <PermissionGate
            permissions={['hr.onboarding.view']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to view milestones.</p>
              </div>
            }
          >
            <MilestoneTracker />
          </PermissionGate>
        );
      case 'orientation':
        return (
          <PermissionGate
            permissions={['hr.onboarding.view']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to view orientation.</p>
              </div>
            }
          >
            <OrientationCalendar />
          </PermissionGate>
        );
      case 'policies':
        return (
          <PermissionGate
            permissions={['hr.policies.view']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to view policies.</p>
              </div>
            }
          >
            <PolicyCenter />
          </PermissionGate>
        );
      case 'training':
        return (
          <PermissionGate
            permissions={['hr.onboarding.view', 'hr.policies.view']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to view training.</p>
              </div>
            }
          >
            <TrainingCenter businessId={selectedBusinessId} />
          </PermissionGate>
        );
      default:
        return null;
    }
  };

  if (permissionsLoading || authLoading) {
    return (
      <div style={loadingWrap}>
        <div style={spinner} />
        <p style={loadingText}>Loading…</p>
      </div>
    );
  }

  if (!hasElevatedPrivileges() && !availableTabs.length) {
    return (
      <div style={loadingWrap}>
        <p style={loadingText}>You do not have permission to access Training.</p>
      </div>
    );
  }

  if (authError) {
    return (
      <div style={loadingWrap}>
        <p style={loadingText}>{authError}</p>
      </div>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin', 'hr_admin']}
      requireBusiness
      componentName="HRTrainingHub"
    >
      <SecurityWrapper>
        <div style={page}>
          <TavariModuleHeader
            title="Training"
            description="Onboarding, milestones, orientation, policies, and training assignments."
            actionLabel="HR overview"
            onAction={() => navigate('/dashboard/hr/dashboard')}
          />

          <TavariTabSystemComponent
            tabs={availableTabs}
            mode="state"
            activeTab={activeTab}
            onTabChange={handleTabChange}
            ariaLabel="HR Training module"
            variant="module"
          />

          <div style={content}>{renderContent()}</div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const page = {
  minHeight: '100vh',
  backgroundColor: '#f9fafb',
  paddingTop: '80px',
  paddingLeft: '20px',
  paddingRight: '20px',
  paddingBottom: '20px',
};

const content = { minHeight: '240px' };
const loadingWrap = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#f9fafb',
  paddingTop: '80px',
};
const loadingText = { color: '#6b7280', fontSize: '16px' };
const spinner = {
  width: '32px',
  height: '32px',
  border: '3px solid #14B8A6',
  borderTop: '3px solid transparent',
  borderRadius: '50%',
  animation: 'spin 1s linear infinite',
  marginBottom: '8px',
};
const noAccessStyle = { padding: '24px' };
const noAccessTextStyle = { color: '#6b7280' };

export default HRTrainingHub;
