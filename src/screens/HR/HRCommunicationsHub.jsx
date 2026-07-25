import React, { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import AcknowledgementCenter from './AcknowledgementCenter';
import IncidentCenter from './IncidentCenter';
import StaffUpdatesCenter from './StaffUpdatesCenter';
import HRSettings from './HRSettings';

const TAB_DEFS = [
  {
    id: 'acknowledgements',
    label: 'Acknowledgements',
    icon: '⚠️',
    requiredPermissions: ['hr.writeups.view', 'hr.policies.view'],
  },
  {
    id: 'incidents',
    label: 'Incidents',
    icon: '🛡️',
    requiredPermissions: ['hr.writeups.view', 'hr.employees.view'],
  },
  {
    id: 'staff-updates',
    label: 'Staff Updates',
    icon: '📣',
    requiredPermissions: ['hr.employees.view', 'hr.policies.view'],
  },
  {
    id: 'approval-settings',
    label: 'Approvals',
    icon: '✅',
    requiredPermissions: ['hr.settings.view', 'hr.settings.manage'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: '🔔',
    requiredPermissions: ['hr.settings.view', 'hr.settings.manage'],
  },
  {
    id: 'document-management',
    label: 'Documents Retention',
    icon: '📄',
    requiredPermissions: ['hr.documents.manage', 'hr.settings.view', 'hr.settings.manage'],
  },
];

const HRCommunicationsHub = () => {
  const navigate = useNavigate();
  const { recordAction } = useSecurityContext({
    componentName: 'HRCommunicationsHub',
    sensitiveComponent: false,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'low',
  });

  const { selectedBusinessId, authLoading, authError } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'HRCommunicationsHub',
  });

  const { hasAnyPermission, hasElevatedPrivileges, loading: permissionsLoading } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('acknowledgements');

  const availableTabs = useMemo(() => {
    return TAB_DEFS.filter((t) => {
      if (!t.requiredPermissions?.length) return true;
      return hasAnyPermission(t.requiredPermissions) || hasElevatedPrivileges();
    });
  }, [hasAnyPermission, hasElevatedPrivileges, permissionsLoading]);

  const canView = useMemo(
    () => hasElevatedPrivileges() || availableTabs.length > 0,
    [hasElevatedPrivileges, availableTabs]
  );

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

  useEffect(() => {
    if (!permissionsLoading && !canView) {
      toast.error('You do not have permission to access this page');
    }
  }, [permissionsLoading, canView]);

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
        recordAction('hr_communications_tab', true).catch(() => {});
      }, 0);
    },
    [hasAnyPermission, hasElevatedPrivileges, setSearchParams, recordAction]
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'acknowledgements':
        return (
          <PermissionGate
            permissions={['hr.writeups.view', 'hr.policies.view']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to view acknowledgements.</p>
              </div>
            }
          >
            <AcknowledgementCenter businessId={selectedBusinessId} />
          </PermissionGate>
        );
      case 'incidents':
        return (
          <PermissionGate
            permissions={['hr.writeups.view', 'hr.employees.view']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to view incidents.</p>
              </div>
            }
          >
            <IncidentCenter businessId={selectedBusinessId} />
          </PermissionGate>
        );
      case 'staff-updates':
        return (
          <PermissionGate
            permissions={['hr.employees.view', 'hr.policies.view']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to view staff updates.</p>
              </div>
            }
          >
            <StaffUpdatesCenter businessId={selectedBusinessId} />
          </PermissionGate>
        );
      case 'approval-settings':
      case 'notifications':
      case 'document-management':
        return (
          <HRSettings
            mode="embed"
            embedScope="communications"
            activeSettingsTab={activeTab}
          />
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
        <p style={loadingText}>You do not have permission to access HR Communications.</p>
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
      componentName="HRCommunicationsHub"
    >
      <SecurityWrapper>
        <div style={page}>
          <TavariModuleHeader
            title="HR Communications"
            description="Acknowledgements, incidents, updates, and communication-related settings."
            actionLabel="HR overview"
            onAction={() => navigate('/dashboard/hr/dashboard')}
          />

          <TavariTabSystemComponent
            tabs={availableTabs}
            mode="state"
            activeTab={activeTab}
            onTabChange={handleTabChange}
            ariaLabel="HR Communications module"
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

export default HRCommunicationsHub;
