import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TavariStyles } from '../../utils/TavariStyles';
import AccountingBankImport from './AccountingBankImport';
import AccountingBankReconciliation from './AccountingBankReconciliation';
import AccountingQueue from './AccountingQueue';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';

export const BANK_TABS = [
  { id: 'upload', label: 'Bank Upload' },
  { id: 'pending', label: 'Pending Transactions' },
  { id: 'posted', label: 'Posted Transactions' },
  { id: 'excluded', label: 'Excluded Transactions' },
  { id: 'deposits', label: 'Create Bank Deposit' },
  { id: 'reconciliation', label: 'Bank Reconciliation' }
];

export const BANK_TAB_ROUTES = {
  upload: '/dashboard/accounting/bank-transactions/upload',
  pending: '/dashboard/accounting/bank-transactions/pending',
  posted: '/dashboard/accounting/bank-transactions/posted',
  excluded: '/dashboard/accounting/bank-transactions/excluded',
  deposits: '/dashboard/accounting/bank-transactions/deposits',
  reconciliation: '/dashboard/accounting/bank-reconciliation'
};

export function pathnameToBankTab(pathname) {
  if (pathname.includes('/bank-reconciliation')) return 'reconciliation';
  if (pathname.includes('/bank-transactions/pending')) return 'pending';
  if (pathname.includes('/bank-transactions/posted')) return 'posted';
  if (pathname.includes('/bank-transactions/excluded')) return 'excluded';
  if (pathname.includes('/bank-transactions/deposits')) return 'deposits';
  if (pathname.includes('/bank-transactions/upload')) return 'upload';
  if (pathname.includes('/bank-import')) return 'upload';
  return 'upload';
}

const AccountingBankTransactions = ({
  embedded = false,
  initialTab = 'upload',
  bankTabRoutes = BANK_TAB_ROUTES,
  hideSubTabs = false,
  hideHeader = false,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedTab = location.state?.bankTransactionsTab;
  const pathTab = pathnameToBankTab(location.pathname);
  const resolvedInitialTab = useMemo(
    () => (BANK_TABS.some((tab) => tab.id === requestedTab) ? requestedTab : (BANK_TABS.some((tab) => tab.id === pathTab) ? pathTab : initialTab)),
    [initialTab, pathTab, requestedTab]
  );
  const [activeTab, setActiveTab] = useState(resolvedInitialTab);

  useEffect(() => {
    setActiveTab(resolvedInitialTab);
  }, [resolvedInitialTab]);

  const handleBankTabChange = (tabId) => {
    const path = bankTabRoutes[tabId] || bankTabRoutes.upload;
    if (path) navigate(path);
    setActiveTab(tabId);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'pending':
        return <AccountingBankImport embedded viewMode="pending" hideTitle />;
      case 'posted':
        return <AccountingBankImport embedded viewMode="posted" hideTitle />;
      case 'excluded':
        return <AccountingBankImport embedded viewMode="excluded" hideTitle />;
      case 'deposits':
        return <AccountingQueue embedded focus="deposits" titleOverride="Create Bank Deposit" />;
      case 'reconciliation':
        return <AccountingBankReconciliation embedded />;
      case 'upload':
      default:
        return <AccountingBankImport embedded viewMode="upload" hideTitle />;
    }
  };

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 100, width: '100%', maxWidth: 'none', margin: 0 }}>
      {!hideHeader && (
        <>
          <h2 style={{ fontSize: embedded ? '1.25rem' : '1.5rem', margin: '0 0 8px' }}>Bank Transactions</h2>
          <p style={{ margin: '0 0 16px', color: TavariStyles?.colors?.gray600 || '#6b7280', fontSize: 13 }}>
            Manage imports, review uncategorized bank activity, create deposits from undeposited sales, and finish reconciliation.
          </p>
        </>
      )}
      {!hideSubTabs && (
        <TavariTabSystemComponent
          tabs={BANK_TABS}
          mode="state"
          activeTab={activeTab}
          onTabChange={handleBankTabChange}
          ariaLabel="Bank transactions navigation"
          variant="module"
          fullWidth={false}
          containerStyle={{ marginBottom: 20 }}
        />
      )}
      {renderContent()}
    </div>
  );
};

export default AccountingBankTransactions;
