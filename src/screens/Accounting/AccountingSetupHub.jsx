import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import AccountingVendors from './AccountingVendors';
import AccountingCategories from './AccountingCategories';
import AccountingOpeningBalances from './AccountingOpeningBalances';

export const SETUP_TAB_ROUTES = {
  vendors: '/dashboard/accounting/setup/vendors',
  categories: '/dashboard/accounting/setup/categories',
  opening_balances: '/dashboard/accounting/setup/opening-balances',
};

export const SETUP_TABS = [
  { id: 'vendors', label: 'Vendors', icon: '🏢' },
  { id: 'categories', label: 'Categories', icon: '📁' },
  { id: 'opening_balances', label: 'Opening Balances', icon: '🏁' },
];

export function pathnameToSetupTab(pathname) {
  if (pathname.includes('/accounting/setup/opening-balances')) return 'opening_balances';
  if (pathname.includes('/accounting/setup/categories')) return 'categories';
  if (pathname.includes('/accounting/setup/vendors')) return 'vendors';
  if (pathname.includes('/accounting/categories')) return 'categories';
  if (pathname.includes('/accounting/vendors')) return 'vendors';
  return 'vendors';
}

const AccountingSetupHub = ({ embedded = false }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const pathTab = pathnameToSetupTab(location.pathname);
  const resolvedInitialTab = useMemo(
    () => (SETUP_TABS.some((tab) => tab.id === pathTab) ? pathTab : 'vendors'),
    [pathTab]
  );
  const [activeTab, setActiveTab] = useState(resolvedInitialTab);

  useEffect(() => {
    setActiveTab(resolvedInitialTab);
  }, [resolvedInitialTab]);

  const handleSetupTabChange = (tabId) => {
    const path = SETUP_TAB_ROUTES[tabId] || SETUP_TAB_ROUTES.vendors;
    if (path) navigate(path);
    setActiveTab(tabId);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'categories':
        return <AccountingCategories embedded />;
      case 'opening_balances':
        return <AccountingOpeningBalances embedded />;
      case 'vendors':
      default:
        return <AccountingVendors embedded />;
    }
  };

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 100, width: '100%', maxWidth: 'none', margin: 0 }}>
      <h2 style={{ fontSize: embedded ? '1.25rem' : '1.5rem', margin: '0 0 8px' }}>Set Up</h2>
      <p style={{ margin: '0 0 16px', color: TavariStyles?.colors?.gray600 || '#6b7280', fontSize: 13 }}>
        Configure vendors, categories, and opening balances (QBO cutover) before processing transactions.
      </p>
      <TavariTabSystemComponent
        tabs={SETUP_TABS}
        mode="state"
        activeTab={activeTab}
        onTabChange={handleSetupTabChange}
        ariaLabel="Accounting setup navigation"
        variant="module"
        fullWidth={false}
        containerStyle={{ marginBottom: 20 }}
      />
      {renderContent()}
    </div>
  );
};

export default AccountingSetupHub;
