// screens/Accounting/AccountingDashboard.jsx – HR-style layout with top tabs
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useModuleEnabled } from '../../hooks/useModuleEnabled';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';

// Tab content components
import AccountingQueue from './AccountingQueue';
import AccountingSettings from './AccountingSettings';
import AccountingAssets from './AccountingAssets';
import AccountingJournalEntry from './AccountingJournalEntry';
import AccountingYearEnd from './AccountingYearEnd';
import AccountingActivity from './AccountingActivity';
import AccountingBankTransactions, {
  BANK_TABS,
  BANK_TAB_ROUTES,
  pathnameToBankTab,
} from './AccountingBankTransactions';
import AccountingOverview from './AccountingOverview';
import AccountingChartOfAccounts from './AccountingChartOfAccounts';
import AccountingExpenses from './AccountingExpenses';
import AccountingReportsHub from './AccountingReportsHub';
import AccountingSetupHub from './AccountingSetupHub';

const TAB_ROUTES = {
  overview: '/dashboard/accounting',
  queue: '/dashboard/accounting/queue',
  expenses: '/dashboard/accounting/expenses',
  bank_transactions: '/dashboard/accounting/bank-transactions/upload',
  chart_of_accounts: '/dashboard/accounting/chart-of-accounts',
  assets: '/dashboard/accounting/assets',
  journal: '/dashboard/accounting/journal',
  'year-end': '/dashboard/accounting/year-end',
};

const TABS = [
  { id: 'overview', label: 'Overview', icon: '🏠', description: 'Queue counts, bank items, setup status' },
  { id: 'queue', label: 'Queue', icon: '✓', description: 'Sales batches, deposits, expense drafts' },
  { id: 'expenses', label: 'Expenses', icon: '🧾', description: 'Entered vendor bills and credit memos' },
  { id: 'bank_transactions', label: 'Bank Transactions', icon: '🏦', description: 'Import, review, deposit, and reconcile bank activity' },
  { id: 'chart_of_accounts', label: 'Chart of Accounts', icon: '📊', description: 'ERPNext ledger accounts' },
  { id: 'assets', label: 'Assets', icon: '🏷️', description: 'Fixed assets & depreciation' },
  { id: 'journal', label: 'Journal Entry', icon: '✏️', description: 'Manual adjusting entries' },
  { id: 'year-end', label: 'Year End', icon: '🔒', description: 'Closing & retained earnings' },
];

const ACCOUNTING_ALLOWED_ROLES = ['owner', 'manager', 'admin'];

function pathnameToTab(pathname) {
  const isAccountingRoot = /\/accounting\/?$/.test(pathname);
  if (isAccountingRoot) return 'overview';
  if (pathname.includes('/accounting/journal')) return 'journal';
  if (pathname.includes('/accounting/year-end')) return 'year-end';
  if (pathname.includes('/accounting/queue')) return 'queue';
  if (pathname.includes('/accounting/expenses')) return 'expenses';
  if (/\/accounting\/bank-(transactions|import|reconciliation)/.test(pathname)) return 'bank_transactions';
  if (pathname.includes('/accounting/chart-of-accounts')) return 'chart_of_accounts';
  if (pathname.includes('/accounting/assets')) return 'assets';
  return 'overview';
}

const AccountingDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedBusinessId } = useBusinessContext();
  const {
    isEnabled: accountingEnabled,
    loading: accountingModuleLoading,
    error: accountingModuleError
  } = useModuleEnabled('accounting');
  const {
    authLoading,
    userRole,
    businessData,
    authError
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingDashboard'
  });

  const [activeTab, setActiveTab] = useState(() => pathnameToTab(location.pathname));
  const canAccessAccounting = ACCOUNTING_ALLOWED_ROLES.includes(userRole);
  const isBankTransactionsRoute = /\/accounting\/bank-(transactions|import|reconciliation)/.test(location.pathname);
  const isReportsRoute = /\/accounting\/reports/.test(location.pathname)
    || /\/accounting\/filing-reconciliation/.test(location.pathname);
  const isSettingsRoute = /\/accounting\/settings/.test(location.pathname);
  const isActivityRoute = /\/accounting\/activity/.test(location.pathname);
  const isSetupRoute = /\/accounting\/setup/.test(location.pathname)
    || /\/accounting\/vendors/.test(location.pathname)
    || /\/accounting\/categories/.test(location.pathname);
  const hideMainTabs = isReportsRoute || isSettingsRoute || isActivityRoute || isSetupRoute;
  const activeBankTab = pathnameToBankTab(location.pathname);

  useEffect(() => {
    const tab = pathnameToTab(location.pathname);
    setActiveTab(tab);
  }, [location.pathname]);

  useEffect(() => {
    if (authLoading || accountingModuleLoading || !selectedBusinessId || !userRole || canAccessAccounting) {
      return;
    }

    const fallbackPath = userRole === 'employee'
      ? '/dashboard/pos/register'
      : '/dashboard/home';

    navigate(fallbackPath, {
      replace: true,
      state: {
        deniedModule: 'accounting',
        deniedReason: 'insufficient_permissions'
      }
    });
  }, [authLoading, accountingModuleLoading, canAccessAccounting, navigate, selectedBusinessId, userRole]);

  const handleTabChange = (tabId) => {
    const path = TAB_ROUTES[tabId] ?? TAB_ROUTES.overview;
    if (path) navigate(path);
    setActiveTab(tabId);
  };

  const handleBankSubTabChange = (tabId) => {
    const path = BANK_TAB_ROUTES[tabId] || BANK_TAB_ROUTES.upload;
    if (path) navigate(path);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return <AccountingOverview embedded />;
      case 'queue':
        return <AccountingQueue embedded />;
      case 'expenses':
        return <AccountingExpenses embedded />;
      case 'bank_transactions':
        return (
          <AccountingBankTransactions
            embedded
            initialTab={activeBankTab}
            bankTabRoutes={BANK_TAB_ROUTES}
            hideSubTabs
            hideHeader
          />
        );
      case 'journal':
        return <AccountingJournalEntry embedded />;
      case 'year-end':
        return <AccountingYearEnd embedded />;
      case 'chart_of_accounts':
        return <AccountingChartOfAccounts embedded />;
      case 'assets':
        return <AccountingAssets embedded />;
      default:
        return <AccountingOverview embedded />;
    }
  };

  if (authLoading || !selectedBusinessId) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner} />
        <p style={styles.loadingText}>Loading Accounting...</p>
      </div>
    );
  }

  if (accountingModuleLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner} />
        <p style={styles.loadingText}>Loading Accounting...</p>
      </div>
    );
  }

  if (accountingModuleError) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>Could not verify whether Accounting is enabled right now. Please refresh and try again.</p>
      </div>
    );
  }

  if (!canAccessAccounting) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner} />
        <p style={styles.loadingText}>Redirecting...</p>
      </div>
    );
  }

  if (authError) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>{authError}</p>
      </div>
    );
  }

  if (!accountingEnabled) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>Accounting is not enabled for this business yet.</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>

      <TavariModuleHeader
        title="Tavari Accounting"
        description="Manage queues, reports, reconciliations, vendors, and accounting workflows."
        actionLabel="+ Expense"
        onAction={() => navigate('/dashboard/accounting/queue?addExpense=1')}
      />

      {!hideMainTabs && (
        <TavariTabSystemComponent
          tabs={TABS.map((tab) => ({
            id: tab.id,
            label: tab.label,
            icon: tab.icon,
          }))}
          mode="state"
          activeTab={activeTab}
          onTabChange={handleTabChange}
          ariaLabel="Accounting module"
          variant="module"
        />
      )}

      {!hideMainTabs && isBankTransactionsRoute && (
        <TavariTabSystemComponent
          tabs={BANK_TABS}
          mode="state"
          activeTab={activeBankTab}
          onTabChange={handleBankSubTabChange}
          ariaLabel="Bank transactions navigation"
          variant="module"
          fullWidth={false}
          containerStyle={{ marginBottom: 12 }}
        />
      )}

      <div style={styles.mainContent}>
        <div style={styles.tabContent}>
          {isReportsRoute
              ? <AccountingReportsHub embedded />
              : isSetupRoute
                ? <AccountingSetupHub embedded />
                : isSettingsRoute
                ? <AccountingSettings embedded />
                : isActivityRoute
                  ? <AccountingActivity embedded />
                  : renderTabContent()}
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    paddingTop: '80px',
    paddingLeft: '20px',
    paddingRight: '20px',
    paddingBottom: '20px'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    paddingTop: '60px'
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #14B8A6',
    borderTop: '3px solid transparent',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '8px'
  },
  loadingText: {
    margin: 0,
    color: TavariStyles?.colors?.gray600 || '#6b7280',
    fontSize: '16px'
  },
  errorContainer: {
    padding: 48,
    textAlign: 'center',
    backgroundColor: '#f9fafb'
  },
  errorText: {
    color: '#991b1b',
    margin: 0
  },
  header: {
    marginBottom: '20px'
  },
  mainTitle: {
    fontSize: '33px',
    fontWeight: 'bold',
    color: '#111827',
    margin: '0 0 8px 0'
  },
  subtitle: {
    color: '#6b7280',
    fontSize: '16px',
    margin: 0
  },
  mainContent: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
  },
  tabContent: {
    minHeight: '400px'
  }
};

export default AccountingDashboard;
