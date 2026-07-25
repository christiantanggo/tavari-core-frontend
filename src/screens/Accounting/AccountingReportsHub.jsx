import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import AccountingReports from './AccountingReports';
import AccountingFilingReconciliation from './AccountingFilingReconciliation';

import AccountingYearEndPackage from './AccountingYearEndPackage';

export const REPORT_TAB_ROUTES = {
  pl: '/dashboard/accounting/reports',
  hst: '/dashboard/accounting/reports/hst',
  cra: '/dashboard/accounting/reports/cra',
  balance_sheet: '/dashboard/accounting/reports/balance-sheet',
  general_ledger: '/dashboard/accounting/reports/general-ledger',
  trial_balance: '/dashboard/accounting/reports/trial-balance',
  ap_aging: '/dashboard/accounting/reports/ap-aging',
  ar_aging: '/dashboard/accounting/reports/ar-aging',
  ap_workspace: '/dashboard/accounting/reports/ap-workspace',
  ar_workspace: '/dashboard/accounting/reports/ar-workspace',
  filing_reconciliation: '/dashboard/accounting/reports/filing-reconciliation',
  year_end_package: '/dashboard/accounting/reports/year-end-package',
};

const REPORT_TABS = [
  { id: 'pl', label: 'P&L', icon: '📈' },
  { id: 'hst', label: 'HST', icon: '📄' },
  { id: 'cra', label: 'CRA Summary', icon: '🇨🇦' },
  { id: 'balance_sheet', label: 'Balance Sheet', icon: '📋' },
  { id: 'general_ledger', label: 'General Ledger', icon: '📘' },
  { id: 'trial_balance', label: 'Trial Balance', icon: '🧮' },
  { id: 'year_end_package', label: 'Year-end Package', icon: '📦' },
  { id: 'ap_aging', label: 'AP Aging', icon: '💸' },
  { id: 'ar_aging', label: 'AR Aging', icon: '💰' },
  { id: 'ap_workspace', label: 'AP', icon: '🧾' },
  { id: 'ar_workspace', label: 'AR', icon: '📬' },
  { id: 'filing_reconciliation', label: 'Filing Reconciliation', icon: '✅' },
];

export function pathnameToReportTab(pathname) {
  if (pathname.includes('/accounting/reports/year-end-package')) return 'year_end_package';
  if (pathname.includes('/accounting/reports/filing-reconciliation')) return 'filing_reconciliation';
  if (pathname.includes('/accounting/filing-reconciliation')) return 'filing_reconciliation';
  if (pathname.includes('/accounting/reports/hst')) return 'hst';
  if (pathname.includes('/accounting/reports/gst34')) return 'hst';
  if (pathname.includes('/accounting/reports/cra')) return 'cra';
  if (pathname.includes('/accounting/reports/balance-sheet')) return 'balance_sheet';
  if (pathname.includes('/accounting/reports/general-ledger')) return 'general_ledger';
  if (pathname.includes('/accounting/reports/trial-balance')) return 'trial_balance';
  if (pathname.includes('/accounting/reports/ap-aging')) return 'ap_aging';
  if (pathname.includes('/accounting/reports/ar-aging')) return 'ar_aging';
  if (pathname.includes('/accounting/reports/ap-workspace')) return 'ap_workspace';
  if (pathname.includes('/accounting/reports/ar-workspace')) return 'ar_workspace';
  if (pathname.includes('/accounting/reports')) return 'pl';
  return 'pl';
}

const AccountingReportsHub = ({ embedded = false }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const pathTab = pathnameToReportTab(location.pathname);
  const resolvedInitialTab = useMemo(
    () => (REPORT_TABS.some((tab) => tab.id === pathTab) ? pathTab : 'pl'),
    [pathTab]
  );
  const [activeTab, setActiveTab] = useState(resolvedInitialTab);
  const showLegacyGst34View = location.pathname.includes('/accounting/reports/gst34');

  useEffect(() => {
    setActiveTab(resolvedInitialTab);
  }, [resolvedInitialTab]);

  const handleReportTabChange = (tabId) => {
    const path = REPORT_TAB_ROUTES[tabId] || REPORT_TAB_ROUTES.pl;
    if (path) navigate(path);
    setActiveTab(tabId);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'hst':
        return <AccountingReports embedded reportView={showLegacyGst34View ? 'gst34' : 'hst'} />;
      case 'cra':
        return <AccountingReports embedded reportView="cra" />;
      case 'balance_sheet':
        return <AccountingReports embedded reportView="balance_sheet" />;
      case 'general_ledger':
        return <AccountingReports embedded reportView="general_ledger" />;
      case 'trial_balance':
        return <AccountingReports embedded reportView="trial_balance" />;
      case 'ap_aging':
        return <AccountingReports embedded reportView="ap_aging" />;
      case 'ar_aging':
        return <AccountingReports embedded reportView="ar_aging" />;
      case 'ap_workspace':
        return <AccountingReports embedded reportView="ap_workspace" />;
      case 'ar_workspace':
        return <AccountingReports embedded reportView="ar_workspace" />;
      case 'filing_reconciliation':
        return <AccountingFilingReconciliation embedded />;
      case 'year_end_package':
        return <AccountingYearEndPackage embedded />;
      case 'pl':
      default:
        return <AccountingReports embedded reportView="pl" />;
    }
  };

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 100, width: '100%', maxWidth: 'none', margin: 0 }}>
      <h2 style={{ fontSize: embedded ? '1.25rem' : '1.5rem', margin: '0 0 8px' }}>Reports</h2>
      <p style={{ margin: '0 0 16px', color: TavariStyles?.colors?.gray600 || '#6b7280', fontSize: 13 }}>
        ERPNext financial reports, tax filing views, aging, and AP/AR workspaces.
      </p>
      <TavariTabSystemComponent
        tabs={REPORT_TABS}
        mode="state"
        activeTab={activeTab}
        onTabChange={handleReportTabChange}
        ariaLabel="Accounting reports navigation"
        variant="module"
        fullWidth={false}
        containerStyle={{ marginBottom: 20 }}
      />
      {renderContent()}
    </div>
  );
};

export default AccountingReportsHub;
