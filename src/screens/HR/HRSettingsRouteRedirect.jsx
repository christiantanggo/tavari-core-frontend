import { Navigate, useSearchParams } from 'react-router-dom';

const LEGACY_TAB_MAP = {
  'employee-management': '/dashboard/hr/employee-management?tab=employee-management',
  'leave-benefits': '/dashboard/hr/employee-management?tab=leave-benefits',
  'shift-premiums': '/dashboard/hr/employee-management?tab=shift-premiums',
  premiums: '/dashboard/hr/employee-management?tab=shift-premiums',
  'approval-settings': '/dashboard/hr/communications?tab=approval-settings',
  notifications: '/dashboard/hr/communications?tab=notifications',
  'document-management': '/dashboard/hr/communications?tab=document-management',
  documents: '/dashboard/hr/communications?tab=document-management',
};

/**
 * /dashboard/hr/settings?tab=… → new HR hub paths (legacy links and bookmarks)
 */
const HRSettingsRouteRedirect = () => {
  const [sp] = useSearchParams();
  const raw = (sp.get('tab') || 'employee-management').toLowerCase().trim();
  const to = LEGACY_TAB_MAP[raw] || '/dashboard/hr/employee-management?tab=employee-management';
  return <Navigate to={to} replace />;
};

export default HRSettingsRouteRedirect;
