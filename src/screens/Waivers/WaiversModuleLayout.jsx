// Persistent tab bar for all in-dashboard waiver routes (matches WaiversDashboard actions + Overview).
import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { FiHome, FiFileText, FiUpload, FiFile, FiSettings, FiBarChart2, FiDownload, FiShoppingCart } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';

const BASE = '/dashboard/waivers';

export default function WaiversModuleLayout() {
  const navigate = useNavigate();
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'WaiversModuleLayout'
  });
  const { hasAnyPermission, hasElevatedPrivileges } = usePermissions();

  const elevated =
    auth.userRole === 'manager' ||
    auth.userRole === 'owner' ||
    auth.userRole === 'admin' ||
    hasElevatedPrivileges();
  const tabs = [
    { id: 'overview', label: 'Overview', icon: FiHome, to: BASE },
    {
      id: 'templates',
      label: 'Templates',
      icon: FiFileText,
      to: `${BASE}/templates`,
      visible: hasAnyPermission(['waivers.templates.manage', 'waivers.edit'])
    },
    {
      id: 'upload',
      label: 'Upload',
      icon: FiUpload,
      to: `${BASE}/upload`,
      visible: hasAnyPermission(['waivers.upload', 'waivers.create', 'waivers.edit'])
    },
    {
      id: 'paper',
      label: 'Paper Waivers',
      icon: FiFile,
      to: `${BASE}/paper-view`,
      visible: elevated
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: FiSettings,
      to: `${BASE}/settings`,
      visible: hasAnyPermission(['waivers.settings.manage', 'waivers.edit'])
    },
    {
      id: 'download',
      label: 'Download',
      icon: FiDownload,
      to: `${BASE}/kiosk/download`,
      visible: elevated
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: FiBarChart2,
      to: `${BASE}/reports`,
      visible: elevated
    }
  ];

  return (
    <div style={styles.shell}>
      <TavariModuleHeader
        title="Tavari Waivers"
        description="Manage waiver templates, uploads, signed waivers, kiosk downloads, and reporting."
        secondaryActionLabel="POS Register"
        secondaryActionIcon={<FiShoppingCart size={18} />}
        onSecondaryAction={() => navigate('/dashboard/pos/register')}
        actionLabel="Upload Waiver"
        actionIcon={<FiUpload size={18} />}
        onAction={() => navigate(`${BASE}/upload`)}
      />
      <TavariTabSystemComponent
        tabs={tabs}
        mode="route"
        ariaLabel="Waivers module"
      />

      <Outlet />
    </div>
  );
}

const styles = {
  shell: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
    padding: '20px',
    paddingTop: '80px',
    boxSizing: 'border-box'
  }
};
