import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import HRSettings from './HRSettings';
import HRPositionManagementPanel from './HRPositionManagementPanel';
import EmployeeProfiles from './EmployeeProfiles';
import ContractManagement from './ContractManagement';
import DocumentExpiryTracker from './DocumentExpiryTracker';
import WriteupManagement from './WriteupManagement';

const TAB_DEFS = [
  {
    id: 'employees',
    label: 'Employees',
    icon: '👥',
    requiredPermissions: ['hr.employees.view', 'hr.employees.view_all'],
  },
  {
    id: 'contracts',
    label: 'Contracts',
    icon: '📄',
    requiredPermissions: ['hr.contracts.view'],
  },
  {
    id: 'certificates',
    label: 'Certificates',
    icon: '📜',
    requiredPermissions: ['hr.documents.view'],
  },
  {
    id: 'writeups',
    label: 'Disciplinary',
    icon: '⚠️',
    requiredPermissions: ['hr.writeups.view'],
  },
  {
    id: 'employee-management',
    label: 'Employee Management',
    icon: '👥',
    requiredPermissions: ['hr.settings.view', 'hr.settings.manage'],
  },
  {
    id: 'leave-benefits',
    label: 'Leave & Benefits',
    icon: '🖊️',
    requiredPermissions: ['hr.settings.view', 'hr.settings.manage'],
  },
  {
    id: 'shift-premiums',
    label: 'Shift Premiums',
    icon: '💰',
    requiredPermissions: ['hr.premiums.manage', 'hr.settings.manage', 'hr.settings.view'],
  },
  {
    id: 'position-management',
    label: 'Position Management',
    icon: '💼',
    requiredPermissions: ['hr.employees.view', 'hr.employees.view_all'],
  },
];

const HREmployeeManagementHub = () => {
  const navigate = useNavigate();
  const { recordAction } = useSecurityContext({
    componentName: 'HREmployeeManagementHub',
    sensitiveComponent: false,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'low',
  });

  const {
    selectedBusinessId,
    authLoading,
    authError,
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'HREmployeeManagementHub',
  });

  const { hasAnyPermission, hasElevatedPrivileges, loading: permissionsLoading } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('employees');

  const availableTabs = useMemo(() => {
    return TAB_DEFS.filter((t) => {
      if (!t.requiredPermissions?.length) return true;
      return hasAnyPermission(t.requiredPermissions) || hasElevatedPrivileges();
    });
  }, [hasAnyPermission, hasElevatedPrivileges, permissionsLoading]);

  // Legacy ?tab=documents → Certificates
  useEffect(() => {
    if (searchParams.get('tab') === 'documents') {
      setSearchParams({ tab: 'certificates' }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

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
        recordAction('hr_employee_management_tab', true).catch(() => {});
      }, 0);
    },
    [hasAnyPermission, hasElevatedPrivileges, setSearchParams, recordAction]
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'employees':
        return (
          <PermissionGate
            permissions={['hr.employees.view', 'hr.employees.view_all']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to view employees.</p>
              </div>
            }
          >
            <EmployeeProfiles />
          </PermissionGate>
        );
      case 'contracts':
        return (
          <PermissionGate
            permissions={['hr.contracts.view']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to view contracts.</p>
              </div>
            }
          >
            <ContractManagement />
          </PermissionGate>
        );
      case 'certificates':
        return (
          <PermissionGate
            permissions={['hr.documents.view']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to view certificates.</p>
              </div>
            }
          >
            <DocumentExpiryTracker />
          </PermissionGate>
        );
      case 'writeups':
        return (
          <PermissionGate
            permissions={['hr.writeups.view']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to view disciplinary records.</p>
              </div>
            }
          >
            <WriteupManagement />
          </PermissionGate>
        );
      case 'employee-management':
      case 'leave-benefits':
      case 'shift-premiums':
        return (
          <HRSettings
            mode="embed"
            embedScope="employee"
            activeSettingsTab={activeTab}
          />
        );
      case 'position-management':
        return (
          <PermissionGate
            permissions={['hr.employees.view', 'hr.employees.view_all']}
            fallback={
              <div style={noAccessStyle}>
                <p style={noAccessTextStyle}>You do not have permission to manage positions.</p>
              </div>
            }
          >
            <HRPositionManagementPanel businessId={selectedBusinessId} />
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
        <p style={loadingText}>You do not have permission to access Employee Management.</p>
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
      componentName="HREmployeeManagementHub"
    >
      <SecurityWrapper>
        <div style={page}>
          <TavariModuleHeader
            title="Employee Management"
            description="Employees, contracts, certificates (e.g. food safety, first aid), discipline, and related HR configuration."
            actionLabel="HR overview"
            onAction={() => navigate('/dashboard/hr/dashboard')}
          />

          <TavariTabSystemComponent
            tabs={availableTabs}
            mode="state"
            activeTab={activeTab}
            onTabChange={handleTabChange}
            ariaLabel="Employee Management module"
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

export default HREmployeeManagementHub;
